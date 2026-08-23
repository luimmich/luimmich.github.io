// ==========================================================================
// ANIMAÇÕES EDITORIAIS (Slide-up & Parallax Globais)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // 1. SLIDE-UP (Monitoramento de tela)
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    },
  );

  document.querySelectorAll(".reveal-element").forEach((el) => {
    observer.observe(el);
  });

  const parallaxWrappers = document.querySelectorAll(".funnel-img-wrapper");
  const fadeElements = document.querySelectorAll(".fade-on-scroll"); // Captura os itens a dissolver
  let isScrolling = false;

  window.addEventListener(
    "scroll",
    () => {
      if (!isScrolling) {
        window.requestAnimationFrame(() => {
          const viewportHeight = window.innerHeight;

          // ==========================================
          // LÓGICA DO PARALLAX (Mantida intacta)
          // ==========================================
          parallaxWrappers.forEach((wrapper) => {
            const rect = wrapper.getBoundingClientRect();

            if (rect.top < viewportHeight && rect.bottom > 0) {
              const scrollProgress = rect.top / viewportHeight - 0.5;
              const yOffset = scrollProgress * (rect.height * 0.15);

              const img = wrapper.querySelector("img");
              if (img) img.style.setProperty("--parallax-y", `${yOffset}px`);
            }
          });

          const fadeTrigger = document.querySelector(".cv-contact");

          if (fadeElements.length > 0 && fadeTrigger) {
            // Verifica se a tela é mobile (usando a mesma matemática do seu CSS)
            if (window.innerWidth <= 1000) {
              const triggerRect = fadeTrigger.getBoundingClientRect();

              const fadeStart = viewportHeight;
              const fadeEnd = viewportHeight * 0.65;

              let groupOpacity = 1;

              if (triggerRect.top < fadeStart) {
                groupOpacity = Math.max(0, (triggerRect.top - fadeEnd) / (fadeStart - fadeEnd));
              }

              fadeElements.forEach((el) => {
                el.style.opacity = groupOpacity;
              });
            } else {
              // NO DESKTOP: Garante que nada suma e zera qualquer opacidade residual
              fadeElements.forEach((el) => {
                el.style.opacity = 1;
              });
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

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // NAVEGAÇÃO SILENCIOSA (UX DE URL LIMPA PARA O #CONTACT)
  // ==========================================================================

  // CENÁRIO 1: O usuário veio de outra página (ex: Home)
  // Se a URL carregou com um hash (ex: #contact), nós o apagamos da barra
  if (window.location.hash === "#contact") {
    // Esperamos 100ms para o navegador fazer o salto físico nativo até a seção
    setTimeout(() => {
      // Reescreve a URL na barra mantendo apenas o caminho (ex: /sobre/)
      history.replaceState(null, null, window.location.pathname + window.location.search);
    }, 100);
  }

  // CENÁRIO 2: O usuário clica no rodapé e JÁ ESTÁ na página Sobre
  const contactLinks = document.querySelectorAll('a[href*="#contact"]');

  contactLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      // Se a página atual já for a /sobre/
      if (window.location.pathname.includes("/sobre")) {
        // Bloqueia a ação nativa do link (que sujaria a URL)
        e.preventDefault();

        // Pega o elemento e faz o scroll suave via JavaScript
        const contactSection = document.getElementById("contact");
        if (contactSection) {
          contactSection.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
  });
});
