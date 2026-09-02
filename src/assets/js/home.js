// Debounce protege a performance do celular
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

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
  if (quantidadePermitida < 1) quantidadePermitida = 1;
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

window.addEventListener(
  "resize",
  debounce(() => {
    const larguraAtual = window.innerWidth;

    // Só recalcula o Hero se a LARGURA da tela mudar (ex: girar o celular).
    // Se apenas a altura mudar (barra do navegador sumindo no scroll), ele ignora silenciosamente.
    if (larguraAtual !== larguraAnterior) {
      larguraAnterior = larguraAtual;
      ajustarHeroDinamicamente();
    }
  }, 150),
);
