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
  if (!map || !list.length) return;
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
  cur?.el.classList.add("active");
  cur?.overlay.setZIndex(10);
  if (fly && map) {
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
  $("#district").value = filter;
  renderCards();
  const list = visible();
  fitTo(list);
  if (!shown.has(activeId) && list.length) select(list[0].id, { fly: false });
}

function renderChips() {
  const counts = {};
  videos.forEach((v) => (counts[v.district] = (counts[v.district] || 0) + 1));
  const names = ["전체", ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  const label = (d) => (d === "전체" ? `전체 ${videos.length}` : `${d} ${counts[d]}`);
  $("#chips").replaceChildren(...names.map((d) =>
    h("button", { class: "chip", role: "tab", "data-d": d, "aria-selected": d === filter, onclick: () => { filter = d; applyFilter(); } }, label(d))));
  // 모바일용: 같은 필터를 기본 선택창으로
  $("#district").replaceChildren(...names.map((d) => h("option", { value: d }, d === "전체" ? `전체 구 (${videos.length})` : label(d))));
  $("#district").onchange = (e) => { filter = e.target.value; applyFilter(); };
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
    $("#detail").replaceChildren(h("p", { class: "muted" }, "영상 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주시기 바랍니다."));
    return;
  }
  for (const v of map ? videos : []) {  // 지도가 막혀도 목록·통계·상세는 그대로 보여준다
    const el = h("button", { class: "pin", title: `${epLabel(v)} · ${v.area}`, "aria-label": `${epLabel(v)} ${v.area}`, onclick: () => select(v.id) },
      String(v.episode ?? "•"));
    const overlay = new kakao.maps.CustomOverlay({ position: latLng(v), content: el, clickable: true, zIndex: 1 });
    overlay.setMap(map);
    markers.set(v.id, { overlay, el });
  }
  renderStats();
  renderChips();
  renderCards();
  // 목록이 그려지며 페이지가 길어지므로, #contact 같은 링크로 들어왔으면 위치를 다시 맞춘다
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  if (videos.length) {
    fitTo(videos);
    select(videos[0].id, { fly: false });
  }
}

function mapError() {
  $("#map").replaceChildren(h("p", { class: "map-error" }, "지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주시기 바랍니다."));
}

// SDK는 index.html에서 이 파일보다 먼저 로드된다 (도메인 미등록이면 kakao.maps가 없음)
if (window.kakao?.maps?.Map) {
  map = new kakao.maps.Map($("#map"), { center: new kakao.maps.LatLng(37.5565, 126.978), level: 8 });
  // 모바일은 핀치 줌이 있으니 확대 버튼은 데스크톱에서만
  if (matchMedia("(min-width: 961px)").matches) map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  addEventListener("resize", () => map.relayout()); // 화면 회전 시 타일 깨짐 방지
} else {
  mapError();
}
loadVideos();

