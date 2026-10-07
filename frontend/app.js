const $ = (sel) => document.querySelector(sel);

// 작은 DOM 헬퍼: 데이터는 전부 textContent로 넣어 XSS 걱정 없음
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}

const thumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
const epLabel = (v) => (v.episode ? `EP.${v.episode}` : "EP");
const fmtDate = (d) => d.replaceAll("-", ".");

// ---- map (Kakao) ----
let map;
let videos = [];
let filter = "전체";
let activeId = null;
const markers = new Map(); // id -> { overlay, el }

const latLng = (v) => new kakao.maps.LatLng(v.lat, v.lng);

function fitTo(list) {
  if (!list.length) return;
  const b = new kakao.maps.LatLngBounds();
  list.forEach((v) => b.extend(latLng(v)));
  map.setBounds(b, 60, 60, 60, 60);
}

function renderDetail(v) {
  const player = h("div", { class: "player" },
    h("img", { src: thumb(v.id), alt: "", loading: "lazy" }),
    h("button", {
      "aria-label": `${v.title} 재생`,
      onclick: () => player.replaceChildren(h("iframe", {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0`,
        title: v.title, allow: "autoplay; encrypted-media; picture-in-picture", allowfullscreen: "",
      })),
    }),
  );
  const rows = (v.complexes || []).map((c) => h("tr", {}, h("td", {}, c.name), h("td", {}, c.note || "–")));
  // sheet-top = 모바일 바텀시트에서 접혀 있을 때 보이는 부분
  $("#detail").replaceChildren(
    h("div", { class: "sheet-top" },
      h("span", { class: "sheet-handle", "aria-hidden": "true" }),
      h("div", { class: "badge" }, epLabel(v), h("span", {}, fmtDate(v.published))),
      h("h3", {}, v.area),
      h("p", { class: "meta" }, v.station),
      h("p", { class: "headline" }, v.headline)),
    h("div", { class: "sheet-body" },
      player,
      h("ul", { class: "points" }, ...(v.points || []).map((p) => h("li", {}, p))),
      rows.length ? h("table", { class: "complexes" },
        h("thead", {}, h("tr", {}, h("th", {}, "단지"), h("th", {}, "연식 · 세대 · 시세"))),
        h("tbody", {}, ...rows)) : null,
      h("a", { class: "yt-link", href: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`, target: "_blank", rel: "noopener" }, "유튜브에서 보기 →")),
  );
  $("#detail").scrollTop = 0;
}

// ---- 모바일 바텀시트: 상단부를 탭하거나 위/아래로 쓸어서 펼치고 접는다 ----
const sheet = $("#detail");
const setSheet = (state) => (sheet.dataset.state = state);
let touchY = null;
sheet.addEventListener("click", (e) => {
  if (e.target.closest(".sheet-top")) setSheet(sheet.dataset.state === "open" ? "peek" : "open");
});
sheet.addEventListener("touchstart", (e) => {
  touchY = e.target.closest(".sheet-top") ? e.touches[0].clientY : null;
}, { passive: true });
sheet.addEventListener("touchend", (e) => {
  if (touchY == null) return;
  const dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dy) > 30) {
    setSheet(dy < 0 ? "open" : "peek");
    e.preventDefault(); // 스와이프 뒤에 click 토글이 또 일어나지 않게
  }
  touchY = null;
});

function select(id, { fly = true } = {}) {
  const v = videos.find((x) => x.id === id);
  if (!v) return;
  if (activeId && markers.has(activeId)) {
    const prev = markers.get(activeId);
    prev.el.classList.remove("active");
    prev.overlay.setZIndex(1);
  }
  activeId = id;
  const cur = markers.get(id);
  cur.el.classList.add("active");
  cur.overlay.setZIndex(10);
  if (fly) {
    if (map.getLevel() > 5) map.setLevel(5);
    map.panTo(latLng(v));
  }
  setSheet("peek");
  renderDetail(v);
}

function visible() {
  return filter === "전체" ? videos : videos.filter((v) => v.district === filter);
}

