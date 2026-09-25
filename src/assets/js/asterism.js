document.addEventListener("DOMContentLoaded", () => {
  // ============================================================================
  // 1. CONFIGURAÇÕES GERAIS
  // ============================================================================
  const CONFIG = {
    totalStars: 350,
    minDistance: 60,
    starRadius: 10,
    margin: 200,
    maxAttempts: 500,
  };

  // ============================================================================
  // SISTEMA ANTI-ZOOM FORÇADO (Ativado via body.modal-open)
  // ============================================================================
  document.addEventListener(
    "touchmove",
    (event) => {
      if (document.body.classList.contains("modal-open") && event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      if (document.body.classList.contains("modal-open")) {
        const now = new Date().getTime();
        if (now - lastTouchEnd <= 300) {
          event.preventDefault();
        }
        lastTouchEnd = now;
      }
    },
    { passive: false },
  );

  // ============================================================================
  // 2. SETUP DO CANVAS E CONTEXTO
  // ============================================================================
  const canvas = document.getElementById("skyCanvas");
  if (!canvas) return; // Failsafe if script loads on wrong page

  const ctx = canvas.getContext("2d");
  canvas.width = 3508;
  canvas.height = 4960;
  let stars = [];

  function getDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isValidPosition(newStar) {
    return !stars.some((star) => getDistance(newStar, star) < CONFIG.minDistance);
  }

  function generateSky() {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    stars = [];
    ctx.fillStyle = "#000000";

    while (stars.length < CONFIG.totalStars) {
      let attempt = 0;
      let starPlaced = false;

      while (attempt < CONFIG.maxAttempts && !starPlaced) {
        const randomX = CONFIG.margin + Math.random() * (canvas.width - CONFIG.margin * 2);
        const randomY = CONFIG.margin + Math.random() * (canvas.height - CONFIG.margin * 2);
        const newStar = { x: randomX, y: randomY };

        if (isValidPosition(newStar)) {
          stars.push(newStar);
          starPlaced = true;
        }
        attempt++;
      }

      if (!starPlaced) break;
    }

    stars.forEach((star) => {
      ctx.beginPath();
      ctx.arc(star.x, star.y, CONFIG.starRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ============================================================================
  // 3. EXPORTAÇÃO EDITORIAL (PDF Vetorizado)
  // ============================================================================
  // Carrega o DotoRounded do arquivo servido e registra no jsPDF.
  // ponytail: offline o fetch falha e o PDF sai em Helvetica em vez de quebrar.
  // Upgrade: precachear o ttf (service worker) ou voltar a embutir base64.
  async function loadDotoFont(doc) {
    try {
      const res = await fetch("/fonts/dotorounded/DotoRounded-Bold.ttf");
      if (!res.ok) return false;

      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

      doc.addFileToVFS("DotoRounded-Bold.ttf", btoa(binary));
      doc.addFont("DotoRounded-Bold.ttf", "DotoRounded", "bold");
      return true;
    } catch (err) {
      console.warn("DotoRounded indisponível, usando fonte padrão.", err);
      return false;
    }
  }

  async function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a3" });
    const hasDoto = await loadDotoFont(doc);

    const pdfWidth = 297;
    const pdfHeight = 420;
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pdfWidth, pdfHeight, "F");

    const scaleX = pdfWidth / canvas.width;
    const scaleY = pdfHeight / canvas.height;

    doc.setFillColor(0, 0, 0);
    stars.forEach((star) => {
      doc.circle(star.x * scaleX, star.y * scaleY, 1.2, "F");
    });

    doc.setFont(hasDoto ? "DotoRounded" : "helvetica", "bold");
    doc.setFontSize(12);

    const textLeft = "DATA";
    const textRight = "ASTERISMO";
    const padding = 3;
    const margin = 3;
    const textHeight = 4.2;

    // --- BLOCO ESQUERDO ---
    const widthLeft = doc.getTextWidth(textLeft);
    const bgLeftX = margin;
    const bgLeftY = pdfHeight - margin - textHeight - padding * 2;
    doc.setFillColor(255, 255, 255);
    doc.rect(bgLeftX, bgLeftY, widthLeft + padding * 2, textHeight + padding * 2, "F");
    doc.setTextColor(0, 0, 0);
    doc.text(textLeft, bgLeftX + padding, bgLeftY + padding, { baseline: "top" });

    // --- BLOCO DIREITO ---
    const widthRight = doc.getTextWidth(textRight);
    const bgRightW = widthRight + padding * 2;
    const bgRightX = pdfWidth - margin - bgRightW;
    const bgRightY = pdfHeight - margin - textHeight - padding * 2;
    doc.setFillColor(255, 255, 255);
    doc.rect(bgRightX, bgRightY, bgRightW, textHeight + padding * 2, "F");
    doc.setTextColor(0, 0, 0);
    doc.text(textRight, bgRightX + padding, bgRightY + padding, { baseline: "top" });

    doc.save("asterismo-ceu-noturno.pdf");
    setTimeout(generateSky, 600);
  }

  // ============================================================================
  // 4. MOTOR DE FRICÇÃO (Cronômetro Sensorial)
  // ============================================================================
  const modal = document.getElementById("timer-modal");
  const btnOpen = document.getElementById("btn-open-timer");
  const btnClose = document.getElementById("btn-close-timer");
  const dotGrid = document.getElementById("dot-grid");
  const timeDisplay = document.getElementById("time-display");
  const btnMinus = document.getElementById("btn-time-minus");
  const btnPlus = document.getElementById("btn-time-plus");
  const btnStart = document.getElementById("btn-start-timer");

  // FIX: Root relative path for audio
  const alarmSound = new Audio("/sound/alarm.mp3");

  const TOTAL_DOTS = 60;
  let defaultTimeSeconds = 120;
  let remainingSeconds = defaultTimeSeconds;
  let timerInterval = null;
  let isRunning = false;
  let wakeLock = null;

  function createGrid() {
    dotGrid.innerHTML = "";
    for (let i = 0; i < TOTAL_DOTS; i++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      dotGrid.appendChild(dot);
    }
  }

  function updateDisplay() {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    timeDisplay.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  function updateGrid() {
    const dots = document.querySelectorAll(".dot");
    const percentSpent = 1 - remainingSeconds / defaultTimeSeconds;
    const dotsToHide = Math.floor(percentSpent * TOTAL_DOTS);

    dots.forEach((dot, index) => {
      dot.classList.toggle("spent", index < dotsToHide);
    });
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
      console.warn("Wake Lock indisponível.");
    }
  }

  function releaseWakeLock() {
    if (wakeLock !== null) {
      wakeLock.release().then(() => (wakeLock = null));
    }
  }

  function setAdjustEnabled(enabled) {
    [btnMinus, btnPlus].forEach((btn) => {
      btn.style.opacity = enabled ? "1" : "0";
      btn.style.pointerEvents = enabled ? "auto" : "none";
    });
  }

  // EVENT LISTENERS
  document.getElementById("btn-generate").addEventListener("click", generateSky);
  document.getElementById("btn-download").addEventListener("click", (e) => {
    e.preventDefault(); // Impede o link de tentar navegar
    downloadPDF();
  });

  btnOpen.addEventListener("click", () => {
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open"); // FIX: Added body class
    createGrid();
    remainingSeconds = defaultTimeSeconds;
    updateDisplay();
    updateGrid();
  });

  btnClose.addEventListener("click", () => {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open"); // FIX: Removed body class
    clearInterval(timerInterval);
    isRunning = false;
    btnStart.textContent = "COMEÇAR";
    releaseWakeLock();
    setAdjustEnabled(true);
  });

  btnPlus.addEventListener("click", () => {
    if (isRunning) return;
    defaultTimeSeconds += 30;
    remainingSeconds = defaultTimeSeconds;
    updateDisplay();
  });

  btnMinus.addEventListener("click", () => {
    if (isRunning || defaultTimeSeconds <= 30) return;
    defaultTimeSeconds -= 30;
    remainingSeconds = defaultTimeSeconds;
    updateDisplay();
  });

  btnStart.addEventListener("click", async () => {
    if (isRunning) {
      clearInterval(timerInterval);
      isRunning = false;
      btnStart.textContent = "RETOMAR";
      releaseWakeLock();
      setAdjustEnabled(true);
    } else {
      if (remainingSeconds === 0) {
        remainingSeconds = defaultTimeSeconds;
        updateGrid();
      }
      await requestWakeLock();
      isRunning = true;
      btnStart.textContent = "PAUSAR";
      setAdjustEnabled(false);

      timerInterval = setInterval(() => {
        remainingSeconds--;
        updateDisplay();
        updateGrid();

        if (remainingSeconds <= 0) {
          clearInterval(timerInterval);
          isRunning = false;
          btnStart.textContent = "RESETAR";
          releaseWakeLock();
          alarmSound.play();
          setAdjustEnabled(true);
        }
      }, 1000);
    }
  });

  // Start visual na inicialização do site
  generateSky();
});
