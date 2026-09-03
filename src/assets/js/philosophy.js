document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // 1. SISTEMA DE CLIQUE E ACORDEÃO (TRAVA DE LIVRO ATIVO)
  // ==========================================================================
  const books = document.querySelectorAll(".book-item");

  books.forEach((book) => {
    book.addEventListener("click", function () {
      if (this.classList.contains("is-open")) return;
      books.forEach((b) => b.classList.remove("is-open"));
      this.classList.add("is-open");

      if (window.innerWidth <= 1000) {
        setTimeout(() => {
          this.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    });
  });
  // ==========================================================================
  // 1.5 SISTEMA DE DEEP LINK (ABRE O LIVRO VINDO DA HOME)
  // ==========================================================================
  const openBookFromHash = () => {
    const hash = window.location.hash;

    const releaseScreen = () => {
      document.documentElement.classList.remove("hash-loading");
      document.documentElement.classList.add("hash-loading-done");
    };

    if (!hash) {
      releaseScreen();
      return;
    }

    let targetBook;
    try {
      targetBook = document.querySelector(hash);
    } catch (e) {
      releaseScreen();
      return;
    }

    if (!targetBook || !targetBook.classList.contains("book-item")) {
      releaseScreen();
      return;
    }

    const executePerfectJump = () => {
      try {
        const styleBlock = document.createElement("style");
        styleBlock.innerHTML =
          "* { transition: none !important; animation: none !important; scroll-behavior: auto !important; }";
        document.head.appendChild(styleBlock);

        books.forEach((b) => b.classList.remove("is-open"));
        targetBook.classList.add("is-open");

        void targetBook.offsetHeight; // Reflow

        setTimeout(() => {
          // 1. O SALTO BRUTO (Invisível) - Leva a tela para o local aproximado
          window.isLanguageSwitchJump = true;
          targetBook.scrollIntoView({ behavior: "auto", block: "center" });

          const nav = document.querySelector(".nav");
          if (nav) {
            nav.classList.remove("nav--hidden");
            nav.classList.add("nav--scrolled");
          }

          setTimeout(() => {
            styleBlock.remove();
            releaseScreen(); // Revela a página HTML

            // Aumentamos o tempo da trava do nav para cobrir o ajuste magnético
            setTimeout(() => {
              window.isLanguageSwitchJump = false;
            }, 600);

            // 2. A COREOGRAFIA (O livro surge suavemente)
            targetBook.animate(
              [
                { opacity: 0.3, transform: "translateY(0px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
              {
                duration: 700,
                easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
                fill: "both",
              },
            );

            setTimeout(() => {
              targetBook.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 400);
          }, 50);
        }, 50);
      } catch (e) {
        releaseScreen();
      }
    };

    let hasFired = false;
    const safeExecute = () => {
      if (hasFired) return;
      hasFired = true;
      executePerfectJump();
    };

    const fallbackTimer = setTimeout(safeExecute, 800);

    if (document.readyState === "complete") {
      clearTimeout(fallbackTimer);
      safeExecute();
    } else {
      window.addEventListener("load", () => {
        clearTimeout(fallbackTimer);
        safeExecute();
      });
    }
  };

  openBookFromHash();

  // ==========================================================================
  // 2. MOTOR MATEMÁTICO DE CORTE DE TEXTO (AGORA BLINDADO CONTRA ZUMBIS)
  // ==========================================================================

  const clampObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      // 1. Agora o alvo é o contêiner PAI (a página inteira do livro)
      const bookContent = entry.target;
      const excerpt = bookContent.querySelector(".book-excerpt");

      if (!excerpt) continue;

      // 2. Resetamos a tesoura temporariamente
      excerpt.style.webkitLineClamp = "unset";

      // 3. O Truque: Forçamos o texto a esticar apenas neste milissegundo
      // para o JavaScript conseguir medir qual é o espaço físico disponível
      excerpt.style.flexGrow = "1";
      const availableHeight = excerpt.clientHeight;

      // 4. Removemos o estiramento IMEDIATAMENTE.
      // Isso encolhe a caixa de volta e extermina as "Linhas Zumbis"
      excerpt.style.flexGrow = "0";

      // 5. Executamos a matemática com o espaço que medimos
      const computedStyle = window.getComputedStyle(excerpt);
      const lineHeight = parseFloat(computedStyle.lineHeight);

      if (lineHeight > 0) {
        const maxLines = Math.floor(availableHeight / lineHeight);
        excerpt.style.webkitLineClamp = maxLines > 0 ? maxLines : 1;
      }
    }
  });

  // 🚨 ATENÇÃO AQUI: Nós engatamos o observador na classe .book-content (O Pai),
  // e não mais no .book-excerpt. Isso impede que o JS entre em loop infinito.
  const bookContents = document.querySelectorAll(".book-content");
  bookContents.forEach((content) => clampObserver.observe(content));

  // ==========================================================================
  // 3. O EASTER EGG (Leitura limpa via JSON isolado)
  // ==========================================================================

  const rows = document.querySelectorAll(".bookshelf-row");
  const dataTag = document.getElementById("tilted-books-data"); // Captura a ponte de dados

  if (rows.length > 0 && dataTag) {
    // 1. Converte o texto da tag invisível de volta para um Array JSON perfeito
    const tiltedBooksPool = JSON.parse(dataTag.textContent);

    const lastRow = rows[rows.length - 1];
    const randomBook = tiltedBooksPool[Math.floor(Math.random() * tiltedBooksPool.length)];

    const tiltedLi = document.createElement("li");
    tiltedLi.className = "book-item tilted-book";
    tiltedLi.style.setProperty("--book-color", randomBook.color);
    tiltedLi.style.setProperty("--book-height", randomBook.height);

    tiltedLi.innerHTML = `
      <div class="book-spine">
        <span class="book-title-vertical">
          <span class="book-spine-main">${randomBook.title}</span>
          ${randomBook.subtitle ? `<span class="book-spine-sub">${randomBook.subtitle}</span>` : ""}
        </span>
      </div>
      <div class="book-content">
        ${
          randomBook.type
            ? `
        <div class="book-meta">
          <span class="small-caps">${randomBook.type}</span>
          ${randomBook.publication ? `<span class="book-meta-divider">&bull;</span><span class="book-publication">${randomBook.publication}</span>` : ""}
        </div>`
            : ""
        }
        <h2 class="book-title-expanded">
          ${randomBook.title}
          ${randomBook.subtitle ? `<span class="book-subtitle-expanded">${randomBook.subtitle}</span>` : ""}
        </h2>
        ${randomBook.coauthors ? `<p class="book-coauthors">Com ${randomBook.coauthors}</p>` : ""}
        ${randomBook.excerpt ? `<p class="book-excerpt">${randomBook.excerpt}</p>` : ""}
        ${randomBook.link ? `<a href="${randomBook.link}" target="_blank" rel="noopener noreferrer" class="book-btn">Ler publicação &rarr;</a>` : ""}
      </div>
    `;

    lastRow.appendChild(tiltedLi);
  }
});
