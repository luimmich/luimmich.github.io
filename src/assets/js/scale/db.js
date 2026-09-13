// db.js
const DB_NAME = "SimbolicScaleDB";
const DB_VERSION = 1;
const STORE_NAME = "extractions";

// Inicializa o banco assincronamente
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Cria a tabela usando o 'id' (timestamp) como chave primária
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 1. Salva a Extração no IndexedDB
export async function saveExtraction(extractionData) {
  try {
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.add(extractionData);
    console.log("Extração salva com segurança no IndexedDB.");

    // Tenta blindar o banco contra a limpeza automática do SO
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch (err) {
    console.error("Falha ao salvar no banco:", err);
  }
}

// 2. Exporta os Dados (Gera um arquivo .json para Download)
export async function exportData() {
  try {
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll(); // Pega tudo

    request.onsuccess = () => {
      const allExtractions = request.result;
      if (allExtractions.length === 0) return alert("Nenhum dado para exportar.");

      // Transforma o Array em um Blob de JSON
      const jsonString = JSON.stringify(allExtractions, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });

      // Cria um link invisível e força o download nativo
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `extractions_${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();

      // Limpeza de memória
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  } catch (err) {
    console.error("Erro ao exportar:", err);
  }
}

export async function getAllExtractions() {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Erro ao ler banco:", err);
    return [];
  }
}
