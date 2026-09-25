// dev-mode.js — MODO DEV TEMPORÁRIO (mock de extração para testar a UI sem balança).
//
// PARA REMOVER: apague este arquivo e a linha <script src="/js/scale/dev-mode.js">
// em src/simple-scale/index.njk. Nada mais referencia este código.
//
// Fluxo: clique em "dev" (revela o app e dosa 18.5g) e depois no botão do timer
// para iniciar os despejos, igual à extração real.
//
// ponytail: dirige a UI escrevendo direto em brewState (já exportado pelo decoder),
// então não precisa de nenhum gancho no app.js.
// Ceiling: não suprime os comandos BLE nem o auto-disconnect ocioso do app (sem
// balança os comandos viram no-op). Upgrade: exportar um flag isSimulating do app.js
// se isso atrapalhar.
import { brewState } from "./timemore-decoder.js";

const COFFEE_DOSE_G = 18.5;
const POURS = 5;

const btn = document.createElement("button");
btn.id = "btn-simulate";
btn.className = "btn-overlay";
btn.textContent = "dev";
btn.setAttribute("aria-label", "Entrar em modo de desenvolvimento");
document.getElementById("connection-overlay")?.appendChild(btn);

let simInterval = null;

btn.addEventListener("click", () => {
  document.body.classList.remove("state-disconnected");
  document.body.classList.add("is-ready");
  const indicator = document.getElementById("status-indicator");
  if (indicator) indicator.textContent = "sim";

  clearInterval(simInterval);

  let weight = 0;
  let time = 0;
  let poursDone = 0;
  let pouring = false;
  let pourTarget = 0;
  let pauseUntil = 0;

  simInterval = setInterval(() => {
    // O app marca is-running/is-done conforme o estado do cronômetro.
    const footer = document.getElementById("action-footer");
    const running = footer?.classList.contains("is-running");
    let flow = 0;

    if (weight < COFFEE_DOSE_G) {
      flow = 5.0;
      weight = Math.min(weight + flow * 0.05, COFFEE_DOSE_G);
    } else if (running && poursDone < POURS) {
      time += 0.05;
      if (!pouring && time >= pauseUntil) {
        pouring = true;
        pourTarget = weight + 30 + Math.random() * 30;
      }
      if (pouring) {
        flow = 6 + (Math.random() * 0.5 - 0.25);
        weight += flow * 0.05;
        if (weight >= pourTarget) {
          weight = pourTarget;
          pouring = false;
          poursDone++;
          pauseUntil = time + 15.0;
        }
      } else {
        flow = Math.random() * 0.1;
      }
    } else if (footer?.classList.contains("is-done")) {
      // Sem mais despejos, o fluxo já caiu a 0: encerra quando o app fecha a extração.
      clearInterval(simInterval);
    }

    brewState.weight = weight;
    if (running) brewState.time = time;
    brewState.flowRateEMA = flow;
    brewState.isStable = flow < 0.5;
    brewState._isDirty = true;
  }, 50);
});
