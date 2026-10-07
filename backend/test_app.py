from fastapi.testclient import TestClient

import app as server

client = TestClient(server.app)


def test_videos_have_map_fields():
    vs = client.get("/api/videos").json()
    assert vs
    for v in vs:
        assert {"id", "title", "area", "district", "lat", "lng", "headline", "points"} <= v.keys()
        assert 37.4 < v["lat"] < 37.7 and 126.7 < v["lng"] < 127.2, v["id"]  # 서울 안


def test_contact(monkeypatch):
    sent = []
    monkeypatch.setattr(server, "send_email", sent.append)
    ok = {"email": "a@b.co", "category": "기타", "message": "임장 요청합니다"}
    assert client.post("/api/contact", json=ok).status_code == 201
    assert client.post("/api/contact", json={**ok, "email": "nope"}).status_code == 422
    assert client.post("/api/contact", json={**ok, "category": "해킹"}).status_code == 422
    assert client.post("/api/contact", json={**ok, "website": "spam"}).status_code == 201  # 봇: 발송 안 됨
    assert [c.email for c in sent] == ["a@b.co"]


def test_contact_unconfigured_fails_loudly(monkeypatch):
    # 키가 없으면 조용히 버리지 말고 실패를 알려야 문의가 증발하지 않는다
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    r = client.post("/api/contact", json={"email": "a@b.co", "message": "임장 요청합니다"})
    assert r.status_code == 503


def test_frontend_served():
    assert "대두남" in client.get("/").text
