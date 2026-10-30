"""대두남 웹 API: 영상 목록 제공 + 문의 메일 발송. 프론트엔드 정적 파일도 같이 서빙한다."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")  # 로컬용. Vercel은 대시보드 환경변수를 쓰고 .env가 없어 무시된다.
VIDEOS_PATH = ROOT / "data" / "videos.json"
FRONTEND = ROOT.parent / "frontend"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CATEGORIES = {"단지 추천", "정책·대출 상담", "매수 시기·시장 상황", "임장 요청", "기타"}

app = FastAPI(title="daedunam_apt")


class Contact(BaseModel):
    email: str = Field(max_length=254)
    category: str = "단지 추천"
    message: str = Field(default="", max_length=3000)
    website: str = ""  # honeypot: 사람은 비워둠, 봇은 채움
    answers: dict[str, str] = {}  # 설문 항목. 항목 이름 → 답변. 문항을 늘려도 서버는 그대로 둔다.

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        v = v.strip()
        if not EMAIL_RE.match(v):
            raise ValueError("이메일 형식이 올바르지 않습니다")
        return v

    @field_validator("answers")
    @classmethod
    def check_answers(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 40 or any(len(k) > 40 or len(a) > 300 for k, a in v.items()):
            raise ValueError("설문 항목이 너무 깁니다")
        return {k: a.strip() for k, a in v.items() if a.strip()}

    @field_validator("category")
    @classmethod
    def check_category(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError("알 수 없는 문의 유형")
        return v


def answers_text(c: Contact) -> str:
    return "".join(f"{k}: {a}\n" for k, a in c.answers.items()) + ("\n" if c.answers else "")


def send_email(c: Contact) -> None:
    """Resend로 문의 메일 발송. 답장 버튼을 누르면 문의자에게 바로 가도록 reply_to를 건다."""
    key, to = os.getenv("RESEND_API_KEY"), os.getenv("CONTACT_TO")
    if not key or not to:
        raise HTTPException(503, "문의 메일 설정이 되어 있지 않습니다 (RESEND_API_KEY, CONTACT_TO)")
    body = json.dumps({
        # ponytail: resend.dev 발신 주소는 Resend 가입 이메일로만 보낼 수 있음. 다른 주소로 받으려면 Resend에서 도메인 인증 후 CONTACT_FROM 설정.
        "from": os.getenv("CONTACT_FROM", "대두남 상담 <onboarding@resend.dev>"),
        "to": [to],
        "reply_to": c.email,
        "subject": f"[대두남 상담 · {c.category}] {c.email}",
        "text": f"유형: {c.category}\n회신: {c.email}\n\n{answers_text(c)}{c.message.strip()}",
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails", data=body, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "daedunam-apt"},
    )
    try:
        urllib.request.urlopen(req, timeout=10).close()
    except urllib.error.URLError as e:
        print("resend 실패:", getattr(e, "code", ""), getattr(e, "reason", e))
        raise HTTPException(502, "메일 발송에 실패했습니다") from e


def save_to_sheet(c: Contact) -> None:
    """Google Apps Script 웹훅으로 스프레드시트에 한 줄 추가. Apps Script는 302로 결과를 넘기는데 urllib가 따라간다."""
    url, token = os.getenv("SHEETS_WEBHOOK_URL"), os.getenv("SHEETS_TOKEN", "")
    body = json.dumps({"token": token, "email": c.email, "category": c.category, "message": c.message.strip(), "answers": c.answers}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            if json.loads(r.read()).get("ok") is not True:
                raise ValueError("webhook rejected")
    except (urllib.error.URLError, ValueError) as e:
        print("sheet 실패:", getattr(e, "code", ""), getattr(e, "reason", e))
        raise HTTPException(502, "문의 저장에 실패했습니다") from e


@app.get("/api/videos")
def videos():
    return json.loads(VIDEOS_PATH.read_text(encoding="utf-8"))


@app.post("/api/contact", status_code=201)
def contact(c: Contact):
    if not c.website:  # 봇이면 보내지 않고 성공한 척만 한다
        if os.getenv("SHEETS_WEBHOOK_URL"):
            save_to_sheet(c)  # 시트가 원본 기록이라 먼저 저장. 실패하면 메일도 보내지 않고 에러를 돌려준다.
        send_email(c)
    return {"ok": True}


# 마지막에 마운트해야 /api 라우트를 가리지 않는다. Vercel에서는 이 폴더가 CDN으로 올라간다.
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
