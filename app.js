const STORAGE_KEY = "trv_tile_picker_conveyor_v1";

// База: 1..5, Дополнение: 6..10
const BASE_TILES = [1, 2, 3, 4, 5];
const EXP_TILES  = [6, 7, 8, 9, 10];

const IMG_EXT = "jpg"; // <- поменяй на "png", если нужно

const $ = (id) => document.getElementById(id);

function randInt(maxExclusive) { return Math.floor(Math.random() * maxExclusive); }
function choice(arr) { return arr[randInt(arr.length)]; }
function tileImagePathById(id) { return `img/trv_tile_${id}.${IMG_EXT}`; }

// ---------- PWA: register service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ---------- helpers ----------
function makeSidesForNumbers(nums) {
  const sides = [];
  for (const n of nums) sides.push(`${n}a`, `${n}b`);
  return sides;
}
function otherSide(id) {
  const n = parseInt(id, 10);
  const side = id.endsWith("a") ? "a" : "b";
  return `${n}${side === "a" ? "b" : "a"}`;
}
function tileNumber(id) { return parseInt(id, 10); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- state model (3 fixed slots) ----------
/**
 * slots[0] = oldest (нижний)
 * slots[1] = middle (средний)
 * slots[2] = newest (верхний)
 */
function defaultState(useExpansion = true) {
  const nums = [...BASE_TILES, ...(useExpansion ? EXP_TILES : [])];

  return {
    useExpansion,
    started: false,
    blockedStarterSide: null,

    slots: [null, null, null], // {id,isStarter} or null

    pool: makeSidesForNumbers(nums), // пул СТОРОН
    usedSides: [],

    history: [],           // [{idx, id}] по порядку выкладывания
    nextHistoryIndex: 1,

    undoStack: []          // snapshots
  };
}

// миграция истории: если в старом сохранении были строки или дубли "2. 2. 5B"
function normalizeHistory(h) {
  const out = [];
  if (!Array.isArray(h)) return out;

  for (const item of h) {
    if (typeof item === "string") {
      // попытка вытащить id вида "5b" из строки
      const m = item.toLowerCase().match(/(\d{1,2}[ab])/);
      if (m) out.push({ idx: out.length + 1, id: m[1] });
      continue;
    }
    if (item && typeof item === "object") {
      let id = String(item.id || "").toLowerCase();

      // если id вдруг содержит индексы "2. 5b" — вытащим только "5b"
      const m = id.match(/(\d{1,2}[ab])/);
      if (m) id = m[1];

      if (id) out.push({ idx: out.length + 1, id });
    }
  }
  return out;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState(true);

  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return defaultState(true);

    // нормализация истории (фикс бага "2. 2. 5B")
    const hist = normalizeHistory(s.history);
    const nextIdx = hist.length + 1;

    // нормализация slots
    const slots = Array.isArray(s.slots) ? s.slots.slice(0,3) : [null,null,null];
    while (slots.length < 3) slots.push(null);

    return {
      ...defaultState(!!s.useExpansion),
      ...s,
      slots,
      history: hist,
      nextHistoryIndex: nextIdx
    };
  } catch {
    return defaultState(true);
  }
}

let state = loadState();
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ---------- UI render ----------
function setSlotUI(slotIndex, entry) {
  const tileEl = $(`tile${slotIndex}`);
  const imgEl = $(`img${slotIndex}`);

  if (!entry) {
    tileEl.textContent = "—";
    imgEl.src = "";
    imgEl.alt = "";
    return;
  }
  tileEl.textContent = entry.id.toUpperCase();
  imgEl.src = tileImagePathById(entry.id);
  imgEl.alt = `Тайл ${entry.id.toUpperCase()}`;
}

function renderSlots() {
  setSlotUI(2, state.slots[2]); // newest
  setSlotUI(1, state.slots[1]); // middle
  setSlotUI(0, state.slots[0]); // oldest
}

function render() {
  renderSlots();

  const count = state.slots.filter(Boolean).length;
  $("tableCount").textContent = String(count);
  $("remaining").textContent = String(state.pool.length);
  $("blockedStarter").textContent = state.blockedStarterSide ? state.blockedStarterSide.toUpperCase() : "—";

  $("btnStart").disabled = state.started;
  $("btnNext").disabled = !state.started;
  $("btnUndo").disabled = state.undoStack.length === 0;

  $("useExpansion").checked = !!state.useExpansion;
  $("useExpansion").disabled = state.started;

  // История: строго "N. ID"
  const historyEl = $("history");
  historyEl.innerHTML = "";
  for (const item of state.history) {
    const li = document.createElement("li");
    li.textContent = `${item.idx}. ${String(item.id).toUpperCase()}`;
    historyEl.appendChild(li);
  }

  $("hint").textContent = state.started
    ? "«НОВЫЙ ТАЙЛ» сбрасывает старейший (нижний), сдвигает остальные вниз и добавляет новый сверху."
    : "Нажми «СТАРТ + 2 ТАЙЛА»: выбор сверху → сдвиг → выбор → сдвиг → выбор.";
}

