// db.js
const DB_NAME = "SimbolicScaleDB";
const DB_VERSION = 1;
const STORE_NAME = "extractions";

let dbInstance = null;
let dbPromise = null;

function getIndexedDB() {
  if (!("indexedDB" in window)) {
    throw new Error("IndexedDB não é suportado neste navegador.");
  }
  return window.indexedDB;
}

function isPersistAvailable() {
  return !!(navigator.storage && typeof navigator.storage.persist === "function");
}

async function requestPersistence() {
  if (!isPersistAvailable()) return false;

  try {
    const persisted = await navigator.storage.persist();
    return persisted;
  } catch (err) {
    console.warn("Persistência do IndexedDB não foi ativada:", err);
    return false;
  }
}

/**
 * Retorna ou inicializa a conexão Singleton com o IndexedDB protegida contra concorrência.
 */
async function getDB() {
  if (dbInstance) return dbInstance;
  if (dbPromise) return dbPromise;

  const indexedDBAPI = getIndexedDB();

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDBAPI.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbPromise = null;

      dbInstance.onclose = () => {
        dbInstance = null;
      };

      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };

      requestPersistence();
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      dbPromise = null;
      reject(event.target.error || new Error("Falha ao abrir IndexedDB."));
    };

    request.onblocked = () => {
      dbPromise = null;
      console.warn("Abertura do IndexedDB bloqueada por outra aba.");
    };
  });

  return dbPromise;
}

async function runStoreOperation(mode, callback) {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve(true);
    transaction.onabort = () => reject(transaction.error || new Error("Transação abortada."));
    transaction.onerror = (event) =>
      reject(event.target.error || new Error("Erro na transação do IndexedDB."));

    callback(store);
  });
}

/**
 * Salva ou atualiza uma extração (Upsert).
 */
export async function saveExtraction(extractionData) {
  try {
    await runStoreOperation("readwrite", (store) => {
      store.put(extractionData);
    });

    return true;
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
      request.onerror = (event) =>
        reject(event.target.error || new Error("Erro ao consultar extrações."));
      transaction.onerror = (event) =>
        reject(event.target.error || new Error("Erro de transação ao consultar extrações."));
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
      transaction.onabort = () => reject(transaction.error || new Error("Delete abortado."));
      transaction.onerror = (event) => {
        console.error("Erro ao deletar extração:", event.target.error);
        reject(event.target.error || new Error("Erro ao deletar extração."));
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
