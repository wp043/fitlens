export interface AsyncValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StringFallbackStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export async function loadMigratedValue<T>(
  primary: AsyncValueStore,
  fallback: StringFallbackStore,
  key: string,
  normalize: (value: unknown) => T,
): Promise<T | undefined> {
  try {
    const stored = await primary.get(key);
    if (stored !== undefined) return normalize(stored);
  } catch {
    // Fall through to the recoverable legacy copy.
  }

  const legacy = fallback.getItem(key);
  if (legacy === null) return undefined;
  const normalized = normalize(JSON.parse(legacy));
  try {
    await primary.set(key, normalized);
    fallback.removeItem(key);
  } catch {
    // Keep the legacy copy when IndexedDB is unavailable or blocked.
  }
  return normalized;
}

export async function persistValue(
  primary: AsyncValueStore,
  fallback: StringFallbackStore,
  key: string,
  value: unknown,
) {
  try {
    await primary.set(key, value);
    fallback.removeItem(key);
  } catch {
    fallback.setItem(key, JSON.stringify(value));
  }
}

export async function deletePersistedValue(
  primary: AsyncValueStore,
  fallback: StringFallbackStore,
  key: string,
) {
  try {
    await primary.delete(key);
  } finally {
    fallback.removeItem(key);
  }
}

const databaseName = "fitlens-local-v1";
const objectStoreName = "documents";
let databasePromise: Promise<IDBDatabase> | undefined;
const writeQueues = new Map<string, Promise<void>>();

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) {
        request.result.createObjectStore(objectStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const indexedDbStore: AsyncValueStore = {
  async get(key) {
    const database = await openDatabase();
    return requestResult(
      database.transaction(objectStoreName, "readonly").objectStore(objectStoreName).get(key),
    );
  },
  async set(key, value) {
    const previous = writeQueues.get(key) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const database = await openDatabase();
      const transaction = database.transaction(objectStoreName, "readwrite");
      transaction.objectStore(objectStoreName).put(value, key);
      await transactionComplete(transaction);
    });
    writeQueues.set(key, queued);
    try {
      await queued;
    } finally {
      if (writeQueues.get(key) === queued) writeQueues.delete(key);
    }
  },
  async delete(key) {
    await (writeQueues.get(key) ?? Promise.resolve()).catch(() => undefined);
    const database = await openDatabase();
    const transaction = database.transaction(objectStoreName, "readwrite");
    transaction.objectStore(objectStoreName).delete(key);
    await transactionComplete(transaction);
  },
};

export function loadBrowserValue<T>(
  key: string,
  normalize: (value: unknown) => T,
) {
  return loadMigratedValue(indexedDbStore, window.localStorage, key, normalize);
}

export function persistBrowserValue(key: string, value: unknown) {
  return persistValue(indexedDbStore, window.localStorage, key, value);
}

export function deleteBrowserValue(key: string) {
  return deletePersistedValue(indexedDbStore, window.localStorage, key);
}
