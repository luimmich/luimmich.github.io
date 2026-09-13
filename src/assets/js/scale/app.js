// src/assets/js/scale/app.js
import { brewState, handleTimemoreData } from "./timemore-decoder.js";
import { BLEManager } from "./ble-manager.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/scale-app/sw.js").catch((err) => {
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
};

const timeStrs = new Array(60);
for (let i = 0; i < 60; i++) {
  timeStrs[i] = i < 10 ? "0" + i : i.toString();
}

const bleManager = new BLEManager(handleTimemoreData, (isConnected) => {
  if (isConnected) {
    UI.body.classList.remove("state-disconnected");
    UI.statusBadge.classList.add("active");
  } else {
    UI.statusBadge.classList.remove("active");
  }
});

// --- CONFIGURAÇÕES DO GRÁFICO ---
const MAX_FLOW_SCALE = 10;

// Variável que você pode mudar para ajustar o espaço entre as marcações de 15s.
// Representa "quantos segundos são exibidos simultaneamente na tela".
// Diminua o valor (ex: de 20 para 15) para aumentar o espaço entre as barras.
const TIME_WINDOW = 20;

let FLOW_HISTORY = [];
let maxHistorySize = 5000; // Mantém longo para permitir bastante scroll
const canvas = document.getElementById("flow-canvas");
const ctx = canvas.getContext("2d");

// Variáveis de estado para o Scroll/Pan
let isTimerRunning = false;
let scrollTime = 0;
let isDragging = false;
let lastClientX = 0;

function initGraph() {
  canvas.style.touchAction = "none";

  if (FLOW_HISTORY.length === 0) {
    const timeStep = 0.1;
    const pastPoints = 300;
    FLOW_HISTORY = Array.from({ length: pastPoints }, (_, i) => {
      return { flow: 0, time: -(pastPoints - i - 1) * timeStep };
    });
  }
}

// Força um novo render assim que as fontes customizadas terminarem de carregar no Mobile
document.fonts.ready.then(() => {
  brewState._isDirty = true;
});

// --- EVENTOS DE TOUCH/MOUSE PARA SCROLL (PAN) ---
canvas.addEventListener("pointerdown", (e) => {
  if (isTimerRunning) return;
  isDragging = true;
  lastClientX = e.clientX;
});

window.addEventListener("pointerup", () => {
  isDragging = false;
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging || isTimerRunning) return;

  const deltaPx = e.clientX - lastClientX;
  const drawWidth = canvas.clientWidth - 25;
  const pxPerSec = drawWidth / TIME_WINDOW;

  scrollTime += deltaPx / pxPerSec;
  lastClientX = e.clientX;
  brewState._isDirty = true;
});

window.addEventListener("resize", initGraph);
document.addEventListener("DOMContentLoaded", initGraph);

