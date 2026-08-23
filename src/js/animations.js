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

  // 3. PARALLAX UNIFICADO (Executado livremente no Desktop e Mobile!)
  const parallaxWrappers = document.querySelectorAll(".funnel-img-wrapper, .img-philosophy-hero");
  const fadeElements = document.querySelectorAll(".fade-on-scroll");
  let isScrolling = false;

  window.addEventListener(
    "scroll",
    () => {
      if (!isScrolling) {
        window.requestAnimationFrame(() => {
          const viewportHeight = window.innerHeight;

          // O Motor do Parallax agora lê TODAS as telas
          parallaxWrappers.forEach((wrapper) => {
            const rect = wrapper.getBoundingClientRect();
            if (rect.top < viewportHeight && rect.bottom > 0) {
              const scrollProgress = rect.top / viewportHeight - 0.5;
              const yOffset = scrollProgress * (rect.height * 0.15);
              const img = wrapper.querySelector("img");
              if (img) img.style.setProperty("--parallax-y", `${yOffset}px`);
            }
          });

          // Lógica de Fade Out do CV mantida...
          const fadeTrigger = document.querySelector(".cv-contact");
          if (fadeElements.length > 0 && fadeTrigger) {
            if (window.innerWidth <= 1000) {
              const triggerRect = fadeTrigger.getBoundingClientRect();
              const fadeStart = viewportHeight;
              const fadeEnd = viewportHeight * 0.65;
              let groupOpacity = 1;
              if (triggerRect.top < fadeStart) {
                groupOpacity = Math.max(0, (triggerRect.top - fadeEnd) / (fadeStart - fadeEnd));
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

// 4. LIMPEZA DA URL (Gatilho isolado aguardando carregamento total da rede)
window.addEventListener("load", () => {
  if (window.location.hash === "#contact") {
    setTimeout(() => {
      history.replaceState(null, null, window.location.pathname + window.location.search);
    }, 100);
  }
});
