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
  }
} catch (e) {
  console.warn("Falha ao recuperar perfil local:", e);
}

let liveTicksData = [];
let currentPourIndex = 0;
let isCurrentlyPouring = false;
let isPourDebouncing = false;
let stopPourTimeout = 0;

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
    console.warn(`Wake Lock bloqueado pelo OS. Armadilhado para o próximo toque.`);
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
  navHeader: document.querySelector("#config-screen .stats-nav"), // Busca a barra mesmo sem ID
  btnClose: document.getElementById("btn-close-config"),
  sliderDose: document.getElementById("cfg-slider-dose"),
  sliderRatio: document.getElementById("cfg-slider-ratio"),
  valDose: document.getElementById("cfg-val-dose"),
  valRatio: document.getElementById("cfg-val-ratio"),
  valYield: document.getElementById("cfg-val-yield"),
};

function autoSaveRecipe(newDose, newRatio) {
  advancedState.dose = newDose;
  advancedState.ratio = newRatio;
  advancedState.targetYield = newDose * newRatio;

  // Atualiza modal de configuração
  if (UIConfig.valDose) UIConfig.valDose.textContent = newDose.toFixed(1);
  if (UIConfig.valRatio) UIConfig.valRatio.textContent = newRatio.toFixed(1);
  if (UIConfig.valYield)
    UIConfig.valYield.textContent = Math.round(advancedState.targetYield).toString();

  // Reflete na Home imediatamente
  if (UI.btnDose && UI.btnDose.textContent !== "CT") {
    UI.btnDose.textContent = `${newDose}g`;
  }
  if (UI.btnRatio) {
    UI.btnRatio.textContent = `1:${newRatio}`;
  }

  // Recalcula régua visual da ilha
  renderAdaptiveTicks();

  // Persistência local silenciosa
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

  if (UIConfig.valDose) UIConfig.valDose.textContent = advancedState.dose.toFixed(1);
  if (UIConfig.valRatio) UIConfig.valRatio.textContent = advancedState.ratio.toFixed(1);
  if (UIConfig.valYield)
    UIConfig.valYield.textContent = Math.round(advancedState.targetYield).toString();

  if (UIConfig.screen) UIConfig.screen.classList.add("is-visible");
}

function closeConfig() {
  if (UIConfig.screen) UIConfig.screen.classList.remove("is-visible");
}

// Auto-save em tempo real no evento input dos sliders
if (UIConfig.sliderDose) {
  UIConfig.sliderDose.addEventListener("input", (e) => {
    const dose = parseFloat(e.target.value);
    const ratio = parseFloat(UIConfig.sliderRatio?.value || advancedState.ratio);
    autoSaveRecipe(dose, ratio);
  });
}

if (UIConfig.sliderRatio) {
  UIConfig.sliderRatio.addEventListener("input", (e) => {
    const ratio = parseFloat(e.target.value);
    const dose = parseFloat(UIConfig.sliderDose?.value || advancedState.dose);
    autoSaveRecipe(dose, ratio);
  });
}

// Fechar ao clicar na barra superior inteira ou no botão de voltar
// Fecha ao clicar no botão "< brew config"
if (UIConfig.btnClose) {
  UIConfig.btnClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closeConfig();
  });
}

// Fecha ao clicar em qualquer ponto vazio da barra superior
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
      // Ignora se o toque começar em um slider ou botão para não conflitar com ajustes finos
      if (e.target.closest("input[type='range'], .ruler-slider, button")) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      isTracking = true;
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

      // Se o movimento for predominantemente vertical (scroll da página), cancela o swipe
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 15) {
        isTracking = false;
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

      // Arraste mínimo de 65px para a direita com predominância horizontal
      if (deltaX > 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
        dismissCallback();
      }
    },
    { passive: true },
  );
}

// Ativação do gesto em ambos os overlays
enableSwipeToDismiss(UIConfig.screen, closeConfig);
enableSwipeToDismiss(UIStats.screen, () => {
  if (UIStats.screen) UIStats.screen.classList.remove("is-visible");
});