// ---------- picking animation (preview in newest slot) ----------
let pickTimer = null;
function startPicking() { document.body.classList.add("picking"); }
function stopPicking() {
  document.body.classList.remove("picking");
  if (pickTimer) { clearInterval(pickTimer); pickTimer = null; }
}

function previewNewest(id) {
  // показываем превью в UI, не меняя state
  setSlotUI(2, { id, isStarter: false });
}

function animatePickInNewest(candidatesFn, durationMs = 850, tickMs = 80) {
  return new Promise((resolve) => {
    startPicking();
    const t0 = performance.now();

    pickTimer = setInterval(() => {
      const now = performance.now();
      const candidates = candidatesFn();
      if (candidates.length) previewNewest(choice(candidates));

      if (now - t0 >= durationMs) {
        stopPicking();
        const finalCandidates = candidatesFn();
        resolve(finalCandidates.length ? choice(finalCandidates) : null);
      }
    }, tickMs);
  });
}

// ---------- core rules ----------
function addToHistory(id) {
  // id должен быть чистым, без "2. "
  const clean = String(id).toLowerCase().match(/(\d{1,2}[ab])/);
  if (!clean) return;

  state.history.push({ idx: state.nextHistoryIndex, id: clean[1] });
  state.nextHistoryIndex += 1;
}

function markUsed(id) {
  if (!state.usedSides.includes(id)) state.usedSides.push(id);
}

function removeBothSidesFromPool(id) {
  const n = tileNumber(id);
  const a = `${n}a`, b = `${n}b`;
  state.pool = state.pool.filter(x => x !== a && x !== b);
}

function returnOppositeIfAllowed(droppedId) {
  const opp = otherSide(droppedId);
  if (state.usedSides.includes(opp)) return;
  if (state.pool.includes(opp)) return;
  state.pool.push(opp);
}

function commitTileToNewest(id, isStarter) {
  // кладём тайл в верхний слот (newest)
  removeBothSidesFromPool(id);
  state.slots[2] = { id, isStarter: !!isStarter };

  markUsed(id);
  addToHistory(id);
}

// ---------- REAL move animation between slots ----------
function getInnerEl(slotIndex) {
  // slotIndex 2/1/0 => DOM ids slot2/slot1/slot0
  return document.querySelector(`#slot${slotIndex} .slotInner`);
}

function cloneInner(innerEl) {
  const clone = innerEl.cloneNode(true);
  clone.classList.remove("hiddenDuringMove");
  return clone;
}

async function animateShiftDownReal() {
  // Цель: переместить ВИЗУАЛЬНО контент:
  // newest (2) -> middle (1)
  // middle (1) -> oldest (0)
  // oldest (0) “уходит” (его уже могли сбросить правила)
  //
  // Мы делаем только анимацию переезда элементов. Состояние (state.slots) мы сдвигаем ОТДЕЛЬНО.

  const from2 = getInnerEl(2);
  const from1 = getInnerEl(1);

  const to1 = getInnerEl(1);
  const to0 = getInnerEl(0);

  // если нечего двигать — просто пауза
  const has2 = state.slots[2] !== null;
  const has1 = state.slots[1] !== null;

  if (!has2 && !has1) {
    await sleep(60);
    return;
  }

  // слой для движения
  const layer = document.createElement("div");
  layer.className = "moveLayer";
  document.body.appendChild(layer);

  const movers = [];

  function setupMove(fromEl, toEl) {
    const rFrom = fromEl.getBoundingClientRect();
    const rTo = toEl.getBoundingClientRect();

    const mover = document.createElement("div");
    mover.className = "mover";
    mover.style.width = `${rFrom.width}px`;
    mover.style.height = `${rFrom.height}px`;
    mover.style.transform = `translate3d(${rFrom.left}px, ${rFrom.top}px, 0)`;

    const cloned = cloneInner(fromEl);
    cloned.style.margin = "0";
    mover.appendChild(cloned);
    layer.appendChild(mover);

    movers.push({ mover, rFrom, rTo });
  }

  if (has2) setupMove(from2, to1);
  if (has1) setupMove(from1, to0);

  // скрываем оригиналы на время движения
  if (has2) from2.classList.add("hiddenDuringMove");
  if (has1) from1.classList.add("hiddenDuringMove");

  // next frame -> запускаем transition
  await sleep(16);
  for (const m of movers) {
    m.mover.style.transform = `translate3d(${m.rTo.left}px, ${m.rTo.top}px, 0)`;
  }

  // ждём окончания
  await sleep(360);

  // чистим
  if (has2) from2.classList.remove("hiddenDuringMove");
  if (has1) from1.classList.remove("hiddenDuringMove");
  layer.remove();
}

