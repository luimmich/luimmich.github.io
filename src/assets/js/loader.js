document.addEventListener("DOMContentLoaded", function () {
  // Reference to the loader element
  const loader = document.querySelector(".loader");
  let loaderHidden = false; // flag to prevent multiple hides

  // Disable pointer events on archive tag links while loader is visible
  const archiveTagLinks = document.querySelectorAll(".archive-tag-container");
  archiveTagLinks.forEach((link) => {
    link.style.pointerEvents = "none";
  });

  // Reference to the archive sheets container
  const archiveSheetsContainer = document.querySelector(".archive-sheets-container");

  function enableLinks() {
    archiveTagLinks.forEach((link) => {
      link.style.pointerEvents = "";
      link.style.opacity = ""; // reset opacity
    });
  }

  function showArchiveSheets() {
    if (archiveSheetsContainer) {
      archiveSheetsContainer.classList.add("visible");
    }
  }

  // Listen for the custom event from minigrid
  document.addEventListener("minigrid:layout", function () {
    if (loader && !loaderHidden) {
      loader.style.display = "none";
      loaderHidden = true;
      enableLinks();
      showArchiveSheets();
    }
  });

  // Fallback: Use MutationObserver to detect layout changes (optional)
  const gridContainer = document.querySelector(".archive-sheets-container");
  if (gridContainer && loader) {
    const observer = new MutationObserver(() => {
      if (!loaderHidden) {
        loader.style.display = "none";
        loaderHidden = true;
        enableLinks();
        showArchiveSheets();
        observer.disconnect();
      }
    });
    observer.observe(gridContainer, { childList: true, subtree: true });
  }
});
