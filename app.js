const STORAGE_KEY = "trv_tile_picker_queue_v2";

// База: 1..5, Дополнение: 6..10
const BASE_TILES = [1, 2, 3, 4, 5];
const EXP_TILES  = [6, 7, 8, 9, 10];

const IMG_EXT = "jpg"; // <- поменяй на "png", если нужно

const $ = (id) => document.getElementById(id);

function randInt(maxExclusive) { return Math.floor(Math.random() * maxExclusive); }
function choice(arr) { return arr[randInt(arr.length)]; }

function tileImagePathById(id) {
  return `img/trv_tile_${id}.${IMG_EXT}`;
}

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

// ---------- state ----------
function defaultState(useExpansion = true) {
  const nums = [...BASE_TILES, ...(useExpansion ? EXP_TILES : [])];
  return {
    useExpansion,
    started: false,
    blockedStarterSide: null,

    // table: FIFO очередь (oldest -> newest) по игровым правилам
    // Визуально показываем: newest сверху (slot2), middle (slot1), oldest снизу (slot0)
    table: [],

    pool: makeSidesForNumbers(nums), // пул СТОРОН
    usedSides: [],

    history: [],           // [{idx, id}] в порядке выкладывания
    nextHistoryIndex: 1,

    undoStack: []          // строковые снапшоты
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState(true);
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return defaultState(true);
    return s;
  } catch {
    return defaultState(true);
  }
}

