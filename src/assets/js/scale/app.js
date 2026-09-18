// src/assets/js/scale/app.js
import { brewState, handleTimemoreData, resetDecoderState } from "./timemore-decoder.js";
import { BLEManager } from "./ble-manager.js";
import { saveExtraction, exportData, getAllExtractions, deleteExtraction } from "./db.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/simple-scale/sw.js").catch((err) => {
      console.warn("Service Worker falhou:", err);
    });
  });
}

const UI = {
  body: document.body,
  btnConnect: document.getElementById("btn-connect"),
  btnTare: document.getElementById("btn-tare"),
  btnTimer: document.getElementById("btn-timer"),
  timerIcon: document.getElementById("timer-icon"),
  valTime: document.getElementById("val-time"),
  valWeight: document.getElementById("val-weight"),
  valFlowNum: document.getElementById("val-flow-numeric"),
  stableDot: document.getElementById("stable-dot"),
  statusBadge: document.getElementById("status-indicator"),
  documentElement: document.documentElement,

  actionFooter: document.getElementById("action-footer"),
  btnDose: document.getElementById("btn-dose"),
  btnRatio: document.getElementById("btn-ratio"),
  btnMethod: document.getElementById("btn-method"),
  liveProgress: document.getElementById("live-progress-fill"),
  liveTicks: document.getElementById("live-ticks-container"),
  overpourProgress: document.getElementById("overpour-fill"),
};

// --- MODO CAMALEÃO (Detecção de Bluefy) ---
const isBluefy = navigator.userAgent.toLowerCase().includes("bluefy");
if (isBluefy) {
  document.body.classList.add("theme-bluefy");
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", "#0a0a0a");
  }
}

const UIStats = {
  screen: document.getElementById("stats-screen"),
  btnClose: document.getElementById("btn-close-stats"),
  btnExport: document.getElementById("btn-export"),
  valBrews: document.getElementById("stat-brews"),
  valAvgTime: document.getElementById("stat-avg-time"),
  valAvgYield: document.getElementById("stat-avg-yield"),
  valAvgPours: document.getElementById("stat-avg-pours"),
  valTotalCoffee: document.getElementById("stat-total-coffee"),
};

const sliderPatternCache = new Map();

function revealAppShell() {
  document.body.classList.remove("state-disconnected");
  document.body.classList.remove("is-ready");
  document.body.classList.add("is-transitioning");

  requestAnimationFrame(() => {
    setTimeout(() => {
      document.body.classList.add("is-ready");
      setTimeout(() => {
        document.body.classList.remove("is-transitioning");
      }, 220);
    }, 40);
  });
}

function triggerReturnTransition() {
  document.body.classList.remove("app-return-transition");
  void document.body.offsetWidth;
  document.body.classList.add("app-return-transition");
  setTimeout(() => document.body.classList.remove("app-return-transition"), 520);
}

function revealPageFrame(target) {
  if (!target) return;

  target.classList.remove("is-visible");
  requestAnimationFrame(() => {
    target.classList.add("is-visible");
  });
}

// --- ESTADO GLOBAL DA APLICAÇÃO ---
const TIMER_STATE = {
  IDLE: 0,
  RUNNING: 1,
  DONE: 2,
};
let currentTimerState = TIMER_STATE.IDLE;

const advancedState = {
  dose: 15.0,
  ratio: 15.0,
  targetYield: 225.0,
  tetsuMode: true,
  poursCount: 5,
  method: "4:6",
  pours: [],
};

// Carregamento de Perfil Persistido
try {
  const savedProfile = localStorage.getItem("simple_scale_profile");
  if (savedProfile) {
    const parsed = JSON.parse(savedProfile);
    if (typeof parsed.dose === "number") advancedState.dose = parsed.dose;
    if (typeof parsed.ratio === "number") advancedState.ratio = parsed.ratio;
    advancedState.targetYield = advancedState.dose * advancedState.ratio;
    if (UI.btnDose) UI.btnDose.textContent = `${advancedState.dose}g`;
    if (UI.btnRatio) UI.btnRatio.textContent = `1:${advancedState.ratio}`;
    renderAdaptiveTicks();
  }
} catch (e) {
  console.warn("Falha ao recuperar perfil local:", e);
}

let liveTicksData = [];
let currentPourIndex = 0;
let isCurrentlyPouring = false;
let isPourDebouncing = false;
let stopPourTimeout = 0; // Armazena tempo em segundos via performance.now()

let isSimulating = false;
let simTime = 0;
let simWeight = 0;
let brewBaselineWeight = 0;
let FLOW_HISTORY = [];
const maxHistorySize = 5000;
const canvas = document.getElementById("flow-canvas");
const ctx = canvas ? canvas.getContext("2d") : null;
let scrollTime = 0;
let isDragging = false;
let lastClientX = 0;

// --- GERENCIADOR DE ENERGIA E INATIVIDADE ---
let wakeLock = null;
let idleTimeout = null;
const IDLE_LIMIT_MS = 5 * 60 * 1000;
const MAX_RUN_LIMIT_MS = 10 * 60 * 1000;
let wakeLockRecoveryPending = false;

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && wakeLock === null) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLockRecoveryPending = false;

      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        wakeLockRecoveryPending = true;
      });
    }
  } catch (err) {
    console.warn("Wake Lock bloqueado pelo OS. Armadilhado para o próximo toque.");
    wakeLockRecoveryPending = true;
  }
}

