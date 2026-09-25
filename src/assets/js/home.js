function ajustarHeroDinamicamente() {
  const hero = document.querySelector(".hero");
  const nav = document.querySelector(".nav");
  const ul = hero ? hero.querySelector("ul") : null;

  // Removido o footer daqui, eliminando pontos de falha
  if (!hero || !nav || !ul) return;

  const items = Array.from(ul.querySelectorAll("li"));
  if (items.length === 0) return;

  // PAINEL DE CONTROLE
  const config = {
    mobileBreakpoint: 1000,
    maxMobileItens: 5,
    margemMinimaDesktop: 120,
    margemMinimaMobile: 120,
  };

  const isMobile = window.innerWidth <= config.mobileBreakpoint;
  const margemExigida = isMobile ? config.margemMinimaMobile : config.margemMinimaDesktop;

  // 1. ÁREA LIVRE
  const viewportHeight = document.documentElement.clientHeight;
  const navHeight = nav.offsetHeight;
  const alturaMaximaHero = viewportHeight - navHeight - margemExigida * 2;

  // 2. MATEMÁTICA DA GRID (Usamos apenas o item 0, que sempre está visível, evitando o Layout Thrashing)
  const itemHeight = items[0].offsetHeight;
  const gap = parseFloat(window.getComputedStyle(ul).rowGap) || 0;

  // 3. O VEREDITO
  let quantidadePermitida = Math.floor((alturaMaximaHero + gap) / (itemHeight + gap));

  // Regras de Segurança
  if (quantidadePermitida < 1) quantidadePermitida = 2;
  if (isMobile && quantidadePermitida > config.maxMobileItens) {
    quantidadePermitida = config.maxMobileItens;
  }

  // 4. APLICA O CORTE SILENCIOSAMENTE
  items.forEach((item, index) => {
    // Busca a imagem associada verificando o irmão direto
    const picture =
      item.nextElementSibling && item.nextElementSibling.classList.contains("hero-picture-wrapper")
        ? item.nextElementSibling
        : null;

    // Se estiver fora do limite, esconde. Se estiver dentro, garante que está visível.
    if (index >= quantidadePermitida) {
      item.classList.add("vh-hidden");
      if (picture) picture.classList.add("vh-hidden");
    } else {
      item.classList.remove("vh-hidden");
      if (picture) picture.classList.remove("vh-hidden");
    }
  });

  // 5. REVELA A TELA
  ul.classList.add("grid-calculado");
}

window.addEventListener("DOMContentLoaded", ajustarHeroDinamicamente);
window.addEventListener("load", ajustarHeroDinamicamente);

// ==========================================================================
// A BLINDAGEM MOBILE (Ignora a barra do navegador)
// ==========================================================================
let larguraAnterior = window.innerWidth;
let resizeFrame = 0;

window.addEventListener("resize", () => {
  if (window.innerWidth === larguraAnterior) return;
  larguraAnterior = window.innerWidth;

  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(ajustarHeroDinamicamente);
});
