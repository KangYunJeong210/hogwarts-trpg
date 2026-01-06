/* /js/app.js
   Mobile VN(TRPG) Frontend
   - Renders the single-JSON scene from /api/story
   - Manages local state (stats/relationships/flags)
   - Loads character images by expression:
       /img/chars/{id}/{expression}.png
     Background (optional):
       /img/bg/{bgKey}.jpg  (falls back to .png if jpg missing)
*/

(() => {
  const LS_KEY = "hogwarts_trpg_save_v1";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  const chapterText = $("chapterText");
  const sceneTitle = $("sceneTitle");
  const sceneSub = $("sceneSub");
  const spotlight = $("spotlight");

  const bg = $("bg");
  const charLeft = $("charLeft");
  const charCenter = $("charCenter");
  const charRight = $("charRight");

  const narration = $("narration");
  const dialogueList = $("dialogueList");
  const choicesWrap = $("choices");
  const checksWrap = $("checks");

  const userText = $("userText");
  const sendTextBtn = $("sendTextBtn");

  const statFocus = $("statFocus");
  const statTalent = $("statTalent");
  const statReason = $("statReason");
  const statBond = $("statBond");

  const menuBtn = $("menuBtn");
  const sidePanel = $("sidePanel");
  const closePanelBtn = $("closePanelBtn");

  const saveBtn = $("saveBtn");
  const loadBtn = $("loadBtn");
  const resetBtn = $("resetBtn");

  const apiUrlInput = $("apiUrl");
  const themeToggle = $("themeToggle");
  const appRoot = $("app");

  const relMaren = $("relMaren");
  const relIrian = $("relIrian");
  const relEdrik = $("relEdrik");
  const relCassian = $("relCassian");
  const relSelene = $("relSelene");

  const toast = $("toast");
  const loading = $("loading");

  // ---------- State ----------
  let state = defaultState(); // local game state
  let lastScene = null;       // last scene JSON
  let pendingUserText = "";   // optional extra text sent with next choice

  function defaultState() {
    return {
      // core stats (0~5)
      stats: { focus: 0, talent: 0, reason: 0, bond: 0 },

      // relationships tracked internally; UI shows only summaries
      relationships: {
        "마렌 솔리스": { friendship: 0, trust: 0, romance: 0, flags: [] },
        "이리안 벨모어": { friendship: 0, trust: 0, romance: 0, flags: [] },
        "에드릭 나이트로우": { friendship: 0, trust: 0, romance: 0, flags: [] },
        "카시안 벨로크": { friendship: 0, trust: 0, romance: 0, flags: [] },
        "셀렌 모르카": { friendship: 0, trust: 0, romance: 0, flags: [] },
      },

      globalFlags: [],

      // assets metadata from model (romance candidates etc.)
      assets: {
        romanceCandidates: [
          { name: "마렌 솔리스", id: "maren", expressions: ["neutral", "smile", "angry", "sad", "blush", "serious", "surprised"] },
          { name: "카시안 벨로크", id: "cassian", expressions: ["neutral", "smile", "angry", "sad", "blush", "serious", "surprised"] },
          { name: "셀렌 모르카", id: "selene", expressions: ["neutral", "smile", "angry", "sad", "blush", "serious", "surprised"] },
        ],
      },

      // chapter bookkeeping (optional)
      meta: {
        lastSchoolYear: 1,
        lastTerm: "Fall",
      },
    };
  }

  // ---------- Helpers ----------
  function showToast(msg, ms = 1600) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), ms);
  }

  function setLoading(on) {
    loading.hidden = !on;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function toRelKey(name) {
    // exact names used in server output; keep as-is
    return name;
  }

  function relSummary(rel) {
    // Hide raw numbers; show qualitative summary
    const f = rel.friendship ?? 0;
    const t = rel.trust ?? 0;
    const r = rel.romance ?? 0;

    const fTxt = f <= 1 ? "낯설" : f <= 4 ? "친근" : f <= 7 ? "친구" : "각별";
    const tTxt = t <= 1 ? "숨김" : t <= 4 ? "조심" : t <= 7 ? "공유" : "전면";
    const rTxt = r <= 0 ? "-" : r <= 3 ? "호감" : r <= 6 ? "애착" : r <= 9 ? "선택" : "연인";

    return `${fTxt} · ${tTxt} · ${rTxt}`;
  }

  function updateRelSummaryUI() {
    relMaren.textContent = relSummary(state.relationships["마렌 솔리스"]);
    relIrian.textContent = relSummary(state.relationships["이리안 벨모어"]);
    relEdrik.textContent = relSummary(state.relationships["에드릭 나이트로우"]);
    relCassian.textContent = relSummary(state.relationships["카시안 벨로크"]);
    relSelene.textContent = relSummary(state.relationships["셀렌 모르카"]);
  }

  function updateStatsUI() {
    const s = state.stats;
    statFocus.textContent = s.focus ?? 0;
    statTalent.textContent = s.talent ?? 0;
    statReason.textContent = s.reason ?? 0;
    statBond.textContent = s.bond ?? 0;
  }

  function clearNode(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escapeText(s) {
    return String(s ?? "");
  }

  // ---------- Visuals ----------
  function imgPathChar(id, expression) {
    return `./img/chars/${id}/${expression}.png`;
  }

  function setSlot(slotEl, charObj, isSpotlight) {
    // charObj: {id, expression, position}
    if (!charObj) {
      slotEl.classList.remove("show", "spot", "dim");
      slotEl.innerHTML = "";
      slotEl.setAttribute("aria-hidden", "true");
      return;
    }
    const id = charObj.id || "unknown";
    const expression = charObj.expression || "neutral";

    slotEl.classList.add("show");
    slotEl.setAttribute("aria-hidden", "false");

    slotEl.classList.toggle("spot", !!isSpotlight);
    slotEl.classList.toggle("dim", isSpotlight === false);

    // Replace image
    const src = imgPathChar(id, expression);
    slotEl.innerHTML = `<img alt="${id}:${expression}" src="${src}" loading="eager" />`;
  }

  async function setBackground(bgKey) {
    // Optional: try .jpg then .png
    if (!bgKey) {
      bg.style.backgroundImage = "";
      return;
    }
    const jpg = `./img/bg/${bgKey}.jpg`;
    const png = `./img/bg/${bgKey}.png`;

    // Quick test by creating an Image and resolving
    const tryLoad = (src) =>
      new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(src);
        im.onerror = () => resolve(null);
        im.src = src;
      });

    const found = (await tryLoad(jpg)) || (await tryLoad(png));
    bg.style.backgroundImage = found ? `url("${found}")` : "";
  }

  function renderVisuals(visuals) {
    const v = visuals || {};
    const chars = safeArray(v.characters);

    const leftObj = chars.find((c) => c.position === "left") || null;
    const centerObj = chars.find((c) => c.position === "center") || null;
    const rightObj = chars.find((c) => c.position === "right") || null;

    const spot = v.spotlight || "";

    // spotlight logic: only dim others when spotlight is set
    const spotLeft = spot && leftObj ? leftObj.id === spot : null;
    const spotCenter = spot && centerObj ? centerObj.id === spot : null;
    const spotRight = spot && rightObj ? rightObj.id === spot : null;

    setSlot(charLeft, leftObj, spot ? spotLeft : null);
    setSlot(charCenter, centerObj, spot ? spotCenter : null);
    setSlot(charRight, rightObj, spot ? spotRight : null);

    // If spotlight set, dim non-spot slots
    if (spot) {
      if (leftObj && !spotLeft) charLeft.classList.add("dim");
      if (centerObj && !spotCenter) charCenter.classList.add("dim");
      if (rightObj && !spotRight) charRight.classList.add("dim");
    } else {
      charLeft.classList.remove("dim");
      charCenter.classList.remove("dim");
      charRight.classList.remove("dim");
    }

    setBackground(v.bgKey).catch(() => {});
  }

  // ---------- Scene Rendering ----------
  function renderChecks(checks) {
    const arr = safeArray(checks);
    if (!arr.length) {
      checksWrap.hidden = true;
      clearNode(checksWrap);
      return;
    }
    checksWrap.hidden = false;
    clearNode(checksWrap);

    for (const c of arr) {
      const row = document.createElement("div");
      row.className = "check";
      const left = document.createElement("div");
      left.textContent = `${c.type || "check"}`;
      const code = document.createElement("code");
      code.textContent = c.formula || "";
      row.appendChild(left);
      row.appendChild(code);
      checksWrap.appendChild(row);
    }
  }

  function renderDialogueLines(lines) {
    clearNode(dialogueList);
    for (const ln of safeArray(lines)) {
      const wrap = document.createElement("div");
      wrap.className = "line";

      const who = document.createElement("div");
      who.className = "who";
      who.textContent = ln.speaker || "—";

      const say = document.createElement("div");
      say.className = "say";
      say.textContent = ln.text || "";

      wrap.appendChild(who);
      wrap.appendChild(say);
      dialogueList.appendChild(wrap);
    }
  }

  function renderChoices(choices) {
    clearNode(choicesWrap);

    const arr = safeArray(choices);
    if (!arr.length) {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.innerHTML = `<span class="cid">▶</span><span class="txt">다음</span><span class="hint">계속 진행</span>`;
      btn.addEventListener("click", () => choose(null));
      choicesWrap.appendChild(btn);
      return;
    }

    for (const ch of arr) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";

      const id = ch.id ?? 0;
      const txt = escapeText(ch.text ?? "");
      const hint = escapeText(ch.effectsHint ?? "");

      btn.innerHTML = `
        <span class="cid">${id}</span>
        <span class="txt">${txt}</span>
        ${hint ? `<span class="hint">${hint}</span>` : ""}
      `;

      btn.addEventListener("click", () => choose(id));
      choicesWrap.appendChild(btn);
    }
  }

  function renderMeta(chapter) {
    const c = chapter || {};
    const y = c.schoolYear ?? state.meta.lastSchoolYear ?? 1;
    const term = c.term ?? state.meta.lastTerm ?? "Fall";
    const arcTitle = c.arcTitle ? ` · ${c.arcTitle}` : "";
    const scene = c.sceneTitle || "—";
    const loc = c.location || "—";
    const time = c.time || "—";

    chapterText.textContent = `${y}학년 ${term}${arcTitle}`;
    sceneTitle.textContent = scene;
    sceneSub.textContent = `${loc} · ${time}`;

    state.meta.lastSchoolYear = y;
    state.meta.lastTerm = term;
  }

  function renderScene(scene) {
    lastScene = scene;

    renderMeta(scene.chapter);
    spotlight.textContent = scene.visuals?.spotlight ? `Spot: ${scene.visuals.spotlight}` : "—";

    renderVisuals(scene.visuals);

    narration.textContent = scene.narration || "";
    renderDialogueLines(scene.dialogue);
    renderChecks(scene.checks);
    renderChoices(scene.choices);

    // scroll text to top for new scene
    $("textBox").scrollTop = 0;

    // Update summaries
    updateStatsUI();
    updateRelSummaryUI();
  }

  // ---------- State Patch Apply ----------
  function applyStatePatch(patch) {
    const p = patch || {};

    // stats deltas (or absolute)
    if (p.stats && typeof p.stats === "object") {
      // interpret as deltas by default
      for (const k of ["focus", "talent", "reason", "bond"]) {
        const v = p.stats[k];
        if (typeof v === "number") {
          state.stats[k] = clamp((state.stats[k] ?? 0) + v, 0, 5);
        }
      }
    }

    // assets update
    if (p.assets && typeof p.assets === "object") {
      if (Array.isArray(p.assets.romanceCandidates)) {
        state.assets.romanceCandidates = p.assets.romanceCandidates;
      }
    }

    // relationships deltas
    for (const r of safeArray(p.relationships)) {
      const name = toRelKey(r.name);
      if (!name) continue;

      if (!state.relationships[name]) {
        state.relationships[name] = { friendship: 0, trust: 0, romance: 0, flags: [] };
      }
      const cur = state.relationships[name];

      cur.friendship = clamp(cur.friendship + (r.friendshipDelta || 0), 0, 10);
      cur.trust = clamp(cur.trust + (r.trustDelta || 0), 0, 10);
      cur.romance = clamp(cur.romance + (r.romanceDelta || 0), 0, 10);

      // flags
      cur.flags = Array.isArray(cur.flags) ? cur.flags : [];
      for (const f of safeArray(r.flagsAdd)) if (!cur.flags.includes(f)) cur.flags.push(f);
      for (const f of safeArray(r.flagsRemove)) cur.flags = cur.flags.filter((x) => x !== f);
    }

    // global flags
    state.globalFlags = Array.isArray(state.globalFlags) ? state.globalFlags : [];
    for (const f of safeArray(p.globalFlagsAdd)) if (!state.globalFlags.includes(f)) state.globalFlags.push(f);
    for (const f of safeArray(p.globalFlagsRemove)) state.globalFlags = state.globalFlags.filter((x) => x !== f);

    updateStatsUI();
    updateRelSummaryUI();
  }

  // ---------- API ----------
  async function callStoryAPI({ choiceId = null, userText = "" } = {}) {
    const endpoint = (apiUrlInput?.value || "/api/story").trim() || "/api/story";

    const payload = {
      state,
      choiceId,
      userText: userText || "",
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${txt || "request failed"}`);
    }

    const data = await res.json();

    // If server returns {error, raw}, surface it
    if (data && data.error && data.raw) {
      console.warn("Model raw output:", data.raw);
      throw new Error("모델이 JSON 형식을 지키지 않았어. story.js의 safeJson/프롬프트를 확인해줘.");
    }

    return data;
  }

  async function startGame() {
    setLoading(true);
    try {
      const scene = await callStoryAPI({ choiceId: null, userText: "" });

      // apply patch BEFORE rendering (stats/relationships might change)
      applyStatePatch(scene.statePatch);

      renderScene(scene);

      showToast("시작!");
    } catch (e) {
      console.error(e);
      showToast(String(e.message || e), 2600);
    } finally {
      setLoading(false);
    }
  }

  async function choose(choiceId) {
    // Use pending user text once, then clear
    const extra = pendingUserText;
    pendingUserText = "";
    userText.value = "";

    setLoading(true);
    try {
      const scene = await callStoryAPI({ choiceId, userText: extra });

      applyStatePatch(scene.statePatch);
      renderScene(scene);

      // Auto-save lightweight
      autoSave();
    } catch (e) {
      console.error(e);
      showToast(String(e.message || e), 2600);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Save / Load ----------
  function autoSave() {
    try {
      const pack = { state, lastScene };
      localStorage.setItem(LS_KEY, JSON.stringify(pack));
    } catch {}
  }

  function manualSave() {
    autoSave();
    showToast("저장했어!");
  }

  function manualLoad() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return showToast("저장된 데이터가 없어.");
      const pack = JSON.parse(raw);
      if (pack?.state) state = pack.state;
      updateStatsUI();
      updateRelSummaryUI();

      if (pack?.lastScene) {
        lastScene = pack.lastScene;
        renderScene(lastScene);
        showToast("불러왔어!");
      } else {
        showToast("상태만 불러왔어. (장면 없음)");
      }
    } catch (e) {
      console.error(e);
      showToast("불러오기 실패. 저장 데이터가 손상된 것 같아.", 2400);
    }
  }

  function resetAll() {
    if (!confirm("정말 초기화할까? 저장 데이터도 지워져.")) return;
    localStorage.removeItem(LS_KEY);
    state = defaultState();
    lastScene = null;
    pendingUserText = "";
    userText.value = "";
    updateStatsUI();
    updateRelSummaryUI();
    showToast("초기화 완료");
    startGame();
  }

  // ---------- UI Wiring ----------
  function openPanel() {
    sidePanel.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    sidePanel.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleTheme() {
    const isDark = appRoot.getAttribute("data-theme") !== "light";
    if (isDark) {
      appRoot.setAttribute("data-theme", "light");
      themeToggle.setAttribute("aria-pressed", "false");
    } else {
      appRoot.setAttribute("data-theme", "dark");
      themeToggle.setAttribute("aria-pressed", "true");
    }
    localStorage.setItem("hogwarts_theme", appRoot.getAttribute("data-theme"));
  }

  function loadTheme() {
    const t = localStorage.getItem("hogwarts_theme");
    if (t === "light") {
      appRoot.setAttribute("data-theme", "light");
      themeToggle.setAttribute("aria-pressed", "false");
    } else {
      appRoot.setAttribute("data-theme", "dark");
      themeToggle.setAttribute("aria-pressed", "true");
    }
  }

  // optional: sendText just sets pending text for next choice
  function handleSendText() {
    const t = (userText.value || "").trim();
    if (!t) return showToast("텍스트가 비었어.");
    pendingUserText = t;
    showToast("다음 선택에 반영할게!");
  }

  function init() {
    // menu events
    menuBtn?.addEventListener("click", () => {
      const expanded = menuBtn.getAttribute("aria-expanded") === "true";
      expanded ? closePanel() : openPanel();
    });
    closePanelBtn?.addEventListener("click", closePanel);

    // Save/Load/Reset
    saveBtn?.addEventListener("click", manualSave);
    loadBtn?.addEventListener("click", manualLoad);
    resetBtn?.addEventListener("click", resetAll);

    // Theme
    themeToggle?.addEventListener("click", toggleTheme);
    loadTheme();

    // user text
    sendTextBtn?.addEventListener("click", handleSendText);
    userText?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSendText();
    });

    // initial UI
    updateStatsUI();
    updateRelSummaryUI();

    // autoload
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const pack = JSON.parse(raw);
        if (pack?.state) state = pack.state;
        if (pack?.lastScene) {
          lastScene = pack.lastScene;
          updateStatsUI();
          updateRelSummaryUI();
          renderScene(lastScene);
          showToast("세이브에서 이어서 시작!");
          return;
        }
      }
    } catch {}

    // start new
    startGame();
  }

  

  document.addEventListener("DOMContentLoaded", init);
})();