function dropConnection() {
  if (isSimulating) return;
  bleManager.disconnect();

  UI.body.classList.add("state-disconnected");
  UI.btnConnect.textContent = "connect";
  UI.btnConnect.classList.remove("pulse-cursor");
  currentTimerState = TIMER_STATE.IDLE;
  UI.timerIcon.src = "/icons/scale/play.svg";
  wakeLockRecoveryPending = false;

  if (wakeLock !== null) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function resetIdleTimer() {
  clearTimeout(idleTimeout);
  const timeoutLimit = currentTimerState === TIMER_STATE.RUNNING ? MAX_RUN_LIMIT_MS : IDLE_LIMIT_MS;
  idleTimeout = setTimeout(() => dropConnection(), timeoutLimit);
}

window.addEventListener("pointerdown", () => {
  resetIdleTimer();
  if (wakeLockRecoveryPending && !UI.body.classList.contains("state-disconnected")) {
    requestWakeLock();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (currentTimerState !== TIMER_STATE.RUNNING) dropConnection();
  } else {
    if (wakeLock === null && !UI.body.classList.contains("state-disconnected")) {
      requestWakeLock();
    }
    resetIdleTimer();
  }
});

const timeStrs = new Array(60);
for (let i = 0; i < 60; i++) {
  timeStrs[i] = i < 10 ? "0" + i : i.toString();
}

const bleManager = new BLEManager(handleTimemoreData, (isConnected) => {
  if (isConnected) {
    UI.body.classList.remove("state-disconnected", "state-reconnecting");
    UI.statusBadge.classList.add("active");
    UI.btnConnect.classList.remove("pulse-cursor");
    resetDecoderState();
    resetIdleTimer();
  } else {
    UI.statusBadge.classList.remove("active");
    if (currentTimerState === TIMER_STATE.RUNNING) {
      brewState.flowRateEMA = 0;
      UI.body.classList.add("state-reconnecting");
    }
  }
});

window.addEventListener("pagehide", () => {
  if (currentTimerState === TIMER_STATE.RUNNING || currentTimerState === TIMER_STATE.DONE) {
    processAndSaveExtraction(true);
  }
});

// ============================================================================
// --- OVERLAY DE CONFIGURAÇÃO (AUTO-SAVE & GESTOS)
// ============================================================================
const UIConfig = {
  screen: document.getElementById("config-screen"),
  navHeader: document.querySelector("#config-screen .stats-nav"),
  btnClose: document.getElementById("btn-close-config"),
  sliderDose: document.getElementById("cfg-slider-dose"),
  sliderRatio: document.getElementById("cfg-slider-ratio"),
  valDose: document.getElementById("cfg-val-dose"),
  valRatio: document.getElementById("cfg-val-ratio"),
  valYield: document.getElementById("cfg-val-yield"),
};

function buildTrackPattern({ min, max, step, majorStep = 1 }) {
  const cacheKey = `${min}:${max}:${step}:${majorStep}`;
  const cached = sliderPatternCache.get(cacheKey);
  if (cached) return cached;

  const width = 1000;
  const height = 40;
  const inset = 30;
  const innerWidth = width - inset * 2;
  const lines = [];
  const totalSteps = (max - min) / step;

  for (let index = 0; index <= totalSteps; index++) {
    const value = min + index * step;
    const x = inset + (index / totalSteps) * innerWidth;
    const isMajor = Math.abs((value - min) % majorStep) < 0.0001 || value >= max - 0.0001;
    const length = isMajor ? 18 : 10;
    const y = (height - length) / 2;
    const alpha = isMajor ? 0.9 : 0.5;

    lines.push(
      `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x.toFixed(2)}" y2="${(y + length).toFixed(2)}" stroke="rgba(255,255,255,${alpha})" stroke-width="1" />`,
    );
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="transparent" />
      ${lines.join("")}
    </svg>
  `;

  const pattern = `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}")`;
  sliderPatternCache.set(cacheKey, pattern);
  return pattern;
}

function applySliderTrackPattern(slider, config) {
  if (!slider) return;
  slider.style.setProperty("--track-pattern", buildTrackPattern(config));
}

function snapSliderToTicks(slider) {
  if (!slider) return;

  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const step = Number(slider.step || 1);
  const value = Number(slider.value || min);
  const snapped = Math.round((value - min) / step) * step + min;
  const progress = (snapped - min) / (max - min || 1);
  const shift = (progress - 0.5) * 20;

  slider.value = snapped.toString();
  slider.style.setProperty("--track-shift", `${shift}px`);
}

function updateSliderMotion(slider) {
  if (!slider) return;

  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const step = Number(slider.step || 1);
  const value = Number(slider.value || min);
  const snapped = Math.round((value - min) / step) * step + min;
  const progress = (snapped - min) / (max - min || 1);
  const shift = (progress - 0.5) * 20;

  slider.style.setProperty("--track-shift", `${shift}px`);
  slider.value = snapped.toString();
}

function autoSaveRecipe(newDose, newRatio) {
  advancedState.dose = newDose;
  advancedState.ratio = newRatio;
  advancedState.targetYield = newDose * newRatio;

  if (UIConfig.valDose) UIConfig.valDose.textContent = newDose.toFixed(1);
  if (UIConfig.valRatio) UIConfig.valRatio.textContent = newRatio.toFixed(1);
  if (UIConfig.valYield)
    UIConfig.valYield.textContent = Math.round(advancedState.targetYield).toString();

  if (UI.btnDose && UI.btnDose.textContent !== "CT") {
    UI.btnDose.textContent = `${newDose}g`;
  }
  if (UI.btnRatio) {
    UI.btnRatio.textContent = `1:${newRatio}`;
  }

  applySliderTrackPattern(UIConfig.sliderDose, { min: 5, max: 40, step: 0.5, majorStep: 5 });
  applySliderTrackPattern(UIConfig.sliderRatio, { min: 10, max: 22, step: 0.5, majorStep: 1 });
  updateSliderMotion(UIConfig.sliderDose);
  updateSliderMotion(UIConfig.sliderRatio);
  renderAdaptiveTicks();

  try {
    localStorage.setItem(
      "simple_scale_profile",
      JSON.stringify({
        dose: advancedState.dose,
        ratio: advancedState.ratio,
        targetYield: advancedState.targetYield,
      }),
    );
  } catch (err) {
    console.warn("Falha ao salvar receita automaticamente:", err);
  }
}

function openConfig() {
  if (currentTimerState !== TIMER_STATE.IDLE) return;
  if (UIConfig.sliderDose) UIConfig.sliderDose.value = advancedState.dose;
  if (UIConfig.sliderRatio) UIConfig.sliderRatio.value = advancedState.ratio;

  applySliderTrackPattern(UIConfig.sliderDose, { min: 5, max: 40, step: 0.5, majorStep: 5 });
  applySliderTrackPattern(UIConfig.sliderRatio, { min: 10, max: 22, step: 0.5, majorStep: 1 });
  updateSliderMotion(UIConfig.sliderDose);
  updateSliderMotion(UIConfig.sliderRatio);

  if (UIConfig.valDose) UIConfig.valDose.textContent = advancedState.dose.toFixed(1);
  if (UIConfig.valRatio) UIConfig.valRatio.textContent = advancedState.ratio.toFixed(1);
  if (UIConfig.valYield)
    UIConfig.valYield.textContent = Math.round(advancedState.targetYield).toString();

  if (UIConfig.screen) revealPageFrame(UIConfig.screen);
}

function closeConfig() {
  if (UIConfig.screen) {
    UIConfig.screen.classList.remove("is-visible");
  }
  triggerReturnTransition();
}

if (UIConfig.sliderDose) {
  UIConfig.sliderDose.addEventListener("input", (e) => {
    const dose = parseFloat(e.target.value);
    const ratio = parseFloat(UIConfig.sliderRatio?.value || advancedState.ratio);
    autoSaveRecipe(dose, ratio);
  });

  UIConfig.sliderDose.addEventListener("change", (e) => {
    snapSliderToTicks(e.target);
  });
}

if (UIConfig.sliderRatio) {
  UIConfig.sliderRatio.addEventListener("input", (e) => {
    const ratio = parseFloat(e.target.value);
    const dose = parseFloat(UIConfig.sliderDose?.value || advancedState.dose);
    autoSaveRecipe(dose, ratio);
  });

  UIConfig.sliderRatio.addEventListener("change", (e) => {
    snapSliderToTicks(e.target);
  });
}

if (UIConfig.btnClose) {
  UIConfig.btnClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeConfig();
  });
}