function renderFlowGraph(currentFlow, currentTime) {
  // === CORREÇÃO DE SERRILHADO (High-DPI Retina/Mobile Displays) ===
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  if (
    canvas.width !== Math.floor(rect.width * dpr) ||
    canvas.height !== Math.floor(rect.height * dpr)
  ) {
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr); // Escala o contexto de desenho nativamente
  }

  // Dimensões lógicas (em CSS pixels) para os cálculos de desenho
  const canvasWidth = rect.width;
  const canvasHeight = rect.height;

  FLOW_HISTORY.push({ flow: currentFlow, time: currentTime });

  if (currentTime <= 0 || FLOW_HISTORY.length > 50000) {
    if (FLOW_HISTORY.length > maxHistorySize) {
      FLOW_HISTORY.shift();
    }
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const Y_PADDING_TOP = 20;
  const Y_PADDING_BOTTOM = 25;
  const drawHeight = canvasHeight - Y_PADDING_TOP - Y_PADDING_BOTTOM;
  const X_PADDING_LEFT = 25;
  const drawWidth = canvasWidth - X_PADDING_LEFT;

  // --- CÁLCULO DE SCROLL ---
  let latestTime = FLOW_HISTORY[FLOW_HISTORY.length - 1].time;
  let maxScrollTime = Math.max(0, latestTime - TIME_WINDOW);

  if (isTimerRunning) {
    scrollTime = 0;
  } else {
    scrollTime = Math.max(0, Math.min(scrollTime, maxScrollTime));
  }

  let viewEndTime = latestTime - scrollTime;
  let viewStartTime = viewEndTime - TIME_WINDOW;

  // Configuração da Fonte - Coloque o nome da fonte customizada do CSS no lugar de 'SuaFontePixel'
  ctx.font = "10px 'Departure Mono', monospace";

  // ==============================================================
  // CAMADA 1: DESENHO DA GRADE HORIZONTAL FIXA
  // ==============================================================
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(119, 119, 119, 0.25)";
  ctx.fillStyle = "rgba(119, 119, 119, 0.7)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= MAX_FLOW_SCALE; i += 2) {
    const y = canvasHeight - Y_PADDING_BOTTOM - (i / MAX_FLOW_SCALE) * drawHeight;
    ctx.beginPath();
    ctx.moveTo(X_PADDING_LEFT, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  // ==============================================================
  // CAMADA 2: ÁREA DE CLIPPING
  // ==============================================================
  ctx.save();
  ctx.beginPath();
  ctx.rect(X_PADDING_LEFT, 0, drawWidth, canvasHeight);
  ctx.clip();

  // --- DESENHA AS BARRAS DE TEMPO VERTICAIS ---
  ctx.strokeStyle = "rgba(119, 119, 119, 0.4)";
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

  // --- DESENHA A CURVA DE ÁGUA ---
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

  // ==============================================================
  // CAMADA 3: LEGENDAS DO EIXO Y
  // ==============================================================
  ctx.clearRect(0, 0, X_PADDING_LEFT, canvasHeight);

  ctx.fillStyle = "rgba(119, 119, 119, 0.7)";
  ctx.textAlign = "left";
  for (let i = 0; i <= MAX_FLOW_SCALE; i += 2) {
    const y = canvasHeight - Y_PADDING_BOTTOM - (i / MAX_FLOW_SCALE) * drawHeight;
    ctx.fillText(i.toString(), 5, y);
  }
}

// --- TELEMETRIA RESILIENTE E AGNÓSTICA ---
function updateFlowVisuals(flowRate) {
  let ratio = flowRate / MAX_FLOW_SCALE;
  if (ratio > 1.0) ratio = 1.0;
  if (ratio < 0.0) ratio = 0.0;

  UI.documentElement.style.setProperty("--flow-ratio", ratio.toFixed(3));
  UI.valFlowNum.textContent = flowRate.toFixed(1) + " g/s";
}

// --- PIPELINE DE RENDERIZAÇÃO ESTREITA ---
function renderFrame() {
  requestAnimationFrame(renderFrame);
  if (!brewState._isDirty) return;

  const displayWeight = Math.min(brewState.weight, 999.9);
  UI.valWeight.textContent = displayWeight.toFixed(1);

  updateFlowVisuals(brewState.flowRateEMA);
  renderFlowGraph(brewState.flowRateEMA, brewState.time);

  const timeInt = Math.floor(brewState.time);
  const m = Math.floor(timeInt / 60);
  const s = timeInt % 60;
  const minStr = m < 10 ? " " + m : m.toString();
  UI.valTime.textContent = minStr + ":" + timeStrs[s];

  if (brewState.isStable) {
    UI.stableDot.classList.add("is-stable");
  } else {
    UI.stableDot.classList.remove("is-stable");
  }

  brewState._isDirty = false;
}

// --- EVENT BINDINGS ---
UI.btnConnect.addEventListener("click", () => {
  UI.btnConnect.textContent = "connecting";
  UI.btnConnect.classList.add("pulse-cursor");
  bleManager.connect().catch((error) => {
    UI.btnConnect.textContent = "connect";
    UI.btnConnect.classList.remove("pulse-cursor");
    // Exibe o erro real gerado pela engine do iOS
    alert("Falha: " + (error.message || error));
  });
});

UI.btnTare.addEventListener("click", () => bleManager.sendCommand("TARE"));

UI.btnTimer.addEventListener("click", () => {
  if (isTimerRunning) {
    bleManager.sendCommand("TIMER_PAUSE");
    UI.timerIcon.src = "/icons/scale/play.svg";
  } else {
    bleManager.sendCommand("TIMER_START");
    UI.timerIcon.src = "/icons/scale/pause.svg";
  }
  isTimerRunning = !isTimerRunning;
});

// Kickstart do Render Loop
requestAnimationFrame(renderFrame);

// --- SIMULADOR DE HARDWARE BLINDADO (DEV MODE) ---
const btnSimulate = document.getElementById("btn-simulate");

btnSimulate.addEventListener("click", () => {
  document.body.classList.remove("state-disconnected");
  document.getElementById("status-indicator").textContent = "sim";

  let simTime = 0;
  let simWeight = 0;

  setInterval(() => {
    if (isTimerRunning) simTime += 0.05;

    let flow = (Math.sin(simTime * 2) + 1) * 4 + Math.random() * 0.5;
    if (!isTimerRunning) flow = 0;

    simWeight += flow * 0.05;

    brewState.weight = simWeight;
    brewState.time = simTime;
    brewState.flowRateEMA = flow;
    brewState.isStable = Math.random() > 0.1;
    brewState._isDirty = true;
  }, 50);
});
