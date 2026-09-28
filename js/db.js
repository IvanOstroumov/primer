// Тонкая обёртка над IndexedDB. Хранилища:
//  kv       — {key, value}: program, settings
//  workouts — {id, date, dayId, dayName, ex:[...снимок упражнения + sets]}
//  metrics  — {date, weight, steps, sleep, waist}
//  photos   — {id, date, blob}
const DB_NAME = 'zal';
const DB_VER = 1;
export const STORES = ['kv', 'workouts', 'metrics', 'photos'];

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' }).createIndex('date', 'date');
      if (!db.objectStoreNames.contains('metrics')) db.createObjectStore('metrics', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('date', 'date');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const get = (store, key) => tx(store, 'readonly', t => req(t.objectStore(store).get(key)));
export const all = (store) => tx(store, 'readonly', t => req(t.objectStore(store).getAll()));
export const put = (store, val) => tx(store, 'readwrite', t => { t.objectStore(store).put(val); });
export const del = (store, key) => tx(store, 'readwrite', t => { t.objectStore(store).delete(key); });
export const clear = (store) => tx(store, 'readwrite', t => { t.objectStore(store).clear(); });

export async function getKV(key, fallback) {
  const r = await get('kv', key);
  return r ? r.value : fallback;
}
export const setKV = (key, value) => put('kv', { key, value });

// Полная замена всех данных (импорт) одной транзакцией
export async function replaceAll(data) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORES, 'readwrite');
    for (const s of STORES) t.objectStore(s).clear();
    for (const s of STORES) for (const v of data[s] || []) t.objectStore(s).put(v);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export async function wipeAll() {
  for (const s of STORES) await clear(s);
}
