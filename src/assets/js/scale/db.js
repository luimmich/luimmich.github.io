// db.js
const DB_NAME = "SimbolicScaleDB";
const DB_VERSION = 1;
const STORE_NAME = "extractions";

let dbInstance = null;

/**
 * Retorna ou inicializa a conexão Singleton com o IndexedDB.
 */
async function getDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;

      dbInstance.onclose = () => {
        dbInstance = null;
      };

      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }

      resolve(dbInstance);
    };

    request.onerror = (event) => reject(event.target.error);
    request.onblocked = () => console.warn("Abertura do IndexedDB bloqueada por outra aba.");
  });
}

/**
 * Salva ou atualiza uma extração (Upsert).
 */
export async function saveExtraction(extractionData) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      store.put(extractionData);

      transaction.oncomplete = () => {
        console.log("Extração salva com sucesso no IndexedDB.");
        resolve(true);
      };

      transaction.onerror = (event) => {
        console.error("Falha ao salvar no banco:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (err) {
    console.error("Erro na transação de salvamento:", err);
    throw err;
  }
}

/**
 * Retorna todas as extrações armazenadas.
 */
export async function getAllExtractions() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (err) {
    console.error("Erro ao ler banco:", err);
    return [];
  }
}

/**
 * Remove um registro por ID com verificação de tipo.
 */
export async function deleteExtraction(id) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const targetId = typeof id === "string" && !isNaN(Number(id)) ? Number(id) : id;
      store.delete(targetId);

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = (event) => {
        console.error("Erro ao deletar extração:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (err) {
    console.error("Erro na transação de deleção:", err);
    throw err;
  }
}

/**
 * Exporta todas as extrações em um arquivo .json para download.
 */
export async function exportData() {
  try {
    const allExtractions = await getAllExtractions();
    if (!allExtractions || allExtractions.length === 0) {
      alert("Nenhum dado para exportar.");
      return false;
    }

    const jsonString = JSON.stringify(allExtractions, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extractions_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error("Erro ao exportar dados:", err);
    return false;
  }
}