if (UIConfig.navHeader) {
  UIConfig.navHeader.addEventListener("click", closeConfig);
}

// ============================================================================
// --- GESTO DE ARRASTAR DA ESQUERDA PARA A DIREITA (SWIPE-TO-BACK)
// ============================================================================
function enableSwipeToDismiss(overlayEl, dismissCallback) {
  if (!overlayEl) return;

  let startX = 0;
  let startY = 0;
  let isTracking = false;

  overlayEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest("input[type='range'], .ruler-slider, button")) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      isTracking = true;
      overlayEl.classList.add("is-dragging");
      overlayEl.style.setProperty("--drag-offset", "0px");
      overlayEl.style.setProperty("--drag-amount", "0");
    },
    { passive: true },
  );

  overlayEl.addEventListener(
    "touchmove",
    (e) => {
      if (!isTracking) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 15) {
        isTracking = false;
        overlayEl.classList.remove("is-dragging");
        overlayEl.style.setProperty("--drag-offset", "0px");
        overlayEl.style.setProperty("--drag-amount", "0");
        return;
      }

      if (deltaX > 0) {
        const clamped = Math.min(deltaX, 110);
        const amount = Math.min(clamped / 110, 1);
        const peekOffset = Math.min(clamped * 0.28, 18);
        overlayEl.classList.add("is-dragging");
        overlayEl.style.setProperty("--drag-offset", `${peekOffset}px`);
        overlayEl.style.setProperty("--drag-amount", amount.toFixed(3));
      }
    },
    { passive: true },
  );

  overlayEl.addEventListener(
    "touchend",
    (e) => {
      if (!isTracking) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      isTracking = false;
      overlayEl.classList.remove("is-dragging");
      overlayEl.style.setProperty("--drag-offset", "0px");
      overlayEl.style.setProperty("--drag-amount", "0");

      if (deltaX > 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
        dismissCallback();
      }
    },
    { passive: true },
  );
}

enableSwipeToDismiss(UIConfig.screen, closeConfig);
enableSwipeToDismiss(UIStats.screen, () => {
  if (UIStats.screen) UIStats.screen.classList.remove("is-visible");
  triggerReturnTransition();
});

if (UIStats.btnClose) {
  UIStats.btnClose.addEventListener("click", () => {
    if (UIStats.screen) UIStats.screen.classList.remove("is-visible");
    triggerReturnTransition();
  });
}

// --- CONFIGURAÇÕES DO GRÁFICO ---
const MAX_FLOW_SCALE = 10;
const TIME_WINDOW = 20;

function resetExtraction() {
  if (typeof resetDecoderState === "function") resetDecoderState();
  brewState.time = 0;
  brewState.weight = 0;
  brewState.flowRateEMA = 0;
  brewState.isStable = true;
  simTime = 0;
  simWeight = 0;

  lastHardwareTime = 0;
  lastHardwareTimeChange = performance.now();

  const timeStep = 0.1;
  const pastPoints = 300;
  FLOW_HISTORY = Array.from({ length: pastPoints }, (_, i) => {
    return { flow: 0, time: -(pastPoints - i - 1) * timeStep };
  });

  brewState._isDirty = true;
}

function initGraph() {
  if (canvas) canvas.style.touchAction = "none";
  if (FLOW_HISTORY.length === 0) resetExtraction();
}

document.fonts.ready.then(() => {
  brewState._isDirty = true;
});

if (canvas) {
  canvas.addEventListener("pointerdown", (e) => {
    if (currentTimerState === TIMER_STATE.RUNNING) return;
    isDragging = true;
    lastClientX = e.clientX;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDragging || currentTimerState === TIMER_STATE.RUNNING) return;
    const deltaPx = e.clientX - lastClientX;
    const pxPerSec = (canvas.clientWidth - 25) / TIME_WINDOW;
    scrollTime += deltaPx / pxPerSec;
    lastClientX = e.clientX;
    brewState._isDirty = true;
  });
}

window.addEventListener("pointerup", () => {
  isDragging = false;
});

window.addEventListener("resize", initGraph);
document.addEventListener("DOMContentLoaded", () => {
  initGraph();
});

