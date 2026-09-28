/* ==========================================================================
   OFFLINE LAYER
   Owns IndexedDB (the 20km downloaded service dataset) and the connectivity
   / battery status readouts. The UI must always be able to tell LIVE data
   from OFFLINE data — this layer stores and stamps the timestamp needed
   to do that; it never claims cached data is live.
   ========================================================================== */

const CareOffline = (() => {
  const DB_NAME = "careconnect";
  const DB_VERSION = 1;
  const STORE_AREA = "offline_area";     // one row: the last downloaded area
  const STORE_SERVICES = "offline_services"; // service records for that area

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("IndexedDB unsupported")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_AREA)) db.createObjectStore(STORE_AREA, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_SERVICES)) db.createObjectStore(STORE_SERVICES, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function saveOfflineArea({ center, radiusKm, services }) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_AREA, STORE_SERVICES], "readwrite");
      tx.objectStore(STORE_AREA).put({
        id: "current",
        center,
        radiusKm,
        savedAt: Date.now(),
        count: services.length,
      });
      const svcStore = tx.objectStore(STORE_SERVICES);
      svcStore.clear();
      services.forEach((s) => svcStore.put(s));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getOfflineArea() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AREA, "readonly");
      const req = tx.objectStore(STORE_AREA).get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getOfflineServices() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SERVICES, "readonly");
      const req = tx.objectStore(STORE_SERVICES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearOfflineData() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_AREA, STORE_SERVICES], "readwrite");
      tx.objectStore(STORE_AREA).clear();
      tx.objectStore(STORE_SERVICES).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  function timeAgo(ts) {
    if (!ts) return "unknown";
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  // ---- Connectivity ----
  const connListeners = new Set();
  function isOnline() { return navigator.onLine; }
  function onConnectivityChange(fn) {
    connListeners.add(fn);
    return () => connListeners.delete(fn);
  }
  window.addEventListener("online", () => connListeners.forEach((fn) => fn(true)));
  window.addEventListener("offline", () => connListeners.forEach((fn) => fn(false)));

  // ---- Battery (only if the browser genuinely exposes it — never faked) ----
  async function getBattery() {
    if (!("getBattery" in navigator)) return null;
    try {
      const b = await navigator.getBattery();
      return { level: b.level, charging: b.charging };
    } catch {
      return null;
    }
  }

  // ---- Service worker registration ----
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await navigator.serviceWorker.register("./sw.js");
    } catch (err) {
      console.warn("Service worker registration failed:", err);
      return null;
    }
  }

  return {
    saveOfflineArea, getOfflineArea, getOfflineServices, clearOfflineData, timeAgo,
    isOnline, onConnectivityChange, getBattery, registerServiceWorker,
  };
})();
