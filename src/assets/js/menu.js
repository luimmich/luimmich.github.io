document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.querySelector(".mobile-menu-btn");
  const closeBtn = document.querySelector(".mobile-close-btn");
  const overlay = document.querySelector(".mobile-overlay");
  const body = document.body;
  const navLinks = document.querySelectorAll(".mobile-nav-list a");

  const closeMenu = () => {
    if (!overlay) return;
    overlay.classList.remove("is-active");
    body.classList.remove("modal-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    body.style.paddingRight = "";
  };

  const toggleMenu = () => {
    if (overlay.classList.contains("is-active")) {
      closeMenu();
      return;
    }
    body.style.paddingRight = `${window.innerWidth - document.documentElement.clientWidth}px`;
    overlay.classList.add("is-active");
    body.classList.add("modal-open");
    menuBtn.setAttribute("aria-expanded", "true");
  };

  if (menuBtn && closeBtn && overlay) {
    menuBtn.addEventListener("click", toggleMenu);
    closeBtn.addEventListener("click", toggleMenu);
  }

  // Âncora na mesma página fecha o menu; troca de página deixa a cortina
  // cobrindo a tela velha até a nova renderizar.
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (link.getAttribute("href").startsWith("#")) closeMenu();
      else link.classList.add("is-loading");
    });
  });

  // BFCACHE: limpa o estado ao voltar pelo botão "Voltar"
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    closeMenu();
    navLinks.forEach((link) => link.classList.remove("is-loading"));
  });
});
