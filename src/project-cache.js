const DATABASE_NAME = "badge-blur-project-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "projects";
const ACTIVE_PROJECT_KEY = "active-project";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadActiveProjectCache() {
  if (!globalThis.indexedDB) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return (
      (await requestResult(
        transaction.objectStore(STORE_NAME).get(ACTIVE_PROJECT_KEY),
      )) || null
    );
  } finally {
    database.close();
  }
}

export async function saveActiveProjectCache(project) {
  if (!globalThis.indexedDB) return false;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(
      transaction.objectStore(STORE_NAME).put(project, ACTIVE_PROJECT_KEY),
    );
    return true;
  } finally {
    database.close();
  }
}

export async function clearActiveProjectCache() {
  if (!globalThis.indexedDB) return false;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(
      transaction.objectStore(STORE_NAME).delete(ACTIVE_PROJECT_KEY),
    );
    return true;
  } finally {
    database.close();
  }
}
