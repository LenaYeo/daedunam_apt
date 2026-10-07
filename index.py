# Vercel이 루트의 index.py에서 FastAPI `app`을 찾는다. 실제 코드는 backend/app.py.
from backend.app import app  # noqa: F401
