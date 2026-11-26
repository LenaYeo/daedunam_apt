"""유튜브 RSS에서 새 영상을 가져와 Gemini로 요약/위치 추출 후 data/videos.json에 추가.

    python sync.py            # 새 영상만 요약
    python sync.py --redo ID  # 특정 영상 다시 요약

RSS는 최신 15개만 준다. 그보다 오래된 영상은 videos.json에 직접 넣는다.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx
from pydantic import BaseModel, Field

CHANNEL_ID = "UCPa3SNWU0E4hT15FKoxfBow"  # @DaeDuNam
FEED_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
VIDEOS_PATH = Path(__file__).resolve().parent / "data" / "videos.json"
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/"}

SYSTEM = """너는 서울 아파트 임장 유튜브 채널 '대두남'의 에디터다.
영상 제목과 설명란을 받아 웹사이트 지도에 올릴 요약을 만든다.
- 설명란에 있는 사실(연식, 세대수, 시세, 역 거리)만 쓴다. 없는 숫자를 지어내지 않는다.
- lat/lng는 영상이 다루는 단지들의 중심 위치(서울 안)다.
- points는 실거주 관점에서 이 지역의 핵심을 한 문장씩.
- complexes.note는 '2019년 · 1,900세대 · 84㎡ 22억'처럼 짧게. 가격이 없으면 생략."""

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"


class Complex(BaseModel):
    name: str
    note: str


class Summary(BaseModel):
    area: str = Field(description="구 + 동, 예: 강동구 명일동")
    district: str = Field(description="구 이름만, 예: 강동구")
    station: str = Field(description="대표 역, 예: 5호선 명일역")
    lat: float
    lng: float
    headline: str = Field(description="한 줄 요약, 40자 이내")
    points: list[str] = Field(description="핵심 포인트 3~4개")
    complexes: list[Complex]


def fetch_feed() -> list[dict]:
    with urllib.request.urlopen(FEED_URL, timeout=15) as r:
        root = ET.fromstring(r.read())
    out = []
    for e in root.findall("a:entry", NS):
        out.append({
            "id": e.findtext("yt:videoId", namespaces=NS),
            "title": e.findtext("a:title", namespaces=NS),
            "published": e.findtext("a:published", namespaces=NS)[:10],
            "description": e.findtext("media:group/media:description", default="", namespaces=NS),
        })
    return out


def episode_no(title: str) -> int | None:
    m = re.search(r"(\d+)화", title)
    return int(m.group(1)) if m else None


def summarize(api_key: str, v: dict) -> Summary:
    schema_hint = json.dumps(Summary.model_json_schema(), ensure_ascii=False)
    resp = httpx.post(
        GEMINI_URL,
        params={"key": api_key},
        json={
            "systemInstruction": {"parts": [{"text": SYSTEM + "\n\n응답 JSON 스키마:\n" + schema_hint}]},
            "contents": [{"parts": [{"text": f"제목: {v['title']}\n\n설명란:\n{v['description']}"}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        },
        timeout=30,
    )
    resp.raise_for_status()
    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    return Summary.model_validate_json(text)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--redo", help="다시 요약할 영상 ID")
    args = ap.parse_args()

    videos = json.loads(VIDEOS_PATH.read_text(encoding="utf-8"))
    known = {v["id"] for v in videos}
    todo = [f for f in fetch_feed() if f["id"] not in known or f["id"] == args.redo]
    if not todo:
        print("새 영상 없음")
        return

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY 환경변수를 설정해주세요", file=sys.stderr)
        sys.exit(1)

    for f in todo:
        print("요약 중:", f["title"])
        try:
            s = summarize(api_key, f)
        except (httpx.HTTPStatusError, KeyError, RuntimeError) as e:
            print("  건너뜀:", e, file=sys.stderr)
            continue
        entry = {"id": f["id"], "episode": episode_no(f["title"]), "title": f["title"], "published": f["published"], **s.model_dump()}
        videos = [v for v in videos if v["id"] != f["id"]] + [entry]
        # ponytail: 좌표는 LLM 추정치. 핀이 어긋나면 videos.json에서 lat/lng만 손으로 고친다.

    videos.sort(key=lambda v: v["published"])
    # episode이 null인 항목에 순서대로 번호 부여
    max_ep = max((v["episode"] for v in videos if v["episode"]), default=0)
    for v in videos:
        if v["episode"] is None:
            max_ep += 1
            v["episode"] = max_ep
    videos.reverse()
    VIDEOS_PATH.write_text(json.dumps(videos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"저장 완료: {len(videos)}개")


if __name__ == "__main__":
    main()
