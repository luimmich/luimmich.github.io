document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll("button.archive-tag-container[data-target]");
  const closeBtn = document.getElementById("close-folder-btn");
  let activeTargetId = null;

  // 1. O NOSSO CADEADO DE SEGURANÇA
  let isAutoScrolling = false;

  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = tab.getAttribute("data-target");

      if (activeTargetId === targetId) return;

      if (activeTargetId) {
        closeCurrentFolder();
      }

      activeTargetId = targetId;
      tab.classList.add("is-pulled");
      tab.setAttribute("aria-expanded", "true");

      setTimeout(() => {
        const targetSheet = document.getElementById(`archive-sheet-${targetId}`);

        if (targetSheet) {
          targetSheet.classList.add("is-open");

          const offsetViewport = window.innerHeight * 0.2;
          const elementPosition = targetSheet.getBoundingClientRect().top;
          const finalScrollPosition = elementPosition + window.pageYOffset - offsetViewport;

          // 2. TRANCA O CADEADO ANTES DE VIAJAR
          isAutoScrolling = true;

          window.scrollTo({
            top: finalScrollPosition,
            behavior: "smooth",
          });

          closeBtn.classList.add("is-visible");

          // 3. DESTRANCA O CADEADO DEPOIS QUE A ROLAGEM TERMINA (800ms)
          setTimeout(() => {
            isAutoScrolling = false;
          }, 800);
        }
      }, 300);
    });
  });

  closeBtn.addEventListener("click", () => {
    // Tranca o cadeado aqui também para não dar conflito na subida
    isAutoScrolling = true;

    window.scrollTo({ top: 0, behavior: "smooth" });
    closeBtn.classList.remove("is-visible");

    setTimeout(() => {
      closeCurrentFolder();
      isAutoScrolling = false; // Destranca após guardar
    }, 600);
  });

  // ==========================================================================
  // O FECHAMENTO AUTOMÁTICO POR SCROLL (AGORA PROTEGIDO)
  // ==========================================================================
  window.addEventListener(
    "scroll",
    () => {
      // 4. SÓ FECHA A PASTA SE O CADEADO ESTIVER DESTRANCADO (ou seja, se foi o dedo do usuário rolando)
      if (!isAutoScrolling && activeTargetId && window.scrollY < 100) {
        closeCurrentFolder();
      }
    },
    { passive: true },
  );

  function closeCurrentFolder() {
    if (!activeTargetId) return;

    const activeTab = document.querySelector(`button[data-target="${activeTargetId}"]`);
    const activeSheet = document.getElementById(`archive-sheet-${activeTargetId}`);

    if (activeTab) {
      activeTab.classList.remove("is-pulled");
      activeTab.setAttribute("aria-expanded", "false");
    }

    if (activeSheet) {
      activeSheet.classList.remove("is-open");
    }

    closeBtn.classList.remove("is-visible");
    activeTargetId = null;
  }
});
