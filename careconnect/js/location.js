/* ==========================================================================
   LOCATION LAYER
   Owns all interaction with the browser Geolocation API. Never fabricates
   or hardcodes a position; reports real accuracy and lets the caller
   decide how to treat it. Emits events via a tiny pub/sub so the UI layer
   never touches navigator.geolocation directly.
   ========================================================================== */

const CareLocation = (() => {
  const listeners = new Set();
  let watchId = null;
  let lastFix = null; // { lat, lng, accuracy, timestamp }
  let state = "idle"; // idle | searching | precise | approximate | denied | unavailable

  const GOOD_ACCURACY_M = 50;      // <= this: "precise"
  const USABLE_ACCURACY_M = 500;   // <= this: "approximate"; above: flagged as poor

  function emit() {
    listeners.forEach((fn) => fn({ state, fix: lastFix }));
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function classify(accuracy) {
    if (accuracy <= GOOD_ACCURACY_M) return "precise";
    if (accuracy <= USABLE_ACCURACY_M) return "approximate";
    return "poor";
  }

  function handlePosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    lastFix = { lat: latitude, lng: longitude, accuracy, timestamp: pos.timestamp || Date.now() };
    const cls = classify(accuracy);
    state = cls === "poor" ? "approximate" : cls; // still usable, just flagged in UI via accuracy value
    emit();
  }

  function handleError(err) {
    if (err.code === err.PERMISSION_DENIED) {
      state = "denied";
    } else {
      state = "unavailable";
    }
    emit();
  }

  function requestOnce() {
    if (!("geolocation" in navigator)) {
      state = "unavailable";
      emit();
      return Promise.reject(new Error("Geolocation not supported"));
    }
    state = "searching";
    emit();
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => { handlePosition(pos); resolve(lastFix); },
        (err) => { handleError(err); reject(err); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    });
  }

  function startWatch() {
    if (!("geolocation" in navigator)) {
      state = "unavailable";
      emit();
      return;
    }
    if (watchId !== null) return;
    state = state === "idle" ? "searching" : state;
    emit();
    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  function stopWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function getFix() { return lastFix; }
  function getState() { return state; }

  function statusLabel() {
    if (state === "denied") return { text: "Location permission denied", tone: "red" };
    if (state === "unavailable") return { text: "Location unavailable", tone: "red" };
    if (state === "searching") return { text: "Finding your location…", tone: "grey" };
    if (!lastFix) return { text: "Location not set", tone: "grey" };
    const acc = Math.round(lastFix.accuracy);
    if (state === "precise") return { text: `Precise location active · ±${acc}m`, tone: "green" };
    if (acc <= USABLE_ACCURACY_M) return { text: `Approximate location · ±${acc}m`, tone: "amber" };
    return { text: `Location accuracy is currently ±${acc}m. Move outdoors or improve location settings.`, tone: "amber" };
  }

  return { on, requestOnce, startWatch, stopWatch, getFix, getState, statusLabel, classify };
})();
