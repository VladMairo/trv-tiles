const STORAGE_KEY = "trv_tile_picker_v1";

// База: 1..5, Дополнение: 6..10
const BASE_TILES = [1, 2, 3, 4, 5];
const EXP_TILES  = [6, 7, 8, 9, 10];

const IMG_EXT = "jpg"; // <- поменяй на "png", если нужно

const $ = (id) => document.getElementById(id);

function randInt(maxExclusive) { return Math.floor(Math.random() * maxExclusive); }
function choice(arr) { return arr[randInt(arr.length)]; }

function tileImagePathById(id) {
  // id вида "6b"
  return `img/trv_tile_${id}.${IMG_EXT}`;
}

// ---------- PWA: register service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ---------- state ----------
function buildRemainingTileNumbers(useExpansion) {
  const nums = [...BASE_TILES];
  if (useExpansion) nums.push(...EXP_TILES);
  return nums;
}

function defaultState(useExpansion = true) {
  return {
    useExpansion,
    started: false,
    blockedStarterSide: null, // "1a" или "1b"
    laidSides: [],            // ["1b","4a",...]
    remainingTileNumbers: buildRemainingTileNumbers(useExpansion), // физические тайлы (номера)
    undoStack: [],
    gameMode: false
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState(true);

  try {
    const s = JSON.parse(raw);
    const useExpansion = !!s.useExpansion;

    // пересобираем remaining по истории
    const all = new Set(buildRemainingTileNumbers(useExpansion));
    for (const id of (s.laidSides || [])) {
      const n = parseInt(id, 10);
      if (!Number.isNaN(n)) all.delete(n);
    }

    return {
      ...defaultState(useExpansion),
      ...s,
      useExpansion,
      remainingTileNumbers: [...all].sort((a,b)=>a-b),
      laidSides: Array.isArray(s.laidSides) ? s.laidSides : [],
      undoStack: Array.isArray(s.undoStack) ? s.undoStack : []
    };
  } catch {
    return defaultState(true);
  }
}

let state = loadState();

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ---------- UI ----------
function setCurrent(id) {
  const big = $("currentTile");
  const img = $("tileImg");
  const hint = $("hint");

  if (!id) {
    big.textContent = "—";
    img.src = "";
    img.alt = "";
    hint.textContent = "Нажми «Старт», затем «Следующий тайл»";
    return;
  }

  big.textContent = id.toUpperCase();
  img.src = tileImagePathById(id);
  img.alt = `Тайл ${id.toUpperCase()}`;

  hint.textContent = "Тайл выбран. Поехали!";
}

// ---------- animation ----------
let animTimer = null;

function startPickingAnim() { document.body.classList.add("picking"); }
function stopPickingAnim() {
  document.body.classList.remove("picking");
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
}

function animatePick(candidatesFn, commitPick, durationMs = 900, tickMs = 80) {
  startPickingAnim();

  const t0 = performance.now();
  animTimer = setInterval(() => {
    const now = performance.now();
    const candidates = candidatesFn();
    if (candidates.length) setCurrent(choice(candidates));

    if (now - t0 >= durationMs) {
      stopPickingAnim();
      commitPick();
      render();
    }
  }, tickMs);
}

// ---------- logic ----------
function startGame() {
  if (state.started) return;

  const candidatesFn = () => ["1a", "1b"];

  const commitPick = () => {
    const side = choice(["a", "b"]);
    const chosenId = `1${side}`;
    const blockedId = side === "a" ? "1b" : "1a";

    state.started = true;
    state.blockedStarterSide = blockedId;

    // физический тайл 1 использован => удаляем номер 1
    state.remainingTileNumbers = state.remainingTileNumbers.filter(n => n !== 1);

    state.laidSides.unshift(chosenId);
    state.undoStack.unshift({ type: "start" });

    saveState();
  };

  animatePick(candidatesFn, commitPick, 850, 90);
}

function nextTile() {
  if (!state.started) return;
  if (state.remainingTileNumbers.length === 0) return;

  const candidatesFn = () => {
    const out = [];
    for (const n of state.remainingTileNumbers) {
      if (n === 1) continue;
      out.push(`${n}a`, `${n}b`);
    }
    return out;
  };

  const commitPick = () => {
    const idx = randInt(state.remainingTileNumbers.length);
    const n = state.remainingTileNumbers[idx];

    const side = choice(["a", "b"]);
    const id = `${n}${side}`;

    // удаляем физический тайл номер n целиком
    state.remainingTileNumbers.splice(idx, 1);
    state.laidSides.unshift(id);

    state.undoStack.unshift({ type: "next", tileNumber: n, side });
    saveState();
  };

  animatePick(candidatesFn, commitPick, 950, 75);
}

function undo() {
  if (state.undoStack.length === 0) return;

  const last = state.undoStack.shift();

  if (last.type === "start") {
    const useExpansion = state.useExpansion;
    const gameMode = state.gameMode;
    state = defaultState(useExpansion);
    state.gameMode = gameMode;
    saveState();
    render();
    return;
  }

  if (last.type === "next") {
    const id = `${last.tileNumber}${last.side}`;

    const i = state.laidSides.indexOf(id);
    if (i >= 0) state.laidSides.splice(i, 1);

    state.remainingTileNumbers.push(last.tileNumber);
    state.remainingTileNumbers.sort((a,b)=>a-b);

    saveState();
    render();
  }
}

function resetGame() {
  const useExpansion = $("useExpansion").checked;
  const gameMode = state.gameMode;

  state = defaultState(useExpansion);
  state.gameMode = gameMode;

  saveState();
  render();
}

function onToggleExpansion() {
  if (state.started || state.laidSides.length > 0) {
    $("useExpansion").checked = state.useExpansion;
    return;
  }
  state.useExpansion = $("useExpansion").checked;
  state.remainingTileNumbers = buildRemainingTileNumbers(state.useExpansion);
  saveState();
  render();
}

function toggleGameMode() {
  state.gameMode = !state.gameMode;
  saveState();
  render();
}

function toggleHistory() {
  const list = $("history");
  const btn = $("btnHistory");
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", expanded ? "false" : "true");
  btn.textContent = expanded ? "Развернуть" : "Свернуть";
  list.style.display = expanded ? "none" : "block";
}

// ---------- render ----------
function render() {
  document.body.classList.toggle("gameMode", !!state.gameMode);
  const modeBtn = $("btnMode");
  modeBtn.setAttribute("aria-pressed", state.gameMode ? "true" : "false");
  modeBtn.textContent = state.gameMode ? "Обычный режим" : "Игровой режим";

  const currentId = state.laidSides.length ? state.laidSides[0] : null;
  setCurrent(currentId);

  $("remaining").textContent = state.remainingTileNumbers.length.toString();
  $("laidCount").textContent = state.laidSides.length.toString();
  $("blockedStarter").textContent = state.blockedStarterSide ? state.blockedStarterSide.toUpperCase() : "—";

  $("btnStart").disabled = state.started;
  $("btnNext").disabled = !state.started || state.remainingTileNumbers.length === 0;
  $("btnUndo").disabled = state.undoStack.length === 0;

  $("useExpansion").checked = !!state.useExpansion;
  $("useExpansion").disabled = state.started || state.laidSides.length > 0;

  const historyEl = $("history");
  historyEl.innerHTML = "";
  for (const id of state.laidSides) {
    const li = document.createElement("li");
    li.textContent = id.toUpperCase();
    historyEl.appendChild(li);
  }
}

// ---------- events ----------
$("btnStart").addEventListener("click", startGame);
$("btnNext").addEventListener("click", nextTile);
$("btnUndo").addEventListener("click", undo);
$("btnReset").addEventListener("click", resetGame);
$("useExpansion").addEventListener("change", onToggleExpansion);

$("btnMode").addEventListener("click", toggleGameMode);
$("btnHistory").addEventListener("click", toggleHistory);

render();