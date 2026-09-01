// ==========================================================================
// RESTAURAÇÃO DE SCROLL DO IDIOMA (DEVE RODAR ANTES DE TUDO)
// ==========================================================================
(function restoreLanguageScroll() {
  const savedScroll = sessionStorage.getItem("langSwitchScroll");

  if (savedScroll !== null) {
    sessionStorage.removeItem("langSwitchScroll");

    // 1. Avisa o sistema e salva a coordenada alvo globalmente
    window.isLanguageSwitchJump = true;
    window.targetLangScroll = parseInt(savedScroll, 10);

    setTimeout(() => {
      window.scrollTo({ top: window.targetLangScroll, behavior: "auto" });

      // 2. Garante que a barra apareça
      const nav = document.querySelector(".nav");
      if (nav) {
        nav.classList.remove("nav--hidden");
        if (window.targetLangScroll > 10) nav.classList.add("nav--scrolled");
      }

      // 3. Aumenta a trava para 800ms (Ignora eventos de scroll fantasmas do carregamento)
      setTimeout(() => {
        window.isLanguageSwitchJump = false;
      }, 800);
    }, 0);
  }
})();

// ==========================================================================
// MOTOR GLOBAL (ANIMAÇÕES, PARALLAX, NAVEGAÇÃO E UTILIDADES)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // --- 1. REVEAL SLIDE-UP ---
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
  );
  document.querySelectorAll(".reveal-element").forEach((el) => observer.observe(el));

  // --- 2. ANCORAGEM SUAVE DO RODAPÉ ---
  const contactLinks = document.querySelectorAll('a[href*="#contact"]');
  contactLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      const path = window.location.pathname;
      // Valida ambas as rotas
      if (path.includes("/sobre") || path.includes("/about")) {
        e.preventDefault();
        const contactSection = document.getElementById("contact");
        if (contactSection) contactSection.scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  // --- 3. CÓPIA DE E-MAIL GLOBAL (DELEGAÇÃO DE EVENTOS) ---
  document.body.addEventListener("click", (e) => {
    const emailLink = e.target.closest('a[href^="mailto:"]');
    if (emailLink) {
      const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (isDesktop) {
        e.preventDefault();
        const email = emailLink
          .getAttribute("href")
          .replace(/^mailto:/i, "")
          .split("?")[0];
        const originalText = emailLink.textContent;

        navigator.clipboard
          .writeText(email)
          .then(() => {
            emailLink.textContent = "E-mail copiado :)";
            setTimeout(() => {
              emailLink.textContent = originalText;
            }, 2000);
          })
          .catch((err) => {
            console.error("Erro ao copiar e-mail: ", err);
            window.location.href = `mailto:${email}`;
          });
      }
    }
  });

  // --- 4. MENU SANFONA GLOBAL ---
  const accordionHeaders = document.querySelectorAll(".accordion-header");
  accordionHeaders.forEach((header) => {
    header.addEventListener("click", function () {
      const item = this.parentElement;
      const isActive = item.classList.contains("is-active");

      document.querySelectorAll(".accordion-item").forEach((accItem) => {
        accItem.classList.remove("is-active");
        accItem.querySelector(".accordion-header").setAttribute("aria-expanded", "false");
      });

      if (!isActive) {
        item.classList.add("is-active");
        this.setAttribute("aria-expanded", "true");
        if (window.innerWidth <= 1000) {
          setTimeout(() => {
            item.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 300);
        }
      }
    });
  });

  // ==========================================================================
  // 5. MOTOR UNIFICADO (PARALLAX, FADE E SMART NAV)
  // ==========================================================================

  // Otimização Sênior: Mapeia as imagens UMA vez antes do scroll iniciar
  const parallaxItems = Array.from(
    document.querySelectorAll(".funnel-img-wrapper, .img-philosophy-hero"),
  ).map((wrapper) => ({
    wrapper,
    img: wrapper.querySelector("img"),
  }));

  const fadeElements = document.querySelectorAll(".fade-on-scroll");
  const nav = document.querySelector(".nav");

  let isScrolling = false;
  let lastScrollY =
    window.targetLangScroll !== undefined ? window.targetLangScroll : window.scrollY;
  let cachedViewportHeight = window.innerHeight;
  let cachedViewportWidth = window.innerWidth;

  window.addEventListener("resize", () => {
    if (window.innerWidth !== cachedViewportWidth) {
      cachedViewportHeight = window.innerHeight;
      cachedViewportWidth = window.innerWidth;
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!isScrolling) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          const viewportHeight = cachedViewportHeight;

          // SMART NAV
          if (nav) {
            if (currentScrollY > 10) nav.classList.add("nav--scrolled");
            else nav.classList.remove("nav--scrolled");

            // SE FOI UM PULO DE IDIOMA: Mantém a barra e recalibra a referência
            if (window.isLanguageSwitchJump) {
              nav.classList.remove("nav--hidden");
              lastScrollY = currentScrollY; // Zera a régua a partir daqui
            } else {
              // LÓGICA NORMAL DE SCROLL
              const scrollDifference = Math.abs(currentScrollY - lastScrollY);
              const scrollThreshold = 80;

              if (scrollDifference > scrollThreshold || currentScrollY <= 0) {
                if (currentScrollY > lastScrollY && currentScrollY > 80) {
                  // Rolando para baixo
                  nav.classList.add("nav--hidden");
                } else if (currentScrollY < lastScrollY || currentScrollY <= 0) {
                  // Rolando para cima
                  nav.classList.remove("nav--hidden");
                }
                lastScrollY = currentScrollY;
              }
            }
          }

          // PARALLAX (Prevenção de Layout Thrashing: Ler -> Escrever)
          const parallaxUpdates = [];

          // PASSO 1: Apenas leitura (Rápido)
          parallaxItems.forEach(({ wrapper, img }) => {
            const rect = wrapper.getBoundingClientRect();
            if (rect.top < viewportHeight && rect.bottom > 0) {
              const scrollProgress = rect.top / viewportHeight - 0.5;
              const yOffset = scrollProgress * (rect.height * 0.15);
              parallaxUpdates.push({ img, yOffset });
            }
          });

          // PASSO 2: Apenas escrita em lote (Sem recalcular layout)
          parallaxUpdates.forEach(({ img, yOffset }) => {
            if (img) img.style.setProperty("--parallax-y", `${yOffset}px`);
          });

          // FADE BLINDADO (Usa a largura no cache)
          if (fadeElements.length > 0) {
            if (cachedViewportWidth <= 1000) {
              const scrollBottom = window.scrollY + viewportHeight;
              const docHeight = document.documentElement.scrollHeight;
              const distanceToBottom = docHeight - scrollBottom;

              const fadeStart = viewportHeight * 0.3;
              const fadeEnd = viewportHeight * 0.15;

              let groupOpacity = 1;
              if (distanceToBottom < fadeStart) {
                groupOpacity = (distanceToBottom - fadeEnd) / (fadeStart - fadeEnd);
                groupOpacity = Math.max(0, Math.min(1, groupOpacity));
              }
              fadeElements.forEach((el) => (el.style.opacity = groupOpacity));
            } else {
              fadeElements.forEach((el) => (el.style.opacity = 1));
            }
          }

          isScrolling = false;
        });
        isScrolling = true;
      }
    },
    { passive: true },
  );
});

// ==========================================================================
// LIMPEZA DA URL E SCROLL CROSS-PAGE
// ==========================================================================
window.addEventListener("load", () => {
  if (window.location.hash === "#contact") {
    const contactSection = document.getElementById("contact");

    if (contactSection) {
      setTimeout(() => {
        contactSection.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }

    setTimeout(() => {
      history.replaceState(null, null, window.location.pathname + window.location.search);
    }, 600);
  }
});
