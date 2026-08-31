document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.querySelector(".mobile-menu-btn");
  const closeBtn = document.querySelector(".mobile-close-btn");
  const overlay = document.querySelector(".mobile-overlay");
  const body = document.body;

  const navLinks = document.querySelectorAll(".mobile-nav-list a");

  const getScrollbarWidth = () => {
    return window.innerWidth - document.documentElement.clientWidth;
  };

  const closeMenu = () => {
    overlay.classList.remove("is-active");
    body.classList.remove("modal-open");
    menuBtn.setAttribute("aria-expanded", "false");

    // Remove a compensação e restaura a página
    body.style.paddingRight = "";
  };

  const toggleMenu = () => {
    const isOpen = overlay.classList.contains("is-active");

    if (!isOpen) {
      const scrollbarWidth = getScrollbarWidth();
      body.style.paddingRight = `${scrollbarWidth}px`;

      overlay.classList.add("is-active");
      body.classList.add("modal-open");
      menuBtn.setAttribute("aria-expanded", "true");
    } else {
      closeMenu();
    }
  };

  if (menuBtn && closeBtn && overlay) {
    menuBtn.addEventListener("click", toggleMenu);
    closeBtn.addEventListener("click", toggleMenu);

    // CAMADA DE DEFESA UX: Clicou no link, fecha o menu imediatamente
    if (menuBtn && closeBtn && overlay) {
      menuBtn.addEventListener("click", toggleMenu);
      closeBtn.addEventListener("click", toggleMenu);

      // ==========================================================================
      // A ESTRATÉGIA DA CORTINA
      // ==========================================================================
      navLinks.forEach((link) => {
        link.addEventListener("click", (e) => {
          // Verifica se o link é apenas uma âncora para a MESMA página (ex: #contato)
          const href = link.getAttribute("href");
          const isAnchor = href.startsWith("#");

          if (isAnchor) {
            // Se for âncora, a página não vai recarregar, então fechamos o menu na hora
            closeMenu();
          }

          // SE FOR OUTRA PÁGINA:
          // Nós simplesmente não fazemos nada!
          // O menu continua cobrindo a tela antiga até que a nova página seja renderizada.
        });
      });
    }

    if (menuBtn && closeBtn && overlay) {
      menuBtn.addEventListener("click", toggleMenu);
      closeBtn.addEventListener("click", toggleMenu);

      // ==========================================================================
      // A ESTRATÉGIA DA CORTINA COM FEEDBACK VISUAL
      // ==========================================================================
      navLinks.forEach((link) => {
        link.addEventListener("click", (e) => {
          const href = link.getAttribute("href");
          const isAnchor = href.startsWith("#");

          if (isAnchor) {
            closeMenu();
          } else {
            // 1. Adiciona a classe que faz o botão piscar imediatamente
            link.classList.add("is-loading");
            // 2. O menu continua aberto escondendo a tela velha
          }
        });
      });
    }

    // CAMADA DE DEFESA BFCACHE (O Faxineiro)
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        closeMenu();
        // Remove o efeito de "carregando" de todos os links caso a usuária volte para cá
        navLinks.forEach((link) => link.classList.remove("is-loading"));
      }
    });

    // CAMADA DE DEFESA BFCACHE (Garante o botão "Voltar" livre de bugs)
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        closeMenu();
      }
    });
  }

  // CAMADA DE DEFESA BFCACHE: Se a página for restaurada pelo botão "Voltar" do navegador
  window.addEventListener("pageshow", (event) => {
    // event.persisted indica que a página foi carregada do cache do navegador
    if (event.persisted) {
      closeMenu();
    }
  });
});
