// ==========================================================================
// MOTOR GLOBAL (ANIMAÇÕES, PARALLAX E NAVEGAÇÃO)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // 1. REVEAL SLIDE-UP
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

  // 2. ANCORAGEM SUAVE DO RODAPÉ (Sem sujar a URL)
  const contactLinks = document.querySelectorAll('a[href*="#contact"]');
  contactLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      if (window.location.pathname.includes("/sobre")) {
        e.preventDefault();
        const contactSection = document.getElementById("contact");
        if (contactSection) contactSection.scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  // 3. MOTOR UNIFICADO: PARALLAX, FADE E SMART NAV
  const parallaxWrappers = document.querySelectorAll(".funnel-img-wrapper, .img-philosophy-hero");
  const fadeElements = document.querySelectorAll(".fade-on-scroll");
  const nav = document.querySelector(".nav");

  let isScrolling = false;
  let lastScrollY = window.scrollY;

  // =========================================================
  // BLINDAGEM CONTRA O BUG DO INSTAGRAM/SAFARI
  // Medimos a tela do lado de fora do scroll.
  // =========================================================
  let cachedViewportHeight = window.innerHeight;
  let cachedViewportWidth = window.innerWidth;

  // Só recalcula a altura se a largura mudar (ex: virar o celular)
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
          // Usamos a altura 'congelada' para ignorar a barra do Instagram
          const viewportHeight = cachedViewportHeight;

          // =========================================================
          // LÓGICA DA SMART NAV
          // =========================================================
          if (nav) {
            if (currentScrollY > 10) {
              nav.classList.add("nav--scrolled");
            } else {
              nav.classList.remove("nav--scrolled");
            }

            if (currentScrollY > lastScrollY && currentScrollY > 80) {
              nav.classList.add("nav--hidden");
            } else if (currentScrollY < lastScrollY || currentScrollY <= 0) {
              nav.classList.remove("nav--hidden");
            }
          }
          lastScrollY = currentScrollY;

          // =========================================================
          // LÓGICA DO PARALLAX
          // =========================================================
          parallaxWrappers.forEach((wrapper) => {
            const rect = wrapper.getBoundingClientRect();
            if (rect.top < viewportHeight && rect.bottom > 0) {
              const scrollProgress = rect.top / viewportHeight - 0.5;
              const yOffset = scrollProgress * (rect.height * 0.15);
              const img = wrapper.querySelector("img");
              if (img) img.style.setProperty("--parallax-y", `${yOffset}px`);
            }
          });

          // =========================================================
          // LÓGICA DE FADE (Fim de página)
          // =========================================================
          if (fadeElements.length > 0) {
            if (window.innerWidth <= 1000) {
              const scrollBottom = window.scrollY + viewportHeight;
              const docHeight = document.documentElement.scrollHeight;
              const distanceToBottom = docHeight - scrollBottom;
              const fadeThreshold = viewportHeight * 0.4;

              let groupOpacity = 1;
              if (distanceToBottom < fadeThreshold) {
                groupOpacity = Math.max(0, distanceToBottom / fadeThreshold);
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

  // ==========================================================================
  // MENU SANFONA GLOBAL
  // ==========================================================================
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

        // Centralizar no Mobile após o clique!
        if (window.innerWidth <= 1000) {
          setTimeout(() => {
            item.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 300);
        }
      }
    });
  });
});

// 4. LIMPEZA DA URL (Gatilho isolado aguardando carregamento total da rede)
window.addEventListener("load", () => {
  if (window.location.hash === "#contact") {
    setTimeout(() => {
      history.replaceState(null, null, window.location.pathname + window.location.search);
    }, 100);
  }
});

// ==========================================================================
// CÓPIA DE E-MAIL GLOBAL (DELEGAÇÃO DE EVENTOS)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", (e) => {
    // Verifica se o clique foi em um link mailto: (ou dentro dele)
    const emailLink = e.target.closest('a[href^="mailto:"]');

    if (emailLink) {
      // A sua regra original que funcionava perfeitamente
      const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

      if (isDesktop) {
        e.preventDefault(); // Bloqueia o Outlook/Mail

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
            // Fallback caso a API do Clipboard seja bloqueada
            window.location.href = `mailto:${email}`;
          });
      }
    }
  });
});
