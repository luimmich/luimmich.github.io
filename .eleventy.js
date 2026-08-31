const eleventyImage = require("@11ty/eleventy-img");
const { EleventyI18nPlugin } = require("@11ty/eleventy");
const path = require("path");

// Extrai as funções corretamente do objeto importado (compatibilidade ESM/CJS)
const Image = eleventyImage.default || eleventyImage;
const generateHTML = eleventyImage.generateHTML;

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyI18nPlugin, {
    // Define o português como idioma base de fallback
    defaultLanguage: "pt",
    errorMode: "allow-fallback",
  });

  eleventyConfig.addPassthroughCopy({
    "src/assets/css": "css",
    "src/assets/js": "js",
    "src/assets/fonts": "fonts",
    "src/assets/icons": "icons",
    "src/assets/imgs": "imgs",
    "src/assets/project-files": "project-files",
  });

  // --- SHORTCODE DE IMAGEM OTIMIZADA ---
  eleventyConfig.addAsyncShortcode(
    "image",
    async function (src, alt, className = "", sizes = "100vw") {
      if (!alt) {
        throw new Error(`Acessibilidade comprometida: faltando atributo 'alt' na imagem ${src}`);
      }

      // Resolve o caminho da imagem relativo à pasta src
      let imageSrc = src;
      if (!src.startsWith(".") && !src.startsWith("http")) {
        // 1. Remove a barra inicial para evitar caminhos absolutos no sistema operacional
        let cleanSrc = src.replace(/^\//, "");

        // 2. Blindagem: remove a palavra 'assets/' caso ela já venha escrita no JSON/Markdown
        cleanSrc = cleanSrc.replace(/^assets\//, "");

        // 3. Monta o caminho final absoluto de forma limpa e segura
        imageSrc = path.join("./src/assets", cleanSrc);
      }

      // Motor de processamento (Gera AVIF e WEBP com fallback para JPEG)
      let metadata = await Image(imageSrc, {
        widths: [400, 800, 1280],
        formats: ["avif", "webp", "jpeg"],
        outputDir: "./_site/img/opt/",
        urlPath: "/img/opt/",
        filenameFormat: function (id, src, width, format) {
          const extension = path.extname(src);
          let name = path.basename(src, extension);

          // Limpeza avançada de string
          name = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          name = name.replace(/[^a-zA-Z0-9]/g, "-");
          name = name.replace(/-+/g, "-").toLowerCase();

          return `${name}-${width}w.${format}`;
        },
      });

      let imageAttributes = {
        alt,
        class: className,
        sizes,
        loading: "lazy",
        decoding: "async",
      };

      return generateHTML(metadata, imageAttributes);
    },
  );

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