function applyFilter() {
  const shown = new Set(visible().map((v) => v.id));
  for (const [id, m] of markers) m.overlay.setMap(shown.has(id) ? map : null);
  document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-selected", c.dataset.d === filter));
  renderCards();
  const list = visible();
  fitTo(list);
  if (!shown.has(activeId) && list.length) select(list[0].id, { fly: false });
}

function renderChips() {
  const counts = {};
  videos.forEach((v) => (counts[v.district] = (counts[v.district] || 0) + 1));
  const names = ["전체", ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  $("#chips").replaceChildren(...names.map((d) =>
    h("button", { class: "chip", role: "tab", "data-d": d, "aria-selected": d === filter, onclick: () => { filter = d; applyFilter(); } },
      d === "전체" ? `전체 ${videos.length}` : `${d} ${counts[d]}`)));
}

function renderCards() {
  $("#cards").replaceChildren(...visible().map((v) =>
    h("button", { class: "card", onclick: () => { select(v.id); $("#map-section").scrollIntoView(); } },
      h("img", { src: thumb(v.id), alt: "", loading: "lazy" }),
      h("div", { class: "card-body" },
        h("div", { class: "badge" }, epLabel(v), h("span", {}, v.area)),
        h("h3", {}, v.headline),
        h("p", {}, fmtDate(v.published))))));
}

function renderStats() {
  $("#stat-videos").textContent = `${videos.length}편`;
  $("#stat-districts").textContent = `${new Set(videos.map((v) => v.district)).size}곳`;
  $("#stat-complexes").textContent = `${new Set(videos.flatMap((v) => (v.complexes || []).map((c) => c.name))).size}곳`;
}

async function loadVideos() {
  try {
    const res = await fetch("/api/videos");
    if (!res.ok) throw new Error(res.status);
    videos = await res.json();
  } catch (e) {
    $("#detail").replaceChildren(h("p", { class: "muted" }, "영상 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요."));
    return;
  }
  for (const v of videos) {
    const el = h("button", { class: "pin", title: `${epLabel(v)} · ${v.area}`, "aria-label": `${epLabel(v)} ${v.area}`, onclick: () => select(v.id) },
      String(v.episode ?? "•"));
    const overlay = new kakao.maps.CustomOverlay({ position: latLng(v), content: el, clickable: true, zIndex: 1 });
    overlay.setMap(map);
    markers.set(v.id, { overlay, el });
  }
  renderStats();
  renderChips();
  renderCards();
  if (videos.length) {
    fitTo(videos);
    select(videos[0].id, { fly: false });
  }
}

function mapError() {
  $("#map").replaceChildren(h("p", { class: "map-error" }, "지도를 불러오지 못했어요. 카카오 개발자 콘솔에 이 사이트 도메인이 등록됐는지 확인해주세요."));
}

// SDK는 index.html에서 이 파일보다 먼저 로드된다 (도메인 미등록이면 kakao.maps가 없음)
if (window.kakao?.maps?.Map) {
  map = new kakao.maps.Map($("#map"), { center: new kakao.maps.LatLng(37.5565, 126.978), level: 8 });
  // 모바일은 핀치 줌이 있으니 확대 버튼은 데스크톱에서만
  if (matchMedia("(min-width: 961px)").matches) map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  addEventListener("resize", () => map.relayout()); // 화면 회전 시 타일 깨짐 방지
  loadVideos();
} else {
  mapError();
}

// ---- contact ----
$("#contact-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $("#form-status");
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const btn = form.querySelector("button");
  btn.disabled = true;
  status.className = "form-status";
  status.textContent = "보내는 중…";
  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    status.className = "form-status ok";
    status.textContent = "문의가 접수됐어요. 남겨주신 이메일로 답장 드릴게요!";
  } catch {
    status.className = "form-status err";
    status.textContent = "전송에 실패했어요. 입력값을 확인하고 다시 시도해주세요.";
  } finally {
    btn.disabled = false;
  }
});