// ---------- GAME FLOW ----------

function pushUndo() {
  state.undoStack.unshift(JSON.stringify(state));
}

function shiftSlotsDownInState() {
  // newest -> middle, middle -> oldest, oldest -> null (освободится под возможный сброс отдельно)
  state.slots[0] = state.slots[1];
  state.slots[1] = state.slots[2];
  state.slots[2] = null;
}

async function startPlusTwo() {
  if (state.started) return;

  pushUndo();
  state.started = true;

  // 1) Выбор стартового в newest (верх)
  const starterPick = await animatePickInNewest(() => ["1a", "1b"], 800, 85);
  const starterId = starterPick || choice(["1a", "1b"]);
  state.blockedStarterSide = (starterId === "1a") ? "1b" : "1a";

  // Убираем обе стороны 1 из пула навсегда
  state.pool = state.pool.filter(x => x !== "1a" && x !== "1b");

  // Кладём стартер в newest (верх)
  commitTileToNewest(starterId, true);
  saveState();
  render();

  // 2) Shift down (реальная анимация), затем сдвиг в state
  await animateShiftDownReal();
  shiftSlotsDownInState();
  saveState();
  render();

  // 3) Выбор второго тайла в newest
  const pick2 = await animatePickInNewest(
    () => state.pool.filter(x => !x.startsWith("1")),
    900,
    75
  );
  if (pick2) {
    commitTileToNewest(pick2, false);
    saveState();
    render();
  }

  // 4) Shift down
  await animateShiftDownReal();
  shiftSlotsDownInState();
  saveState();
  render();

  // 5) Выбор третьего тайла в newest
  const pick3 = await animatePickInNewest(
    () => state.pool.filter(x => !x.startsWith("1")),
    900,
    75
  );
  if (pick3) {
    commitTileToNewest(pick3, false);
  }

  saveState();
  render();
}

async function nextWithDrop() {
  if (!state.started) return;

  pushUndo();

  // 1) Сбрасываем старейший (нижний слот 0)
  const dropped = state.slots[0];
  if (dropped) {
    if (!dropped.isStarter) returnOppositeIfAllowed(dropped.id);
  }

  // Освобождаем oldest
  state.slots[0] = null;

  saveState();
  render();

  // 2) Реальный shift down (анимация), затем state shift
  await animateShiftDownReal();
  shiftSlotsDownInState();
  saveState();
  render();

  // 3) Выбираем новый в newest (верх)
  const candidatesFn = () => state.pool.filter(x => !x.startsWith("1"));
  if (candidatesFn().length === 0) {
    saveState();
    render();
    return;
  }

  const picked = await animatePickInNewest(candidatesFn, 900, 75);
  if (picked) commitTileToNewest(picked, false);

  saveState();
  render();
}

// ---------- other actions ----------
function undo() {
  if (state.undoStack.length === 0) return;
  const snap = state.undoStack.shift();
  try {
    state = JSON.parse(snap);

    // на всякий — нормализуем историю после undo
    state.history = normalizeHistory(state.history);
    state.nextHistoryIndex = state.history.length + 1;

    saveState();
    render();
  } catch {
    resetGame();
  }
}

function resetGame() {
  const useExpansion = $("useExpansion").checked;
  state = defaultState(useExpansion);
  saveState();
  render();
}

function onToggleExpansion() {
  if (state.started) {
    $("useExpansion").checked = state.useExpansion;
    return;
  }
  const useExpansion = $("useExpansion").checked;
  state = defaultState(useExpansion);
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

// ---------- events ----------
$("btnStart").addEventListener("click", startPlusTwo);
$("btnNext").addEventListener("click", nextWithDrop);
$("btnUndo").addEventListener("click", undo);
$("btnReset").addEventListener("click", resetGame);
$("useExpansion").addEventListener("change", onToggleExpansion);
$("btnHistory").addEventListener("click", toggleHistory);

render();