let state = loadState();
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ---------- UI ----------
function setSlot(slotIndex, entry) {
  // slotIndex: 2=newest (top), 1=middle, 0=oldest (bottom)
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

function renderTable() {
  // table хранится как FIFO: [oldest, middle, newest]
  const oldest = state.table[0] || null;
  const middle = state.table[1] || null;
  const newest = state.table[2] || null;

  // визуально:
  setSlot(2, newest);
  setSlot(1, middle);
  setSlot(0, oldest);
}

function render() {
  renderTable();

  $("tableCount").textContent = state.table.length.toString();
  $("remaining").textContent = state.pool.length.toString();
  $("blockedStarter").textContent = state.blockedStarterSide ? state.blockedStarterSide.toUpperCase() : "—";

  $("btnStart").disabled = state.started;
  $("btnNext").disabled = !state.started;
  $("btnUndo").disabled = state.undoStack.length === 0;

  $("useExpansion").checked = !!state.useExpansion;
  $("useExpansion").disabled = state.started;

  // история: 1..N по порядку выкладывания
  const historyEl = $("history");
  historyEl.innerHTML = "";
  for (const item of state.history) {
    const li = document.createElement("li");
    li.textContent = `${item.idx}. ${item.id.toUpperCase()}`;
    historyEl.appendChild(li);
  }

  $("hint").textContent = state.started
    ? "Нажимай «Новый тайл», чтобы сбрасывать старейший и добавлять новый в верхний слот."
    : "Нажми «Старт + 2 тайла», чтобы заполнить конвейер из 3 тайлов.";
}

// ---------- animations ----------
let pickTimer = null;

function startPicking() { document.body.classList.add("picking"); }
function stopPicking() {
  document.body.classList.remove("picking");
  if (pickTimer) { clearInterval(pickTimer); pickTimer = null; }
}

function startSlideDown() { document.body.classList.add("slidingDown"); }
function stopSlideDown() { document.body.classList.remove("slidingDown"); }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Анимация рандома в верхнем слоте (newest / tile2)
function animatePickInNewest(candidatesFn, durationMs = 850, tickMs = 80) {
  return new Promise((resolve) => {
    startPicking();
    const t0 = performance.now();

    pickTimer = setInterval(() => {
      const now = performance.now();
      const candidates = candidatesFn();
      if (candidates.length) {
        // превью только в верхний слот (newest)
        setSlot(2, { id: choice(candidates), isStarter: false });
      }

      if (now - t0 >= durationMs) {
        stopPicking();
        const finalCandidates = candidatesFn();
        const picked = finalCandidates.length ? choice(finalCandidates) : null;
        resolve(picked);
      }
    }, tickMs);
  });
}

// “Сдвиг вниз” визуально + обновление таблицы по факту
async function slideDownOnce() {
  startSlideDown();
  await sleep(220);   // время “проседания”
  stopSlideDown();
  await sleep(20);
}

// ---------- core rules ----------
function addToHistory(id) {
  state.history.push({ idx: state.nextHistoryIndex, id });
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

// Добавляем новый тайл в конец очереди (как newest)
function commitNewTileToTable(id, isStarter) {
  removeBothSidesFromPool(id);
  state.table.push({ id, isStarter: !!isStarter });
  markUsed(id);
  addToHistory(id);
}

// ---------- START: staged conveyor sequence ----------
async function startPlusTwo() {
  if (state.started) return;

  // undo snapshot
  state.undoStack.unshift(JSON.stringify(state));

  state.started = true;

  // убираем стартовые стороны из пула после выбора (но пока оставим кандидаты для анимации)
  const pickStarter = await animatePickInNewest(() => ["1a", "1b"], 800, 85);
  const starterId = pickStarter || choice(["1a", "1b"]);
  state.blockedStarterSide = (starterId === "1a") ? "1b" : "1a";

  // Коммитим стартовый: он должен попасть на стол как newest (пока единственный)
  // Убираем обе стороны тайла 1 из пула НАВСЕГДА
  state.pool = state.pool.filter(x => x !== "1a" && x !== "1b");
  state.table = [];
  commitNewTileToTable(starterId, true);

  saveState();
  render();

  // Сдвиг: newest (стартер) -> middle
  await slideDownOnce();
  // (по факту сдвиг в данных — это просто то, что позже добавятся новые newest,
  // а стартер станет middle, затем oldest по FIFO)
  // В данных ничего “перекладывать” не нужно: FIFO сам решит позиции.
  // Но чтобы визуально было “переехало”, достаточно перерендера после добавлений.

  // Выбор 2-го тайла (не стартовый)
  const pick2 = await animatePickInNewest(
    () => state.pool.filter(x => !x.startsWith("1")),
    900,
    75
  );
  if (pick2) {
    commitNewTileToTable(pick2, false);
    saveState();
    render();
  }

  // Сдвиг: middle -> oldest, newest -> middle
  await slideDownOnce();

  // Выбор 3-го тайла (не стартовый)
  const pick3 = await animatePickInNewest(
    () => state.pool.filter(x => !x.startsWith("1")),
    900,
    75
  );
  if (pick3) {
    commitNewTileToTable(pick3, false);
    saveState();
    render();
  }

  saveState();
  render();
}

// ---------- NEXT: drop oldest, slide, pick new in newest ----------
async function nextWithDrop() {
  if (!state.started) return;

  // undo snapshot
  state.undoStack.unshift(JSON.stringify(state));

  // 1) сбрасываем oldest (первый в FIFO)
  const dropped = state.table.shift();
  if (dropped) {
    if (!dropped.isStarter) {
      returnOppositeIfAllowed(dropped.id);
    }
  }

  saveState();
  render();

  // 2) “сдвиг вниз” визуально (оставшиеся поднимаются по роли: newest->middle, middle->oldest)
  await slideDownOnce();
  renderTable(); // просто обновим табличку (на всякий)

  // 3) выбираем новый в newest (верх)
  const candidatesFn = () => state.pool.filter(x => !x.startsWith("1"));
  if (candidatesFn().length === 0) {
    saveState();
    render();
    return;
  }

  const picked = await animatePickInNewest(candidatesFn, 900, 75);
  if (picked) {
    commitNewTileToTable(picked, false);
  }

  saveState();
  render();
}

// ---------- other actions ----------
function undo() {
  if (state.undoStack.length === 0) return;
  const snap = state.undoStack.shift();
  try {
    state = JSON.parse(snap);
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