// Fechar tela de stats clicando em qualquer ponto do cabeçalho
if (UIStats.btnClose) {
  UIStats.btnClose.addEventListener("click", () => {
    if (UIStats.screen) UIStats.screen.classList.remove("is-visible");
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
document.addEventListener("DOMContentLoaded", initGraph);

function renderFlowGraph(currentFlow, currentTime) {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  if (
    canvas.width !== Math.floor(rect.width * dpr) ||
    canvas.height !== Math.floor(rect.height * dpr)
  ) {
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);
  }

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

  for (let i = 0; i < FLOW_HISTORY.length; i++) {
    let val = FLOW_HISTORY[i].flow;
    let ptTime = FLOW_HISTORY[i].time;

    if (ptTime < 0) continue;

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

  // 1. ATRAÇÃO MAGNÉTICA (Snap): Valida o despejo onde o fluxo cessou
  let currentTick = liveTicksData[currentPourIndex];
  currentTick.weight = activeWeight;
  currentTick.passed = true;
  const currentPct = (activeWeight / totalTarget) * 100;
  currentTick.dom.style.left = `${Math.min(currentPct, 100)}%`;

  currentTick.dom.classList.add("is-passed");
  setTimeout(() => currentTick.dom.classList.replace("is-passed", "is-settled"), 600);

  // 2. FASE 1 (PRIMEIROS 40% — EQUILÍBRIO ACIDEZ / DOÇURA)
  if (currentPourIndex === 0) {
    // Se o Bloom cobriu ou passou de toda a Fase 1 (>= 40%), funde o Pour 2
    if (activeWeight >= phase1Target) {
      if (liveTicksData[1]) {
        liveTicksData[1].dom.classList.add("is-hidden");
        liveTicksData.splice(1, 1);
      }
      redistributePhase2(activeWeight);
    } else {
      // REGRA 4:6: O Pour 2 trava estritamente nos 40% totais.
      // O que passou no Pour 1 é descontado no Pour 2, sem tocar na Fase 2.
      if (liveTicksData[1]) {
        liveTicksData[1].weight = phase1Target;
        const p2Pct = (phase1Target / totalTarget) * 100;
        liveTicksData[1].dom.style.left = `${Math.min(p2Pct, 100)}%`;
      }
    }
  }
  // 3. TRANSIÇÃO: FIM DA FASE 1 (POUR 2 CONCLUÍDO)
  else if (currentPourIndex === 1 && liveTicksData.length > 2) {
    // Fase 1 finalizada: recalcula a base da Fase 2 com a sobra real
    redistributePhase2(activeWeight);
  }
  // 4. FASE 2 (60% RESTANTES — FORÇA E CORPO)
  else {
    // Fusão dinâmica na Fase 2: se atingir 50%+ do próximo pour, funde os passos
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

    // Redistribui o volume restante entre os despejos remanescentes da Fase 2
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

// Auxiliar: Distribui a água restante igualmente entre os passos da Fase 2
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
      // OVERPOUR: Cresce para dentro a partir da direita, compactando a receita
      const overWeight = activeWeight - advancedState.targetYield;
      // Reserva até 20% da largura total da barra para a zona vermelha
      const overPct = Math.min((overWeight / advancedState.targetYield) * 100, 20);
      const scaleFactor = (100 - overPct) / 100;

      // A barra branca encolhe para dar espaço ao vermelho (ex: 85% branca + 15% vermelha = 100%)
      UI.liveProgress.style.width = `${100 - overPct}%`;
      UI.overpourProgress.style.width = `${overPct}%`;

      // Compacta os ticks (sanfona) para acompanharem o encolhimento da barra branca
      const totalWater = advancedState.targetYield;
      liveTicksData.forEach((tick) => {
        const pct = (tick.weight / totalWater) * 100 * scaleFactor;
        tick.dom.style.left = `${Math.min(pct, 100 - overPct)}%`;
      });
    } else {
      // FLUXO NORMAL (<= Target Yield)
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
    if (brewState.flowRateEMA > 1.5) {
      isCurrentlyPouring = true;
      isPourDebouncing = false;
    } else if (brewState.flowRateEMA < 0.5 && isCurrentlyPouring) {
      if (!isPourDebouncing) {
        isPourDebouncing = true;
        stopPourTimeout = brewState.time + 1.2;
      } else if (brewState.time >= stopPourTimeout) {
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

        if (UI.btnDose) UI.btnDose.textContent = `${advancedState.dose}g`;
        if (UI.btnRatio) UI.btnRatio.textContent = `1:${advancedState.ratio}`;
        if (UI.btnMethod) UI.btnMethod.textContent = advancedState.method;

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

if (UI.btnRatio) {
  UI.btnRatio.addEventListener("click", openConfig);
}

// --- INTERAÇÃO PÓS-EXTRAÇÃO (REVIEW TOGGLE) ---
const islandSlider = document.getElementById("island-slider");
if (islandSlider) {
  islandSlider.addEventListener("click", () => {
    // No estado DONE, qualquer toque na ilha rotaciona o painel
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
    if (UIStats.screen) UIStats.screen.classList.add("is-visible");
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

  if (UIStats.screen) UIStats.screen.classList.add("is-visible");
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
    document.body.classList.remove("state-disconnected");
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
