# daedunam_apt

대두남(대기업 다니는 두 남자의 서울 임장일지) 웹사이트.
유튜브 임장 영상을 서울 지도(카카오맵)에 핀으로 찍고, 영상과 요약을 같이 보여준다. 모바일/데스크톱 모두 지원.

```
index.py            Vercel 진입점 (backend/app.py의 app을 가져옴)
frontend/           정적 HTML/CSS/JS
backend/
  app.py            FastAPI: GET /api/videos, POST /api/contact(메일 발송), 프론트 서빙
  sync.py           유튜브 RSS → Claude 요약 → data/videos.json
  data/videos.json  지도에 올라가는 영상 데이터 (직접 수정 가능)
  test_app.py
```

## 로컬 실행

```bash
python -m venv .venv
.venv/Scripts/activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn index:app --reload --port 8765
```

http://localhost:8765 에서 확인한다. 카카오 JavaScript SDK 도메인에 이 주소가 등록돼 있어야 지도가 뜬다.
`127.0.0.1`로 열면 등록된 도메인이 아니라서 지도가 막힌다.

## 문의 메일 (Resend)

문의는 DB에 저장하지 않고 메일로만 받는다. 받은 메일에서 답장을 누르면 문의자에게 바로 간다.

1. resend.com에 가입한 뒤 API Key를 발급받는다.
2. 환경변수를 설정한다.
   - `RESEND_API_KEY`: 발급받은 키
   - `CONTACT_TO`: 문의를 받을 메일 주소. 도메인 인증을 하기 전에는 **Resend 가입 이메일만** 쓸 수 있다.
   - (선택) `CONTACT_FROM`: Resend에서 도메인을 인증한 뒤 `대두남 <contact@내도메인>` 형태로 넣는다.
3. 무료 플랜은 하루 100통, 한 달 3,000통까지 보낼 수 있다.

키가 설정돼 있지 않으면 문의 폼은 조용히 넘어가지 않고 실패 메시지를 보여준다.

## Vercel 배포

1. GitHub에 push한다.
2. vercel.com → Add New → Project → 저장소를 선택한다. Framework는 자동으로 FastAPI가 잡힌다.
3. Settings → Environment Variables에 `RESEND_API_KEY`와 `CONTACT_TO`를 넣고 Redeploy한다.
4. 배포 주소(`https://xxx.vercel.app`)를 카카오 개발자 콘솔의 [앱] → [플랫폼 키] → [JavaScript 키] → [JavaScript SDK 도메인]에 추가한다.

이후에는 push할 때마다 자동으로 재배포된다.

## 새 영상 요약 (LLM)

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
python backend/sync.py              # RSS에서 새 영상만 찾아 요약
python backend/sync.py --redo <ID>  # 특정 영상 다시 요약
```

- 모델은 `claude-opus-5-5`를 쓰고, 안전 필터가 거절하면 서버 측 fallback으로 다른 모델이 재시도한다.
- **핀 좌표(lat/lng)는 LLM이 추정한 값**이다. 핀 위치가 어긋나면 `videos.json`에서 숫자만 고치면 된다.
- RSS는 최신 15개 영상만 준다. 그보다 오래된 영상은 `videos.json`에 직접 추가한다.
- 바뀐 `videos.json`을 커밋하고 push하면 사이트에 반영된다.

## 테스트

```bash
pytest -q backend
```