function renderFlowGraph(currentFlow, currentTime) {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  const nextWidth = Math.floor(rect.width * dpr);
  const nextHeight = Math.floor(rect.height * dpr);

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const canvasWidth = rect.width;
  const canvasHeight = rect.height;
  const lastRecord = FLOW_HISTORY[FLOW_HISTORY.length - 1];

  if (!lastRecord || currentTime > lastRecord.time) {
    FLOW_HISTORY.push({ flow: currentFlow, time: currentTime });
  }

  if (FLOW_HISTORY.length > maxHistorySize + 100) {
    FLOW_HISTORY.splice(0, 100);
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const Y_PADDING_TOP = 20;
  const Y_PADDING_BOTTOM = 25;
  const drawHeight = canvasHeight - Y_PADDING_TOP - Y_PADDING_BOTTOM;
  const X_PADDING_LEFT = 25;
  const drawWidth = canvasWidth - X_PADDING_LEFT;

  let latestTime = FLOW_HISTORY[FLOW_HISTORY.length - 1].time;
  let maxScrollTime = Math.max(0, latestTime - TIME_WINDOW);

  if (currentTimerState === TIMER_STATE.RUNNING) {
    scrollTime = 0;
  } else {
    scrollTime = Math.max(0, Math.min(scrollTime, maxScrollTime));
  }

  let viewEndTime = Math.max(TIME_WINDOW, latestTime) - scrollTime;
  let viewStartTime = viewEndTime - TIME_WINDOW;

  ctx.font = "10px 'Departure Mono', monospace";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(119, 119, 119, 0.7)";
  ctx.fillStyle = "rgba(119, 119, 119, 1)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= MAX_FLOW_SCALE; i += 2) {
    const y = canvasHeight - Y_PADDING_BOTTOM - (i / MAX_FLOW_SCALE) * drawHeight;
    ctx.beginPath();
    ctx.moveTo(X_PADDING_LEFT, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(X_PADDING_LEFT, 0, drawWidth, canvasHeight);
  ctx.clip();

  ctx.strokeStyle = "rgba(119, 119, 119, 0.7)";
  const TIME_INTERVAL = 15;
  let firstLine = Math.ceil(viewStartTime / TIME_INTERVAL) * TIME_INTERVAL;

  for (let T = firstLine; T <= viewEndTime; T += TIME_INTERVAL) {
    let x = X_PADDING_LEFT + ((T - viewStartTime) / TIME_WINDOW) * drawWidth;
    ctx.beginPath();
    ctx.moveTo(x, Y_PADDING_TOP);
    ctx.lineTo(x, canvasHeight - Y_PADDING_BOTTOM);
    ctx.stroke();

    if (T >= 0 && T % 15 === 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(T + "s", x, canvasHeight - Y_PADDING_BOTTOM + 6);
    }
  }

  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  let startedDrawingCurve = false;
  let prevX = 0,
    prevY = 0;

  // CULLING DE VIEWPORT: Identifica o primeiro ponto visível na janela
  let startIndex = 0;
  for (let i = 0; i < FLOW_HISTORY.length; i++) {
    if (FLOW_HISTORY[i].time >= viewStartTime - 1) {
      startIndex = Math.max(0, i - 1);
      break;
    }
  }

  // Itera exclusivamente sobre pontos dentro da janela visual
  for (let i = startIndex; i < FLOW_HISTORY.length; i++) {
    const ptTime = FLOW_HISTORY[i].time;
    if (ptTime < 0) continue;
    if (ptTime > viewEndTime + 1) break;

    const val = FLOW_HISTORY[i].flow;
    let currentX = X_PADDING_LEFT + ((ptTime - viewStartTime) / TIME_WINDOW) * drawWidth;
    let currentY = canvasHeight - Y_PADDING_BOTTOM - (val / MAX_FLOW_SCALE) * drawHeight;
    currentY = Math.max(Y_PADDING_TOP, Math.min(currentY, canvasHeight - Y_PADDING_BOTTOM));

    if (!startedDrawingCurve) {
      ctx.moveTo(currentX, currentY);
      prevX = currentX;
      prevY = currentY;
      startedDrawingCurve = true;
    } else {
      let midPointX = (prevX + currentX) / 2;
      let midPointY = (prevY + currentY) / 2;
      ctx.quadraticCurveTo(prevX, prevY, midPointX, midPointY);
      prevX = currentX;
      prevY = currentY;
    }
  }

  if (startedDrawingCurve) {
    ctx.lineTo(prevX, prevY);
    ctx.stroke();
  }
  ctx.restore();

  ctx.clearRect(0, 0, X_PADDING_LEFT, canvasHeight);
  ctx.fillStyle = "rgba(119, 119, 119, 1)";
  ctx.textAlign = "left";
  for (let i = 0; i <= MAX_FLOW_SCALE; i += 2) {
    const y = canvasHeight - Y_PADDING_BOTTOM - (i / MAX_FLOW_SCALE) * drawHeight;
    ctx.fillText(i.toString(), 5, y);
  }
}

function updateFlowVisuals(flowRate) {
  let ratio = flowRate / MAX_FLOW_SCALE;
  if (ratio > 1.0) ratio = 1.0;
  if (ratio < 0.0) ratio = 0.0;
  if (UI.documentElement) UI.documentElement.style.setProperty("--flow-ratio", ratio.toFixed(3));
  if (UI.valFlowNum) UI.valFlowNum.textContent = flowRate.toFixed(1) + " g/s";
}

// --- MOTOR ADAPTATIVO 4:6 (GERAÇÃO DE TICKS) ---
function renderAdaptiveTicks() {
  if (!UI.liveTicks) return;
  UI.liveTicks.innerHTML = "";
  liveTicksData = [];
  currentPourIndex = 0;
  isPourDebouncing = false;

  const totalWater = advancedState.targetYield;
  if (totalWater <= 0) return;

  if (advancedState.tetsuMode) {
    const weights = [
      totalWater * 0.2,
      totalWater * 0.4,
      totalWater * 0.6,
      totalWater * 0.8,
      totalWater * 1.0,
    ];

    weights.forEach((w, index) => {
      const pct = (w / totalWater) * 100;
      const tick = document.createElement("div");
      tick.className = `pour-tick ${index === 0 ? "tick-bloom" : ""}`;
      tick.style.left = `${Math.min(pct, 100)}%`;
      UI.liveTicks.appendChild(tick);

      liveTicksData.push({
        weight: w,
        dom: tick,
        passed: false,
      });
    });
  }
}

// --- FUNÇÃO DE RECALCULO DE FLUXO (4:6 ESTREITO COM FUSÃO) ---
function handlePourStop(activeWeight) {
  if (
    !advancedState.tetsuMode ||
    activeWeight >= advancedState.targetYield ||
    currentPourIndex >= liveTicksData.length
  ) {
    return;
  }

  const totalTarget = advancedState.targetYield;
  const phase1Target = totalTarget * 0.4;

  let currentTick = liveTicksData[currentPourIndex];
  currentTick.weight = activeWeight;
  currentTick.passed = true;
  const currentPct = (activeWeight / totalTarget) * 100;
  currentTick.dom.style.left = `${Math.min(currentPct, 100)}%`;

  currentTick.dom.classList.add("is-passed");
  setTimeout(() => currentTick.dom.classList.replace("is-passed", "is-settled"), 600);

  if (currentPourIndex === 0) {
    if (activeWeight >= phase1Target) {
      if (liveTicksData[1]) {
        liveTicksData[1].dom.classList.add("is-hidden");
        liveTicksData.splice(1, 1);
      }
      redistributePhase2(activeWeight);
    } else {
      if (liveTicksData[1]) {
        liveTicksData[1].weight = phase1Target;
        const p2Pct = (phase1Target / totalTarget) * 100;
        liveTicksData[1].dom.style.left = `${Math.min(p2Pct, 100)}%`;
      }
    }
  } else if (currentPourIndex === 1 && liveTicksData.length > 2) {
    redistributePhase2(activeWeight);
  } else {
    let nextIndex = currentPourIndex + 1;
    while (nextIndex < liveTicksData.length - 1) {
      let plannedNext = liveTicksData[nextIndex].weight;
      let prevWeight = liveTicksData[nextIndex - 1]?.weight || activeWeight;
      let nextInterval = plannedNext - prevWeight;

      if (activeWeight >= plannedNext - nextInterval * 0.5) {
        liveTicksData[nextIndex].dom.classList.add("is-hidden");
        liveTicksData.splice(nextIndex, 1);
      } else {
        break;
      }
    }

    let remainingPours = liveTicksData.length - 1 - currentPourIndex;
    if (remainingPours > 0) {
      let step = (totalTarget - activeWeight) / remainingPours;
      for (let i = currentPourIndex + 1; i < liveTicksData.length; i++) {
        let calcWeight = activeWeight + step * (i - currentPourIndex);
        liveTicksData[i].weight = calcWeight;
        const pct = (calcWeight / totalTarget) * 100;
        liveTicksData[i].dom.style.left = `${Math.min(pct, 100)}%`;
      }
    }
  }

  currentPourIndex++;
}

function redistributePhase2(currentWeight) {
  const totalTarget = advancedState.targetYield;
  const remainingWater = totalTarget - currentWeight;
  const remainingPours = liveTicksData.length - 1 - currentPourIndex;

  if (remainingPours > 0 && remainingWater > 0) {
    const step = remainingWater / remainingPours;
    for (let i = currentPourIndex + 1; i < liveTicksData.length; i++) {
      const calcWeight = currentWeight + step * (i - currentPourIndex);
      liveTicksData[i].weight = calcWeight;
      const pct = (calcWeight / totalTarget) * 100;
      liveTicksData[i].dom.style.left = `${Math.min(pct, 100)}%`;
    }
  }
}

let lastKnownWeight = 0;
let lastHardwareTime = 0;
let lastHardwareTimeChange = 0;

function renderFrame() {
  requestAnimationFrame(renderFrame);
  if (!brewState._isDirty) return;

  const now = performance.now();

  if (Math.abs(brewState.weight - lastKnownWeight) > 0.5) {
    resetIdleTimer();
    lastKnownWeight = brewState.weight;
  }

  if (brewState.time > lastHardwareTime) {
    if (currentTimerState === TIMER_STATE.IDLE) {
      brewBaselineWeight = brewState.weight;
      renderAdaptiveTicks();

      currentTimerState = TIMER_STATE.RUNNING;
      if (UI.timerIcon) UI.timerIcon.src = "/icons/scale/stop.svg";
      if (UI.actionFooter) UI.actionFooter.classList.add("is-running");
      resetIdleTimer();
    }
    lastHardwareTimeChange = now;
  } else if (brewState.time === lastHardwareTime && currentTimerState === TIMER_STATE.RUNNING) {
    if (!isSimulating && now - lastHardwareTimeChange > 2000) {
      console.log("Pause físico detectado na balança. Entrando em Review Mode.");
      currentTimerState = TIMER_STATE.DONE;
      if (UI.timerIcon) UI.timerIcon.src = "/icons/scale/restart.svg";

      let finalWaterHW = brewState.weight - brewBaselineWeight;
      if (finalWaterHW < 0) finalWaterHW = 0;
      let finalRatioHW =
        advancedState.dose > 0 ? (finalWaterHW / advancedState.dose).toFixed(1) : "0.0";

      if (UI.btnDose) UI.btnDose.textContent = `${advancedState.dose}g`;
      if (UI.btnRatio) UI.btnRatio.textContent = `1:${finalRatioHW}`;
      if (UI.btnMethod) UI.btnMethod.textContent = `↓`;

      if (UI.actionFooter) {
        UI.actionFooter.classList.remove("is-running");
        UI.actionFooter.classList.add("is-done");
      }
      resetIdleTimer();
    }
  }

  if (
    currentTimerState === TIMER_STATE.IDLE &&
    brewState.isStable &&
    brewState.weight >= 10.0 &&
    brewState.weight <= 40.0
  ) {
    if (UI.btnDose && UI.btnDose.textContent !== "CT") {
      UI.btnDose.textContent = "CT";
      UI.btnDose.classList.add("ct-active");
    }
  } else {
    if (UI.btnDose && UI.btnDose.textContent === "CT") {
      UI.btnDose.textContent = `${advancedState.dose}g`;
      UI.btnDose.classList.remove("ct-active");
    }
  }

  if (currentTimerState === TIMER_STATE.RUNNING && UI.liveProgress) {
    let activeWeight = brewState.weight - brewBaselineWeight;

    if (activeWeight < 0) {
      activeWeight = brewState.weight;
      brewBaselineWeight = 0;
    }

    if (activeWeight > advancedState.targetYield && UI.overpourProgress) {
      const overWeight = activeWeight - advancedState.targetYield;
      const overPct = Math.min((overWeight / advancedState.targetYield) * 100, 20);
      const scaleFactor = (100 - overPct) / 100;

      UI.liveProgress.style.width = `${100 - overPct}%`;
      UI.overpourProgress.style.width = `${overPct}%`;

      const totalWater = advancedState.targetYield;
      liveTicksData.forEach((tick) => {
        const pct = (tick.weight / totalWater) * 100 * scaleFactor;
        tick.dom.style.left = `${Math.min(pct, 100 - overPct)}%`;
      });
    } else {
      const rawPct = (activeWeight / advancedState.targetYield) * 100;
      const fillPct = Math.max(0, Math.min(rawPct, 100));
      UI.liveProgress.style.width = `${fillPct}%`;
      if (UI.overpourProgress) UI.overpourProgress.style.width = `0%`;
    }

    if (activeWeight >= advancedState.targetYield) {
      if (brewState.flowRateEMA > 0.3) {
        UI.liveProgress.classList.add("is-drawdown");
      } else {
        UI.liveProgress.classList.remove("is-drawdown");
      }
    } else {
      UI.liveProgress.classList.remove("is-drawdown");
    }

    // DEBOUNCE DE FLUXO BASEADO NO CLOCK DE ALTA RESOLUÇÃO (ms)
    if (brewState.flowRateEMA > 1.5) {
      isCurrentlyPouring = true;
      isPourDebouncing = false;
    } else if (brewState.flowRateEMA < 0.5 && isCurrentlyPouring) {
      const nowSec = performance.now() / 1000;
      if (!isPourDebouncing) {
        isPourDebouncing = true;
        stopPourTimeout = nowSec + 1.2;
      } else if (nowSec >= stopPourTimeout) {
        isCurrentlyPouring = false;
        isPourDebouncing = false;
        handlePourStop(activeWeight);
      }
    } else if (brewState.flowRateEMA >= 0.5 && isPourDebouncing) {
      isPourDebouncing = false;
    }

    liveTicksData.forEach((tick) => {
      if (!tick.passed && activeWeight >= tick.weight) {
        tick.passed = true;
        tick.dom.classList.add("is-passed");

        setTimeout(() => {
          tick.dom.classList.replace("is-passed", "is-settled");
        }, 600);
      }
    });
  } else if (currentTimerState === TIMER_STATE.IDLE && UI.liveProgress) {
    UI.liveProgress.style.width = `0%`;
    if (UI.overpourProgress) UI.overpourProgress.style.width = `0%`;
    UI.liveProgress.classList.remove("is-drawdown");
  }

  lastHardwareTime = brewState.time;
  const displayWeight = Math.min(brewState.weight, 999.9);
  if (UI.valWeight) UI.valWeight.textContent = displayWeight.toFixed(1);

  updateFlowVisuals(brewState.flowRateEMA);
  renderFlowGraph(brewState.flowRateEMA, brewState.time);

  const timeInt = Math.floor(brewState.time);
  const m = Math.floor(timeInt / 60);
  const s = timeInt % 60;
  const minStr = m < 10 ? " " + m : m.toString();
  if (UI.valTime) UI.valTime.textContent = minStr + ":" + timeStrs[s];

  if (UI.stableDot) {
    if (brewState.isStable) UI.stableDot.classList.add("is-stable");
    else UI.stableDot.classList.remove("is-stable");
  }

  brewState._isDirty = false;
}

function calculatePours(flowProfile) {
  let localPours = 0;
  let isPouring = false;
  let pourPointsCount = 0;

  if (!flowProfile || flowProfile.length === 0) return 0;

  flowProfile.forEach((pt) => {
    if (pt.flow > 1.5 && !isPouring) {
      isPouring = true;
      pourPointsCount = 1;
    } else if (pt.flow > 0.5 && isPouring) {
      pourPointsCount++;
    } else if (pt.flow <= 0.5 && isPouring) {
      isPouring = false;
      if (pourPointsCount > 5) localPours++;
      pourPointsCount = 0;
    }
  });

  if (isPouring && pourPointsCount > 5) localPours++;
  return localPours;
}

function processAndSaveExtraction(isEmergencySave = false) {
  const MIN_ESPRESSO_TIME = 15;
  const MIN_ESPRESSO_WEIGHT = 15;
  const MIN_POUROVER_TIME = 45;
  const MIN_POUROVER_WEIGHT = 100;
  const MAX_TIME_SEC = 600;

  if (brewState.time < MIN_ESPRESSO_TIME || brewState.weight < MIN_ESPRESSO_WEIGHT) {
    console.log(
      `Lixo descartado: ${brewState.weight.toFixed(1)}g / ${brewState.time.toFixed(0)}s.`,
    );
    return;
  }

  if (brewState.time > MAX_TIME_SEC) return;

  let brewType = "pourover";
  if (brewState.time < MIN_POUROVER_TIME || brewState.weight < MIN_POUROVER_WEIGHT) {
    brewType = "espresso";
  }

  const cleanFlowProfile = FLOW_HISTORY.filter((point) => point.time >= 0);
  const extractionData = {
    id: Date.now(),
    date: new Date().toISOString(),
    totalTime: brewState.time,
    totalWeight: brewState.weight,
    flowProfile: cleanFlowProfile,
    type: brewType,
    isEmergencySave: isEmergencySave,
    dose: advancedState.dose,
    ratio: advancedState.ratio,
    targetYield: advancedState.targetYield,
    method: advancedState.method,
  };

  if (typeof saveExtraction === "function") saveExtraction(extractionData);
}

if (UI.btnConnect) {
  UI.btnConnect.addEventListener("click", () => {
    UI.btnConnect.textContent = "connecting";
    UI.btnConnect.classList.add("pulse-cursor");

    bleManager
      .connect()
      .then(() => {
        revealAppShell();
        requestWakeLock();
      })
      .catch((error) => {
        UI.btnConnect.textContent = "connect";
        UI.btnConnect.classList.remove("pulse-cursor");
        if (error.name !== "NotFoundError") alert("Falha: " + (error.message || error));
      });
  });
}

if (UI.btnTare) {
  UI.btnTare.addEventListener("click", () => {
    if (isSimulating) {
      simWeight = 0;
      brewState.weight = 0;
      brewState._isDirty = true;
    } else {
      bleManager.sendCommand("TARE");
    }
  });
}

if (UI.btnTimer) {
  UI.btnTimer.addEventListener("click", () => {
    switch (currentTimerState) {
      case TIMER_STATE.IDLE:
        if (!isSimulating) bleManager.sendCommand("TIMER_START");
        brewBaselineWeight = brewState.weight;

        renderAdaptiveTicks();

        currentTimerState = TIMER_STATE.RUNNING;
        if (UI.timerIcon) UI.timerIcon.src = "/icons/scale/stop.svg";
        if (UI.actionFooter) UI.actionFooter.classList.add("is-running");

        brewState._isDirty = true;
        break;

      case TIMER_STATE.RUNNING:
        if (!isSimulating) bleManager.sendCommand("TIMER_PAUSE");
        currentTimerState = TIMER_STATE.DONE;
        if (UI.timerIcon) UI.timerIcon.src = "/icons/scale/restart.svg";

        let finalWaterApp = brewState.weight - brewBaselineWeight;
        if (finalWaterApp < 0) finalWaterApp = 0;
        let finalRatioApp =
          advancedState.dose > 0 ? (finalWaterApp / advancedState.dose).toFixed(1) : "0.0";

        if (UI.btnDose) UI.btnDose.textContent = `${advancedState.dose}g`;
        if (UI.btnRatio) UI.btnRatio.textContent = `1:${finalRatioApp}`;
        if (UI.btnMethod) UI.btnMethod.textContent = `↓`;

        if (UI.actionFooter) {
          UI.actionFooter.classList.remove("is-running");
          UI.actionFooter.classList.add("is-done");
        }
        brewState._isDirty = true;
        break;

      case TIMER_STATE.DONE:
        if (!isSimulating) bleManager.sendCommand("TIMER_RESET");
        processAndSaveExtraction();
        resetExtraction();

        UI.btnDose.textContent = `${advancedState.dose}g`;
        UI.btnRatio.textContent = `1:${advancedState.ratio}`;
        UI.btnMethod.textContent = advancedState.method;

        // RESTAURAÇÃO DOS TICKS NO DOM AO SAIR DO MODO DE REVISÃO
        renderAdaptiveTicks();

        currentTimerState = TIMER_STATE.IDLE;
        if (UI.timerIcon) UI.timerIcon.src = "/icons/scale/play.svg";
        if (UI.actionFooter) {
          UI.actionFooter.classList.remove("is-running", "is-done", "is-reviewing");
        }
        brewState._isDirty = true;
        break;
    }
    resetIdleTimer();
  });
}

if (UI.btnDose) {
  UI.btnDose.addEventListener("click", () => {
    if (currentTimerState === TIMER_STATE.DONE) return;
    if (UI.btnDose.textContent === "CT") {
      advancedState.dose = parseFloat(brewState.weight.toFixed(1));
      advancedState.targetYield = advancedState.dose * advancedState.ratio;
      renderAdaptiveTicks();

      if (!isSimulating) {
        bleManager.sendCommand("TARE");
        brewState.weight = 0;
        brewBaselineWeight = 0;
      } else {
        simWeight = 0;
        brewState.weight = 0;
      }

      brewState._isDirty = true;
      UI.btnDose.classList.remove("ct-active");
      UI.btnDose.textContent = `${advancedState.dose}g`;
    } else {
      openConfig();
    }
  });
}

if (UI.btnMethod) {
  UI.btnMethod.addEventListener("click", () => {
    if (currentTimerState === TIMER_STATE.IDLE) {
      openConfig();
    }
  });
}

if (UI.btnRatio) {
  UI.btnRatio.addEventListener("click", openConfig);
}

// --- INTERAÇÃO PÓS-EXTRAÇÃO (REVIEW TOGGLE) ---
const islandSlider = document.getElementById("island-slider");
if (islandSlider) {
  islandSlider.addEventListener("click", () => {
    if (currentTimerState === TIMER_STATE.DONE && UI.actionFooter) {
      UI.actionFooter.classList.toggle("is-reviewing");

      if (UI.btnMethod) {
        UI.btnMethod.textContent = UI.actionFooter.classList.contains("is-reviewing") ? "↑" : "↓";
      }
    }
  });
}

if (UI.stableDot) {
  UI.stableDot.addEventListener("click", async () => {
    await renderStatsScreen();
  });
}

async function renderStatsScreen() {
  const extractions = await getAllExtractions();
  const historyList = document.getElementById("history-list");
  const fragment = document.createDocumentFragment();

  if (historyList) historyList.innerHTML = "";

  if (extractions.length === 0) {
    if (UIStats.valBrews) UIStats.valBrews.textContent = "0";
    if (UIStats.valAvgTime) UIStats.valAvgTime.textContent = "0:00";
    if (UIStats.valAvgYield) UIStats.valAvgYield.textContent = "0";
    if (UIStats.valAvgPours) UIStats.valAvgPours.textContent = "0";
    if (UIStats.valTotalCoffee) UIStats.valTotalCoffee.textContent = "0";
    if (historyList)
      historyList.innerHTML = `<li style="color: var(--fg-dim); opacity: 0.5;">no data yet.</li>`;
    if (UIStats.screen) revealPageFrame(UIStats.screen);
    return;
  }

  let pouroverCount = 0;
  let sumTime = 0,
    sumYield = 0,
    sumPours = 0;

  extractions
    .sort((a, b) => b.id - a.id)
    .forEach((ext) => {
      const isEspresso = ext.type === "espresso";
      let pours = calculatePours(ext.flowProfile);
      if (pours === 0 && ext.totalWeight > 10) pours = 1;

      if (!isEspresso) {
        pouroverCount++;
        sumTime += ext.totalTime;
        sumYield += ext.totalWeight;
        sumPours += pours;
      }

      if (historyList) {
        const d = new Date(ext.date);
        const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
        const m = Math.floor(ext.totalTime / 60);
        const s = Math.floor(ext.totalTime % 60)
          .toString()
          .padStart(2, "0");

        const typeTag = isEspresso
          ? `<span style="border: 1px solid var(--fg-dim); padding: 0 4px; border-radius: 4px; font-size: 0.7rem; color: var(--fg-dim);">esp</span>`
          : `<span>${pours}p</span>`;

        const li = document.createElement("li");
        li.className = "history-item";
        li.innerHTML = `
        <div class="history-info">
          <span>${dateStr}</span>
          <strong>${ext.totalWeight.toFixed(0)}g</strong>
          <span>${m}:${s}</span>
          ${typeTag}
        </div>
        <button class="btn-delete-brew" data-id="${ext.id}">del</button>
      `;
        fragment.appendChild(li);
      }
    });

  if (historyList) historyList.appendChild(fragment);

  if (UIStats.valBrews) UIStats.valBrews.textContent = extractions.length.toString();

  if (pouroverCount > 0) {
    const avgTime = sumTime / pouroverCount;
    const m = Math.floor(avgTime / 60);
    const s = Math.floor(avgTime % 60)
      .toString()
      .padStart(2, "0");

    if (UIStats.valAvgTime) UIStats.valAvgTime.textContent = `${m}:${s}`;
    if (UIStats.valAvgYield)
      UIStats.valAvgYield.textContent = (sumYield / pouroverCount).toFixed(0);
    if (UIStats.valAvgPours)
      UIStats.valAvgPours.textContent = (sumPours / pouroverCount).toFixed(1);
    if (UIStats.valTotalCoffee) UIStats.valTotalCoffee.textContent = (sumYield / 15).toFixed(0);
  } else {
    if (UIStats.valAvgTime) UIStats.valAvgTime.textContent = "0:00";
    if (UIStats.valAvgYield) UIStats.valAvgYield.textContent = "0";
    if (UIStats.valAvgPours) UIStats.valAvgPours.textContent = "0";
    if (UIStats.valTotalCoffee) UIStats.valTotalCoffee.textContent = "0";
  }

  if (UIStats.screen) revealPageFrame(UIStats.screen);
}

const historyListElement = document.getElementById("history-list");
if (historyListElement) {
  historyListElement.addEventListener("click", async (e) => {
    if (e.target.classList.contains("btn-delete-brew")) {
      const id = parseInt(e.target.getAttribute("data-id"));
      if (typeof deleteExtraction === "function") {
        await deleteExtraction(id);
        e.target.closest(".history-item").style.opacity = "0.2";
        setTimeout(() => renderStatsScreen(), 150);
      }
    }
  });
}

if (UIStats.btnClose) {
  UIStats.btnClose.addEventListener("click", () => {
    UIStats.screen.classList.remove("is-visible");
  });
}

if (UIStats.btnExport) {
  UIStats.btnExport.addEventListener("click", () => exportData());
}

requestAnimationFrame(renderFrame);

// --- DEV MODE (MOCK DE DADOS INTELIGENTE PARA TETSU E CT) ---
const btnSimulate = document.getElementById("btn-simulate");
let simInterval = null;

if (btnSimulate) {
  btnSimulate.addEventListener("click", () => {
    requestWakeLock();
    revealAppShell();
    const indicator = document.getElementById("status-indicator");
    if (indicator) indicator.textContent = "sim";

    isSimulating = true;
    resetExtraction();

    if (simInterval) clearInterval(simInterval);

    let simPoursCompleted = 0;
    let simIsPouring = false;
    let simPourTarget = 0;
    let simPauseTimeOut = 0;
    let coffeeAdded = false;

    const setNextPour = () => {
      if (simPoursCompleted < 5) {
        const randomPourWeight = 30 + Math.random() * 30;
        simPourTarget = simWeight + randomPourWeight;
        simIsPouring = true;
      }
    };

    simInterval = setInterval(() => {
      let flow = 0;

      if (currentTimerState === TIMER_STATE.IDLE) {
        if (!coffeeAdded) {
          if (simWeight < 18.5) {
            flow = 5.0;
            simWeight += flow * 0.05;
          } else {
            simWeight = 18.5;
            flow = 0;
            coffeeAdded = true;
          }
        }
      } else if (currentTimerState === TIMER_STATE.RUNNING) {
        simTime += 0.05;
        if (simPourTarget === 0) setNextPour();

        if (simPoursCompleted < 5) {
          if (simIsPouring) {
            flow = 6 + (Math.random() * 0.5 - 0.25);
            simWeight += flow * 0.05;

            if (simWeight >= simPourTarget) {
              simWeight = simPourTarget;
              simIsPouring = false;
              simPoursCompleted++;
              simPauseTimeOut = simTime + 15.0;
            }
          } else {
            flow = Math.random() * 0.1;
            if (simTime >= simPauseTimeOut) setNextPour();
          }
        }
      }

      brewState.weight = simWeight;
      if (currentTimerState === TIMER_STATE.RUNNING) brewState.time = simTime;
      brewState.flowRateEMA = flow;
      brewState.isStable = flow < 0.5;
      brewState._isDirty = true;
    }, 50);
  });
}
