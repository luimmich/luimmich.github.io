document.addEventListener("DOMContentLoaded", () => {
  const books = document.querySelectorAll(".book-item");

  books.forEach((book) => {
    book.addEventListener("click", function () {
      if (this.classList.contains("is-open")) return;

      books.forEach((b) => b.classList.remove("is-open"));
      this.classList.add("is-open");

      // O JS espelha a regra exata do CSS para saber se o layout vertical está ativo
      const isVerticalLayout = window.matchMedia(
        "(max-width: 1000px), (max-width: 1368px) and (pointer: coarse), (max-aspect-ratio: 4/3)",
      ).matches;

      if (isVerticalLayout) {
        setTimeout(() => {
          this.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 400);
      }
    });
  });

  // ==========================================================================
  // 1.5 SISTEMA DE DEEP LINK (ABRE O LIVRO VINDO DA HOME)
  // ==========================================================================
  const openBookFromHash = () => {
    const releaseScreen = () => {
      document.documentElement.classList.remove("hash-loading");
      document.documentElement.classList.add("hash-loading-done");
    };

    const hash = window.location.hash;
    let targetBook = null;
    try {
      targetBook = hash ? document.querySelector(hash) : null;
    } catch (e) {
      targetBook = null;
    }

    if (!targetBook || !targetBook.classList.contains("book-item")) {
      releaseScreen();
      return;
    }

    // Congela transições/animações só durante o salto para o livro não
    // "escorregar" enquanto o layout assenta. Removido no próximo frame.
    const freezeStyle = document.createElement("style");
    freezeStyle.textContent =
      "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }";
    document.head.appendChild(freezeStyle);

    books.forEach((b) => b.classList.remove("is-open"));
    targetBook.classList.add("is-open");
    void targetBook.offsetHeight;
    window.isLanguageSwitchJump = true;
    targetBook.scrollIntoView({ behavior: "auto", block: "center" });

    const nav = document.querySelector(".nav");
    if (nav) {
      nav.classList.remove("nav--hidden");
      nav.classList.add("nav--scrolled");
    }

    requestAnimationFrame(() => {
      freezeStyle.remove();
      releaseScreen();
      targetBook.animate(
        [
          { opacity: 0.3, transform: "translateY(0px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 700, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" },
      );
      setTimeout(() => {
        targetBook.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          window.isLanguageSwitchJump = false;
        }, 600);
      }, 400);
    });
  };

  // Roda no load, com fallback para não deixar a tela presa em hash-loading.
  let hashFired = false;
  const runHashLink = () => {
    if (hashFired) return;
    hashFired = true;
    openBookFromHash();
  };
  const hashFallback = setTimeout(runHashLink, 800);
  if (document.readyState === "complete") runHashLink();
  else
    window.addEventListener(
      "load",
      () => {
        clearTimeout(hashFallback);
        runHashLink();
      },
      { once: true },
    );

  // ==========================================================================
  // 2. MOTOR MATEMÁTICO DE CORTE DE TEXTO (MANTÉM A CLASSE PAI COMO ALVO)
  // ==========================================================================

  const clampObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const excerpt = entry.target.querySelector(".book-excerpt");
      if (!excerpt) continue;

      // Estica só o instante da medição para saber o espaço físico real.
      excerpt.style.webkitLineClamp = "unset";
      excerpt.style.flexGrow = "1";
      const availableHeight = excerpt.clientHeight;
      excerpt.style.flexGrow = "0";

      const lineHeight = parseFloat(window.getComputedStyle(excerpt).lineHeight);
      if (lineHeight > 0) {
        excerpt.style.webkitLineClamp = Math.max(1, Math.floor(availableHeight / lineHeight));
      }
    }
  });

  // Alvo é o contêiner PAI (.book-content) para não entrar em loop com o clamp.
  document.querySelectorAll(".book-content").forEach((content) => clampObserver.observe(content));

  // ==========================================================================
  // 3. O EASTER EGG (Leitura limpa via JSON isolado)
  // ==========================================================================

  const rows = document.querySelectorAll(".bookshelf-row");
  const dataTag = document.getElementById("tilted-books-data");

  if (rows.length > 0 && dataTag) {
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
