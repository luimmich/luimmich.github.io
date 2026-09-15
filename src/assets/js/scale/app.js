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
// function enterFullScreen() {
//   const isMobile =
//     /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
//     navigator.maxTouchPoints > 0;
//   if (!isMobile) return;

//   const el = document.documentElement;
//   try {
//     if (el.requestFullscreen) {
//       el.requestFullscreen().catch(() => {});
//     } else if (el.webkitRequestFullscreen) {
//       el.webkitRequestFullscreen();
//     }
//   } catch (error) {
//     console.warn("Dispositivo não suporta Fullscreen API programática.");
//   }
// }

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
    console.warn(`Wake Lock bloqueado pelo OS (${err.name}). Armadilhado para o próximo toque.`);
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

// --- CONFIGURAÇÕES DO GRÁFICO ---
const MAX_FLOW_SCALE = 10;
const TIME_WINDOW = 20;

function resetExtraction() {
  resetDecoderState();
  brewState.time = 0;
  brewState.flowRateEMA = 0;
  simTime = 0;

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
  canvas.style.touchAction = "none";
  if (FLOW_HISTORY.length === 0) resetExtraction();
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
  const pxPerSec = (canvas.clientWidth - 25) / TIME_WINDOW;
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
  UI.documentElement.style.setProperty("--flow-ratio", ratio.toFixed(3));
  UI.valFlowNum.textContent = flowRate.toFixed(1) + " g/s";
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
      currentTimerState = TIMER_STATE.RUNNING;
      UI.timerIcon.src = "/icons/scale/pause.svg";
      resetIdleTimer();
    }
    lastHardwareTimeChange = now;
  } else if (brewState.time === lastHardwareTime && currentTimerState === TIMER_STATE.RUNNING) {
    if (!isSimulating && now - lastHardwareTimeChange > 2000) {
      console.log("Pause físico detectado na balança. Ajustando UI.");
      currentTimerState = TIMER_STATE.DONE;
      UI.timerIcon.src = "/icons/scale/restart.svg";
      resetIdleTimer();
    }
  }

  lastHardwareTime = brewState.time;

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

// --- ALGORITMO DE HISTERESE (POURS) ---
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

// --- INTEGRAÇÃO COM BANCO DE DADOS (DB) ---
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
  };

  saveExtraction(extractionData);
}

// --- EVENT BINDINGS (INTERAÇÕES GERAIS) ---
UI.btnConnect.addEventListener("click", () => {
  UI.btnConnect.textContent = "connecting";
  UI.btnConnect.classList.add("pulse-cursor");

  // Inicia a solicitação de permissão Bluetooth imediatamente no evento do usuário
  bleManager
    .connect()
    .then(() => {
      // Operações secundárias e não bloqueantes executadas após o pareamento
      requestWakeLock();
      // enterFullScreen();
    })
    .catch((error) => {
      UI.btnConnect.textContent = "connect";
      UI.btnConnect.classList.remove("pulse-cursor");
      if (error.name !== "NotFoundError") {
        // Ignora se o usuário apenas cancelou a janela modal
        alert("Falha: " + (error.message || error));
      }
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
  resetIdleTimer();
});

// --- MÓDULO DE ESTATÍSTICAS (STAT SCREEN E HISTÓRICO) ---
UI.stableDot.addEventListener("click", async () => {
  await renderStatsScreen();
});

async function renderStatsScreen() {
  const extractions = await getAllExtractions();
  const historyList = document.getElementById("history-list");
  const fragment = document.createDocumentFragment();

  if (historyList) historyList.innerHTML = "";

  if (extractions.length === 0) {
    UIStats.valBrews.textContent = "0";
    UIStats.valAvgTime.textContent = "0:00";
    UIStats.valAvgYield.textContent = "0";
    UIStats.valAvgPours.textContent = "0";
    UIStats.valTotalCoffee.textContent = "0";
    if (historyList)
      historyList.innerHTML = `<li style="color: var(--fg-dim); opacity: 0.5;">no data yet.</li>`;
    UIStats.screen.classList.add("is-visible");
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

  UIStats.valBrews.textContent = extractions.length.toString();

  if (pouroverCount > 0) {
    const avgTime = sumTime / pouroverCount;
    const m = Math.floor(avgTime / 60);
    const s = Math.floor(avgTime % 60)
      .toString()
      .padStart(2, "0");

    UIStats.valAvgTime.textContent = `${m}:${s}`;
    UIStats.valAvgYield.textContent = (sumYield / pouroverCount).toFixed(0);
    UIStats.valAvgPours.textContent = (sumPours / pouroverCount).toFixed(1);
    UIStats.valTotalCoffee.textContent = (sumYield / 15).toFixed(0);
  } else {
    UIStats.valAvgTime.textContent = "0:00";
    UIStats.valAvgYield.textContent = "0";
    UIStats.valAvgPours.textContent = "0";
    UIStats.valTotalCoffee.textContent = "0";
  }

  UIStats.screen.classList.add("is-visible");
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

UIStats.btnClose.addEventListener("click", () => {
  UIStats.screen.classList.remove("is-visible");
});

UIStats.btnExport.addEventListener("click", () => exportData());

requestAnimationFrame(renderFrame);

// --- DEV MODE (MOCK DE DADOS) ---
const btnSimulate = document.getElementById("btn-simulate");
let simInterval = null; // Armazena a referência para limpar processos paralelos

btnSimulate.addEventListener("click", () => {
  requestWakeLock();
  // enterFullScreen();
  document.body.classList.remove("state-disconnected");
  document.getElementById("status-indicator").textContent = "sim";

  isSimulating = true;
  resetExtraction();

  if (simInterval) clearInterval(simInterval);

  simInterval = setInterval(() => {
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