// ---- contact: 단계형 설문 ----
{
// 문항은 여기서만 고치면 된다. name이 없는 문항은 라벨이 그대로 answers의 키(= 시트 컬럼명)가 된다.
// grp이 같은 문항은 그중 1개 이상 입력해야 제출된다. req가 없는 문항은 비워도 된다(공개하고 싶지 않은 항목은 건너뛸 수 있게). when: "항목=값|값" — 해당 답일 때만 노출·필수 검사.
const STEPS = [
  { title: "신청 정보", fields: [
    { l: "상담 유형", name: "category", t: "select", o: ["단지 추천", "정책·대출 상담", "매수 시기·시장 상황", "임장 요청", "기타"], req: 1 },
    { l: "이메일", name: "email", t: "email", ph: "you@example.com", req: 1, ac: "email" },
  ] },
  { title: "인적 사항", fields: [
    { l: "남자 나이 (만)", t: "number", ph: "만 나이" },
    { l: "여자 나이 (만)", t: "number", ph: "만 나이" },
    { l: "거주 지역", ph: "역 이름 / 단지명  예) 답십리역, 답십리파크자이" },
    { l: "거주 형태", t: "select", o: ["월세", "전세", "매매"] },
    { l: "계약 만료일", ph: "예) 2027.02", when: "거주 형태=월세|전세" },
    { l: "가구원 수", t: "number", ph: "예) 3" },
    { l: "자녀 유무", t: "select", o: ["무", "유"] },
    { l: "자녀 성별·나이", ph: "예) 남아 3세", when: "자녀 유무=유" },
    { l: "맞벌이 유무", t: "select", o: ["맞벌이", "외벌이"] },
    { l: "향후 결혼/출산 계획", ph: "예) 2년 내 출산 계획" },
  ] },
  { title: "소득 및 자산", fields: [
    { l: "월 소득 (합산 세후)", ph: "예) 800만원" },
    { l: "저축 가능액 (주담대 포함)", ph: "예) 400만원" },
    { l: "가용현금 (대출 포함, 합산)", ph: "부대비용 제외  예) 12~13억" },
  ] },
  { title: "주택 매수 조건", fields: [
    { l: "남편 직장 지역", ph: "예) 여의도" },
    { l: "아내 직장 지역", ph: "예) 합정" },
    { l: "희망지역(단지) 1순위", ph: "지하철역 / 단지명  예) 구로구 구로현대" },
    { l: "희망지역(단지) 2순위", ph: "예) 신도림역 태영데시앙" },
    { l: "희망지역(단지) 3순위", ph: "있다면 기재" },
    { l: "희망 평형", ph: "예) 59 선호, 입지 좋다면 49 가능 (49/59/84)" },
    { l: "상담 내용", name: "message", t: "textarea", ph: "예) 지금 매수해도 될지, 받을 수 있는 대출이 있는지 궁금합니다." },
  ] },
  { title: "구독 확인", fields: [
    { l: "네이버 이웃추가 ID", ph: "세 곳 중 1개 이상 입력해 주세요", grp: "sub" },
    { l: "Threads 계정 ID", ph: "세 곳 중 1개 이상 입력해 주세요", grp: "sub" },
    { l: "Youtube 계정 ID", ph: "세 곳 중 1개 이상 입력해 주세요", grp: "sub" },
  ] },
];

const form = $("#contact-form");
const status = $("#form-status");
let step = 0;

const fieldHTML = (f) => {
  const n = f.name || f.l;
  const attrs = `name="${n}"${f.req ? " required" : ""}${f.ph ? ` placeholder="${f.ph}"` : ""}${f.ac ? ` autocomplete="${f.ac}"` : ' autocomplete="off"'} maxlength="${f.t === "textarea" ? 3000 : 254}"`;
  const input = f.t === "select" ? `<select name="${n}"${f.req ? " required" : ""}>${f.req ? "" : '<option value="">선택 안 함</option>'}${f.o.map((o) => `<option>${o}</option>`).join("")}</select>`
    : f.t === "textarea" ? `<textarea ${attrs}></textarea>`
    : `<input type="${f.t || "text"}" ${f.t === "number" ? 'inputmode="numeric" min="0" max="999" ' : ""}${attrs}>`;
  return `<label>${f.l}${f.req ? ' <span class="opt">필수</span>' : ""}${input}</label>`;
};
// 화면(page) 하나에 문항 하나. 같은 grp의 문항은 한 화면에 같이 뜬다.
// when이 있는 문항은 조건에 맞을 때만 거치고, 아니면 건너뛴다.
const FIELDS = STEPS.flatMap((s) => s.fields.map((f) => ({ ...f, sec: s.title })));
const PAGES = FIELDS.reduce((acc, f) => {
  const last = acc[acc.length - 1];
  if (f.grp && last && last[0].grp === f.grp) last.push(f);
  else acc.push([f]);
  return acc;
}, []);
$("#steps").innerHTML = PAGES.map((p) => `<fieldset class="step" hidden>${p.map(fieldHTML).join("")}</fieldset>`).join("");
const panels = [...document.querySelectorAll(".step")];
const ctls = (i) => [...panels[i].querySelectorAll("input,select,textarea")];

const on = (p) => {
  if (!p[0].when) return true;
  const [k, v] = p[0].when.split("=");
  return v.split("|").includes(form.elements[k].value);
};
// 건너뛴 문항은 disabled 처리해 검증과 전송에서 빠지게 한다
const syncWhen = () => PAGES.forEach((p, i) => { if (p[0].when) ctls(i).forEach((c) => (c.disabled = !on(p))); });
form.addEventListener("change", syncWhen);

const move = (i, d) => {
  do i += d; while (PAGES[i] && !on(PAGES[i]));
  return i;
};
const isLast = () => move(step, 1) >= PAGES.length;

const refresh = () => {
  const skip = !PAGES[step].some((f) => f.req) && ctls(step).every((c) => !c.value.trim());
  $("#step-next").textContent = skip ? "건너뛰기" : "다음";
};
const show = (i, focus = true) => {
  step = i;
  panels.forEach((p, k) => (p.hidden = k !== i));
  const total = PAGES.filter(on).length, pos = PAGES.slice(0, i + 1).filter(on).length;
  $("#step-label").textContent = `${PAGES[i][0].sec} · ${pos} / ${total}`;
  $("#progress").style.width = `${(pos / total) * 100}%`;
  $("#step-prev").hidden = move(i, -1) < 0;
  $("#step-next").hidden = isLast();
  $("#step-submit").hidden = !isLast();
  refresh();
  if (focus) ctls(i)[0].focus({ preventScroll: true });
};
const stepValid = () => ctls(step).every((c) => c.disabled || c.reportValidity());
const next = () => stepValid() && show(move(step, 1));

form.addEventListener("input", refresh);
form.addEventListener("change", refresh);
$("#step-prev").addEventListener("click", () => show(move(step, -1)));
$("#step-next").addEventListener("click", next);
syncWhen();
show(0, false);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isLast()) return next(); // 중간 단계에서 Enter를 눌러도 제출되지 않게
  if (!stepValid()) return;
  const sub = PAGES.findIndex((p) => p[0].grp === "sub");
  if (ctls(sub).every((c) => !c.value.trim())) { // 구독 확인용 ID가 하나도 없으면 ID 화면으로 돌려보낸다
    show(sub);
    status.className = "form-status err";
    status.textContent = "구독 확인을 위해 네이버·Threads·Youtube 중 1개 이상의 ID를 입력해 주세요.";
    return;
  }
  status.textContent = "";
  const { category, email, message, trap, ...answers } = Object.fromEntries(new FormData(form));
  const btn = $("#step-submit");
  btn.disabled = true;
  status.className = "form-status";
  status.textContent = "보내는 중…";
  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, email, message, trap, answers }),
    });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    syncWhen();
    show(0, false);
    status.className = "form-status ok";
    status.textContent = "상담 신청이 접수되었습니다. 구독 확인 후 남겨주신 이메일로 답장 드리겠습니다.";
  } catch {
    status.className = "form-status err";
    status.textContent = "전송에 실패했습니다. 입력하신 내용을 확인한 뒤 다시 시도해 주시기 바랍니다.";
  } finally {
    btn.disabled = false;
  }
});
}
