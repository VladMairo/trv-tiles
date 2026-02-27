const STORAGE_KEY = "trv_tile_picker_queue_v1";

// База: 1..5, Дополнение: 6..10
const BASE_TILES = [1, 2, 3, 4, 5];
const EXP_TILES  = [6, 7, 8, 9, 10];

const IMG_EXT = "jpg"; // поменяй на "png", если у тебя png

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

// ---------- model helpers ----------
function makeSidesForNumbers(nums) {
  const sides = [];
  for (const n of nums) {
    sides.push(`${n}a`, `${n}b`);
  }
  return sides;
}

function otherSide(id) {
  const n = parseInt(id, 10);
  const side = id.endsWith("a") ? "a" : "b";
  const other = side === "a" ? "b" : "a";
  return `${n}${other}`;
}

function tileNumber(id) {
  return parseInt(id, 10);
}

// ---------- state ----------
function defaultState(useExpansion = true) {
  const nums = [...BASE_TILES, ...(useExpansion ? EXP_TILES : [])];

  return {
    useExpansion,

    started: false,
    blockedStarterSide: null,    // "1a" или "1b" — сторона стартового, которая никогда не появится
    table: [],                   // очередь из 3 элементов: [{id, isStarter}]
    pool: makeSidesForNumbers(nums), // ПУЛ СТОРОН: ["1a","1b","2a","2b",...]
    usedSides: [],               // стороны, которые уже когда-либо выпадали (для правила возврата)
    history: [],                 // по порядку выкладывания: [{id, idx}]
    nextHistoryIndex: 1,

    undoStack: []
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState(true);

  try {
    const s = JSON.parse(raw);
    // мягкая валидация
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

function render() {
  // table slots
  setSlot(0, state.table[0] || null);
  setSlot(1, state.table[1] || null);
  setSlot(2, state.table[2] || null);

  $("tableCount").textContent = state.table.length.toString();
  $("remaining").textContent = state.pool.length.toString();
  $("blockedStarter").textContent = state.blockedStarterSide ? state.blockedStarterSide.toUpperCase() : "—";

  $("btnStart").disabled = state.started;
  $("btnNext").disabled = !state.started;
  $("btnUndo").disabled = state.undoStack.length === 0;

  $("useExpansion").checked = !!state.useExpansion;
  $("useExpansion").disabled = state.started;

  // history: ПОРЯДОК ВЫКЛАДЫВАНИЯ (1..N)
  const historyEl = $("history");
  historyEl.innerHTML = "";
  for (const item of state.history) {
    const li = document.createElement("li");
    li.textContent = `${item.idx}. ${item.id.toUpperCase()}`;
    historyEl.appendChild(li);
  }

  // hint
  const hint = $("hint");
  if (!state.started) {
    hint.textContent = "Нажми «Старт + 2 тайла», чтобы выложить первые 3 тайла.";
  } else {
    hint.textContent = "Нажимай «Новый тайл», чтобы сбрасывать самый старый и добавлять новый.";
  }
}

// ---------- animation ----------
let animTimer = null;

function startPickingAnim() { document.body.classList.add("picking"); }
function stopPickingAnim() {
  document.body.classList.remove("picking");
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
}

function animatePick(candidatesFn, previewFn, commitPick, durationMs = 850, tickMs = 80) {
  startPickingAnim();
  const t0 = performance.now();

  animTimer = setInterval(() => {
    const now = performance.now();
    const candidates = candidatesFn();
    if (candidates.length) previewFn(choice(candidates));

    if (now - t0 >= durationMs) {
      stopPickingAnim();
      commitPick();
      render();
    }
  }, tickMs);
}

// Для превью при анимации: показываем только будущий "Новейший" слот (2)
function previewNewest(id) {
  setSlot(2, { id, isStarter: false });
}

// ---------- core rules ----------
function removeBothSidesFromPool(id) {
  // удаляем выбранную сторону и противоположную (физический тайл ушёл на стол)
  const n = tileNumber(id);
  const a = `${n}a`;
  const b = `${n}b`;
  state.pool = state.pool.filter(x => x !== a && x !== b);
}

function addToHistory(id) {
  state.history.push({ idx: state.nextHistoryIndex, id });
  state.nextHistoryIndex += 1;
}

function markUsed(id) {
  if (!state.usedSides.includes(id)) state.usedSides.push(id);
}

// При сбросе обычного тайла возвращаем в пул ТОЛЬКО противоположную сторону,
// но только если она НИКОГДА не выпадала раньше.
function returnOppositeIfAllowed(droppedId) {
  const opp = otherSide(droppedId);

  if (state.usedSides.includes(opp)) return;      // уже выпадала раньше => не возвращаем
  if (state.pool.includes(opp)) return;           // уже в пуле => не дублируем

  state.pool.push(opp);
}

// ---------- gameplay actions ----------
function startPlusTwo() {
  if (state.started) return;

  // Сохраняем снапшот для undo
  state.undoStack.unshift(JSON.stringify(state));

  // 1) Стартовый: выбираем 1a/1b
  const starterId = choice(["1a", "1b"]);
  const blocked = starterId === "1a" ? "1b" : "1a";

  state.started = true;
  state.blockedStarterSide = blocked;

  // Убираем обе стороны тайла 1 из пула навсегда (и блокируем вторую сторону)
  state.pool = state.pool.filter(x => x !== "1a" && x !== "1b");

  state.table = [{ id: starterId, isStarter: true }];
  markUsed(starterId);
  addToHistory(starterId);

  // 2) Добавляем ещё 2 тайла (обычные)
  for (let i = 0; i < 2; i++) {
    pickAndPushNewTile();
  }

  saveState();
  render();
}

function pickAndPushNewTile() {
  // Выбираем случайную сторону из пула, но запрещаем стартовые (их уже нет в пуле, но на всякий случай)
  const candidates = state.pool.filter(x => !x.startsWith("1"));
  if (candidates.length === 0) return; // пул пуст

  const id = choice(candidates);

  // Физический тайл кладём на стол: обе стороны уходят из пула
  removeBothSidesFromPool(id);

  // На стол добавляем запись
  state.table.push({ id, isStarter: false });

  markUsed(id);
  addToHistory(id);
}

function nextWithDrop() {
  if (!state.started) return;

  // Сохраняем снапшот для undo
  state.undoStack.unshift(JSON.stringify(state));

  // 1) Сбрасываем самый старый
  const dropped = state.table.shift(); // FIFO

  if (dropped) {
    if (dropped.isStarter) {
      // стартовый никогда не возвращается — ничего не делаем
    } else {
      returnOppositeIfAllowed(dropped.id);
    }
  }

  // 2) Добавляем новый тайл, чтобы снова стало 3
  // (если пул пуст, то просто останется меньше)
  if (state.table.length < 3) {
    // анимация выбора нового тайла, если есть кандидаты
    const candidatesFn = () => state.pool.filter(x => !x.startsWith("1"));
    const commitPick = () => {
      // commitPick должен сделать реальный выбор так же, как pickAndPushNewTile,
      // но чтобы соответствовать превью — мы делаем новый выбор снова (это нормально),
      // либо можно усложнить и фиксировать выбранный id. Сделаем фиксирование:
      const candidates = candidatesFn();
      if (candidates.length === 0) return;
      const id = choice(candidates);

      removeBothSidesFromPool(id);
      state.table.push({ id, isStarter: false });
      markUsed(id);
      addToHistory(id);

      saveState();
    };

    // Если кандидатов нет — просто рендер
    if (candidatesFn().length === 0) {
      saveState();
      render();
      return;
    }

    // Запускаем анимацию (превью нового тайла в третьем слоте)
    animatePick(
      candidatesFn,
      previewNewest,
      commitPick,
      950,
      75
    );

    return; // render будет после анимации
  }

  saveState();
  render();
}

function undo() {
  if (state.undoStack.length === 0) return;
  const snap = state.undoStack.shift();
  try {
    state = JSON.parse(snap);
    saveState();
    render();
  } catch {
    // если что-то пошло не так — просто сброс
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
  state.useExpansion = $("useExpansion").checked;
  state = defaultState(state.useExpansion);
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
