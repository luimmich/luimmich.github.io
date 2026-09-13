// src/assets/js/scale/app.js
import { brewState, handleTimemoreData } from "./timemore-decoder.js";
import { BLEManager } from "./ble-manager.js";
import { saveExtraction, exportData, getAllExtractions } from "./db.js";

// if ("serviceWorker" in navigator) {
//   window.addEventListener("load", () => {
//     navigator.serviceWorker.register("/scale-app/sw.js").catch((err) => {
//       console.warn("Service Worker falhou:", err);
//     });
//   });
// }

// Substitua o bloco de registro original por este temporariamente
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (let registration of registrations) {
        registration.unregister().then((boolean) => {
          if (boolean) console.log("Service Worker desinstalado (Dev Mode)");
        });
      }
    });

    // Opcional: Limpa também o cache físico do navegador armazenado pelo SW
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => caches.delete(key)));
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

// --- MODO CAMALEÃO (Detecção de Bluefy) ---
const isBluefy = navigator.userAgent.toLowerCase().includes("bluefy");
if (isBluefy) {
  document.body.classList.add("theme-bluefy");

  // Altera a cor da barra de status do iOS no topo
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", "#1C1C1E");
  }
}

// Referências da Tela de Estatísticas Modular
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

// --- ESTADO GLOBAL DA APLICAÇÃO (FSM e Variáveis) ---
const TIMER_STATE = {
  IDLE: 0,
  RUNNING: 1,
  DONE: 2,
};
let currentTimerState = TIMER_STATE.IDLE;

let isSimulating = false;
let simTime = 0;
let simWeight = 0;

let FLOW_HISTORY = [];
const maxHistorySize = 5000;
const canvas = document.getElementById("flow-canvas");
const ctx = canvas.getContext("2d");
let scrollTime = 0;
let isDragging = false;
let lastClientX = 0;

// --- UTILITÁRIO: FULLSCREEN MULTI-BROWSER ---
function enterFullScreen() {
  // Bloqueio para Desktop: Só prossegue se for dispositivo móvel ou touch
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    navigator.maxTouchPoints > 0;
  if (!isMobile) return;

  const el = document.documentElement;
  try {
    if (el.requestFullscreen) {
      el.requestFullscreen().catch((err) => console.warn("Fullscreen ignorado pelo OS:", err));
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
      el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
      el.msRequestFullscreen();
    }
  } catch (error) {
    console.warn("Dispositivo não suporta Fullscreen API programática.");
  }
}

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
const TIME_WINDOW = 20;

function resetExtraction() {
  brewState.time = 0;
  brewState.flowRateEMA = 0;
  simTime = 0;

  const timeStep = 0.1;
  const pastPoints = 300;
  FLOW_HISTORY = Array.from({ length: pastPoints }, (_, i) => {
    return { flow: 0, time: -(pastPoints - i - 1) * timeStep };
  });

  brewState._isDirty = true;
}

function initGraph() {
  canvas.style.touchAction = "none";
  if (FLOW_HISTORY.length === 0) {
    resetExtraction();
  }
}

document.fonts.ready.then(() => {
  brewState._isDirty = true;
});

canvas.addEventListener("pointerdown", (e) => {
  if (currentTimerState === TIMER_STATE.RUNNING) return;
  isDragging = true;
  lastClientX = e.clientX;
});

window.addEventListener("pointerup", () => {
  isDragging = false;
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging || currentTimerState === TIMER_STATE.RUNNING) return;
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
  UI.documentElement.style.setProperty("--flow-ratio", ratio.toFixed(3));
  UI.valFlowNum.textContent = flowRate.toFixed(1) + " g/s";
}

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

// --- INTEGRAÇÃO COM BANCO DE DADOS (DB) ---
function processAndSaveExtraction() {
  const MIN_TIME = 20;
  const MIN_WEIGHT = 50;

  if (brewState.time < MIN_TIME || brewState.weight < MIN_WEIGHT) {
    console.log("Extração descartada (Escaldo/Purga).");
    return;
  }

  const cleanFlowProfile = FLOW_HISTORY.filter((point) => point.time >= 0);

  const extractionData = {
    id: Date.now(),
    date: new Date().toISOString(),
    totalTime: brewState.time,
    totalWeight: brewState.weight,
    flowProfile: cleanFlowProfile,
  };

  saveExtraction(extractionData);
}

