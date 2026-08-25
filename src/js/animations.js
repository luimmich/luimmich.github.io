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
      if (window.location.pathname.includes("/sobre")) {
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
  let lastScrollY = window.scrollY;
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

            if (currentScrollY > lastScrollY && currentScrollY > 80)
              nav.classList.add("nav--hidden");
            else if (currentScrollY < lastScrollY || currentScrollY <= 0)
              nav.classList.remove("nav--hidden");
          }
          lastScrollY = currentScrollY;

          // PARALLAX (Agora lê direto da memória, sem querySelector)
          parallaxItems.forEach(({ wrapper, img }) => {
            const rect = wrapper.getBoundingClientRect();
            if (rect.top < viewportHeight && rect.bottom > 0) {
              const scrollProgress = rect.top / viewportHeight - 0.5;
              const yOffset = scrollProgress * (rect.height * 0.15);
              if (img) img.style.setProperty("--parallax-y", `${yOffset}px`);
            }
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
// LIMPEZA DA URL (Gatilho isolado aguardando rede)
// ==========================================================================
window.addEventListener("load", () => {
  if (window.location.hash === "#contact") {
    setTimeout(() => {
      history.replaceState(null, null, window.location.pathname + window.location.search);
    }, 100);
  }
});
