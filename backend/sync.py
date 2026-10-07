"""유튜브 RSS에서 새 영상을 가져와 Claude로 요약/위치 추출 후 data/videos.json에 추가.

    python sync.py            # 새 영상만 요약
    python sync.py --redo ID  # 특정 영상 다시 요약

RSS는 최신 15개만 준다. 그보다 오래된 영상은 videos.json에 직접 넣는다.
"""
import argparse
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import anthropic
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


def summarize(client: anthropic.Anthropic, v: dict) -> Summary:
    resp = client.beta.messages.parse(
        model="claude-opus-5-5",
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # 안전 필터가 거절하면 서버가 다른 모델로 재시도
        output_config={"effort": "low"},  # 설명란 정리 수준이라 low로 충분
        system=SYSTEM,
        messages=[{"role": "user", "content": f"제목: {v['title']}\n\n설명란:\n{v['description']}"}],
        output_format=Summary,
    )
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        raise RuntimeError(f"요약 실패 ({resp.stop_reason})")
    return resp.parsed_output


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

    client = anthropic.Anthropic()
    for f in todo:
        print("요약 중:", f["title"])
        try:
            s = summarize(client, f)
        except (anthropic.APIError, RuntimeError) as e:
            print("  건너뜀:", e, file=sys.stderr)
            continue
        entry = {"id": f["id"], "episode": episode_no(f["title"]), "title": f["title"], "published": f["published"], **s.model_dump()}
        videos = [v for v in videos if v["id"] != f["id"]] + [entry]
        # ponytail: 좌표는 LLM 추정치. 핀이 어긋나면 videos.json에서 lat/lng만 손으로 고친다.

    videos.sort(key=lambda v: v["published"], reverse=True)
    VIDEOS_PATH.write_text(json.dumps(videos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"저장 완료: {len(videos)}개")


if __name__ == "__main__":
    main()