// --- EVENT BINDINGS (INTERAÇÕES GERAIS) ---
UI.btnConnect.addEventListener("click", () => {
  enterFullScreen();
  UI.btnConnect.textContent = "connecting";
  UI.btnConnect.classList.add("pulse-cursor");

  bleManager.connect().catch((error) => {
    UI.btnConnect.textContent = "connect";
    UI.btnConnect.classList.remove("pulse-cursor");
    alert("Falha: " + (error.message || error));
  });
});

UI.btnTare.addEventListener("click", () => {
  if (isSimulating) {
    simWeight = 0;
    brewState.weight = 0;
    brewState._isDirty = true;
  } else {
    bleManager.sendCommand("TARE");
  }
});

UI.btnTimer.addEventListener("click", () => {
  switch (currentTimerState) {
    case TIMER_STATE.IDLE:
      if (!isSimulating) bleManager.sendCommand("TIMER_START");
      currentTimerState = TIMER_STATE.RUNNING;
      UI.timerIcon.src = "/icons/scale/pause.svg";
      break;

    case TIMER_STATE.RUNNING:
      if (!isSimulating) bleManager.sendCommand("TIMER_PAUSE");
      currentTimerState = TIMER_STATE.DONE;
      UI.timerIcon.src = "/icons/scale/restart.svg";
      break;

    case TIMER_STATE.DONE:
      if (!isSimulating) bleManager.sendCommand("TIMER_RESET");
      processAndSaveExtraction();
      resetExtraction();

      currentTimerState = TIMER_STATE.IDLE;
      UI.timerIcon.src = "/icons/scale/play.svg";
      break;
  }
});

// --- MÓDULO DE ESTATÍSTICAS (STAT SCREEN) ---
UI.stableDot.addEventListener("click", async () => {
  const extractions = await getAllExtractions();

  if (extractions.length === 0) {
    UIStats.valBrews.textContent = "0";
    UIStats.screen.classList.add("is-visible");
    return;
  }

  const count = extractions.length;
  let sumTime = 0;
  let sumYield = 0;
  let sumPours = 0;

  extractions.forEach((ext) => {
    sumTime += ext.totalTime;
    sumYield += ext.totalWeight;

    // ALGORITMO DE DETECÇÃO DE DESPEJOS (HISTERESE)
    let localPours = 0;
    let isPouring = false;

    if (ext.flowProfile && ext.flowProfile.length > 0) {
      ext.flowProfile.forEach((pt) => {
        if (pt.flow > 1.0 && !isPouring) {
          isPouring = true;
          localPours++;
        } else if (pt.flow < 0.5 && isPouring) {
          isPouring = false;
        }
      });
    }

    // Fallback de segurança para extrações muito lentas sem picos bruscos
    if (localPours === 0 && ext.totalWeight > 0) localPours = 1;
    sumPours += localPours;
  });

  const avgTime = sumTime / count;
  const avgYield = sumYield / count; // 1g de água = 1ml
  const avgPours = sumPours / count;
  const estCoffeeGrams = sumYield / 15; // Proporção base (1:15)

  UIStats.valBrews.textContent = count.toString();

  const m = Math.floor(avgTime / 60);
  const s = Math.floor(avgTime % 60)
    .toString()
    .padStart(2, "0");
  UIStats.valAvgTime.textContent = `${m}:${s}`;

  UIStats.valAvgYield.textContent = avgYield.toFixed(0);
  UIStats.valAvgPours.textContent = avgPours.toFixed(1);
  UIStats.valTotalCoffee.textContent = estCoffeeGrams.toFixed(0);

  UIStats.screen.classList.add("is-visible");
});

UIStats.btnClose.addEventListener("click", () => {
  UIStats.screen.classList.remove("is-visible");
});

UIStats.btnExport.addEventListener("click", () => {
  exportData();
});

requestAnimationFrame(renderFrame);

// --- DEV MODE (MOCK DE DADOS) ---
const btnSimulate = document.getElementById("btn-simulate");

btnSimulate.addEventListener("click", () => {
  enterFullScreen();
  document.body.classList.remove("state-disconnected");
  document.getElementById("status-indicator").textContent = "sim";

  isSimulating = true;
  resetExtraction();

  setInterval(() => {
    if (currentTimerState !== TIMER_STATE.RUNNING) return;

    simTime += 0.05;
    let flow = (Math.sin(simTime * 2) + 1) * 4 + Math.random() * 0.5;
    simWeight += flow * 0.05;

    brewState.weight = simWeight;
    brewState.time = simTime;
    brewState.flowRateEMA = flow;
    brewState.isStable = Math.random() > 0.1;
    brewState._isDirty = true;
  }, 50);
});
