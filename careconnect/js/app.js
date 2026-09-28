/* ==========================================================================
   APP ORCHESTRATOR
   Owns application state and wires the Location / Data / Offline / Intent /
   Action layers to the UI layer. Auth here is a local-only MVP (browser
   storage) as scoped in the brief — swap for a real backend before
   production use with untrusted multi-device accounts.
   ========================================================================== */

(() => {
  "use strict";

  const USERS_KEY = "careconnect_users";
  const SESSION_KEY = "careconnect_session";
  const PREFS_KEY_PREFIX = "careconnect_prefs_";

  const state = {
    user: null,
    prefs: { units: "km", theme: "system", defaultCategory: "all" },
    activeCategories: new Set(), // empty = "all"
    services: [],
    dataMode: "live", // "live" | "offline"
    selectedIntent: null,
    selectedServiceId: null,
    deferredInstallPrompt: null,
  };

  // ---------------- Auth (local MVP) ----------------
  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; }
  }
  function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

  // Simple non-cryptographic hash — adequate only for this local-storage MVP.
  async function hashPassword(pw) {
    const enc = new TextEncoder().encode(pw);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function signup(name, email, password) {
    const users = loadUsers();
    const key = email.trim().toLowerCase();
    if (users[key]) throw new Error("An account with this email already exists.");
    users[key] = { name: name.trim(), email: key, passwordHash: await hashPassword(password) };
    saveUsers(users);
    localStorage.setItem(SESSION_KEY, key);
    return users[key];
  }

  async function login(email, password) {
    const users = loadUsers();
    const key = email.trim().toLowerCase();
    const user = users[key];
    if (!user) throw new Error("No account found for this email.");
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error("Incorrect password.");
    localStorage.setItem(SESSION_KEY, key);
    return user;
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    state.user = null;
    location.reload();
  }

  function restoreSession() {
    const key = localStorage.getItem(SESSION_KEY);
    if (!key) return null;
    const users = loadUsers();
    return users[key] || null;
  }

  function loadPrefs(email) {
    try {
      return { ...state.prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY_PREFIX + email) || "{}") };
    } catch { return { ...state.prefs }; }
  }
  function savePrefs() {
    if (!state.user) return;
    localStorage.setItem(PREFS_KEY_PREFIX + state.user.email, JSON.stringify(state.prefs));
  }

  function initials(name) {
    return (name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  }

  // ---------------- Screens ----------------
  function showScreen(name) {
    document.getElementById("screen-auth").classList.toggle("hidden", name !== "auth");
    document.getElementById("screen-dashboard").classList.toggle("hidden", name !== "dashboard");
  }

  function showTab(tab) {
    document.getElementById("view-home").classList.toggle("hidden", tab !== "home");
    document.getElementById("view-settings").classList.toggle("hidden", tab !== "settings");
    ["home", "settings"].forEach((t) => {
      const btn = document.getElementById(`tab-${t}`);
      if (btn) btn.setAttribute("aria-current", String(t === tab));
    });
  }

  // ---------------- Category resolution ----------------
  function categoriesToQuery() {
    if (state.selectedIntent && state.selectedIntent.categories.length) {
      return state.selectedIntent.categories.filter((c) => CareData.CATEGORIES[c]);
    }
    if (state.activeCategories.size > 0) return Array.from(state.activeCategories);
    return Object.keys(CareData.CATEGORIES);
  }

  // ---------------- Loading services ----------------
  let loadToken = 0;
  async function refreshServices() {
    const fix = CareLocation.getFix();
    if (!fix) return;
    const myToken = ++loadToken;
    CareUI.renderSkeleton();

    if (!CareOffline.isOnline()) {
      await loadFromOffline(fix);
      return;
    }

    try {
      const catIds = categoriesToQuery();
      const services = await CareData.fetchNearbyDebounced({ lat: fix.lat, lng: fix.lng, radiusM: 8000, categoryIds: catIds });
      if (myToken !== loadToken) return; // a newer request superseded this one
      state.services = services;
      state.dataMode = "live";
      renderCurrentList();
      CareUI.clearBanner();
    } catch (err) {
      console.warn("Live fetch failed, falling back to offline area if any:", err);
      const hadOffline = await loadFromOffline(fix);
      if (!hadOffline) {
        CareUI.showBanner("We couldn't load live nearby services, and no offline area is saved yet. Check your connection and try again.", "red");
        state.services = [];
        renderCurrentList();
      } else {
        CareUI.showBanner("We couldn't load live nearby services. Your saved offline area is still available.", "amber");
      }
    }
  }

  async function loadFromOffline(fix) {
    const area = await CareOffline.getOfflineArea();
    if (!area) return false;
    const all = await CareOffline.getOfflineServices();
    const catIds = new Set(categoriesToQuery());
    const withDistance = all
      .filter((s) => catIds.has(s.category))
      .map((s) => ({ ...s, distanceKm: CareData.haversineKm(fix, { lat: s.lat, lng: s.lng }) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    state.services = withDistance;
    state.dataMode = "offline";
    renderCurrentList();
    return true;
  }

  function renderCurrentList() {
    CareUI.renderDataModeChip(state.dataMode === "live");
    const sortBy = document.getElementById("sort-select").value;
    let list = state.services.slice();
    if (sortBy === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    CareUI.renderServiceList(list, state.prefs.units, { onSelect: onSelectService, onAction: onServiceAction });
    CareUI.renderMarkers(list, onSelectService);
  }

  function onSelectService(id) {
    state.selectedServiceId = id;
    CareUI.highlightMarker(id);
    const svc = state.services.find((s) => s.id === id);
    if (svc) CareUI.openServiceSheet(svc, state.prefs.units, { onAction: onServiceAction });
  }

  function onServiceAction(action, id) {
    const svc = state.services.find((s) => s.id === id);
    if (!svc) return;
    if (action === "call") CareActions.callNumber(svc.phone);
    else if (action === "directions") CareActions.openDirections(svc.lat, svc.lng);
    else if (action === "website") CareActions.openWebsite(svc.website);
    else if (action === "view") { CareUI.recenter(); CareUI.highlightMarker(id); }
  }

  // ---------------- Situation search ----------------
  let searchDebounceTimer = null;
  function onSituationInput(e) {
    clearTimeout(searchDebounceTimer);
    const value = e.target.value;
    searchDebounceTimer = setTimeout(() => {
      if (!value.trim()) {
        state.selectedIntent = null;
        CareUI.clearIntentBanner();
        refreshServices();
        return;
      }
      const intent = CareIntent.classify(value);
      state.selectedIntent = intent;
      if (intent.categories.length) {
        CareUI.showIntentBanner(intent.label, () => {
          state.selectedIntent = null;
          document.getElementById("situation-input").value = "";
          CareUI.clearIntentBanner();
          refreshServices();
        });
      }
      refreshServices();
    }, 400);
  }

  // ---------------- Filters ----------------
  function onToggleFilter(id) {
    state.selectedIntent = null;
    CareUI.clearIntentBanner();
    if (id === "all") state.activeCategories.clear();
    else {
      if (state.activeCategories.has(id)) state.activeCategories.delete(id);
      else state.activeCategories.add(id);
    }
    CareUI.renderFilters(state.activeCategories, onToggleFilter);
    refreshServices();
  }

  // ---------------- Emergency mode ----------------
  const EMERGENCY_INTENT_MAP = {
    accident: "accident", medical: "medical", blood: "blood", safety: "safety",
    fire: "fire", fuel: "fuel", breakdown: "breakdown",
  };
  function onEmergencyPick(id) {
    if (id === "share") { doShareLocation(); return; }
    const rule = CareIntent.RULES.find((r) => r.id === EMERGENCY_INTENT_MAP[id]);
    if (rule) {
      state.selectedIntent = { id: rule.id, label: rule.label, categories: rule.categories };
      CareUI.showIntentBanner(rule.label, () => {
        state.selectedIntent = null;
        CareUI.clearIntentBanner();
        refreshServices();
      });
      refreshServices();
    }
    CareUI.closeEmergencyOverlay();
    showTab("home");
  }

  async function doShareLocation() {
    const fix = CareLocation.getFix();
    if (!fix) { CareUI.showBanner("We don't have your location yet — try again in a moment.", "amber"); return; }
    const result = await CareActions.shareLocation(fix, state.user ? state.user.name : "My location");
    if (result.ok && result.method === "clipboard") CareUI.announce("Location link copied to clipboard.");
    else if (result.ok && result.method === "manual") window.prompt("Copy your location link:", result.link);
  }

  // ---------------- Offline download ----------------
  async function downloadOfflineArea() {
    const fix = CareLocation.getFix();
    if (!fix) { CareUI.showBanner("Get a location fix before downloading an offline area.", "amber"); return; }
    const btn = document.getElementById("btn-download-offline");
    btn.disabled = true;
    btn.textContent = "Downloading…";
    try {
      const services = await CareData.fetchNearby({ lat: fix.lat, lng: fix.lng, radiusM: 20000, categoryIds: Object.keys(CareData.CATEGORIES) });
      await CareOffline.saveOfflineArea({ center: { lat: fix.lat, lng: fix.lng }, radiusKm: 20, services });
      const area = await CareOffline.getOfflineArea();
      CareUI.renderOfflineStatus(area);
      CareUI.announce("Offline area saved.");
      CareUI.showBanner("✓ Offline area saved.", "green");
    } catch (err) {
      CareUI.showBanner("Couldn't download the offline area right now. Try again when you have a stronger connection.", "red");
    } finally {
      btn.disabled = false;
      btn.textContent = "Download";
    }
  }

  async function clearOfflineArea() {
    await CareOffline.clearOfflineData();
    CareUI.renderOfflineStatus(null);
    CareUI.announce("Offline data cleared.");
  }

  // ---------------- Flashlight (real hardware only) ----------------
  async function toggleFlashlight() {
    const btn = document.getElementById("btn-flashlight");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      btn.textContent = "Not supported here";
      CareUI.showBanner("Flashlight control isn't available in this browser. Use your phone's flashlight control.", "amber");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (!capabilities.torch) {
        CareUI.showBanner("Flashlight control isn't available in this browser. Use your phone's flashlight control.", "amber");
        track.stop();
        return;
      }
      track._torchOn = !track._torchOn;
      await track.applyConstraints({ advanced: [{ torch: track._torchOn }] });
      btn.textContent = track._torchOn ? "Turn off" : "Toggle";
      if (!track._torchOn) track.stop();
    } catch {
      CareUI.showBanner("Flashlight control isn't available in this browser. Use your phone's flashlight control.", "amber");
    }
  }

  // ---------------- Theme ----------------
  function applyTheme() {
    const t = state.prefs.theme;
    document.documentElement.setAttribute("data-theme", t === "system" ? "" : t);
  }

  // ---------------- Wiring ----------------
  function wireAuth() {
    const loginForm = document.getElementById("form-login");
    const signupForm = document.getElementById("form-signup");
    const switchBtn = document.getElementById("btn-auth-switch");
    let mode = "login";

    switchBtn.addEventListener("click", () => {
      mode = mode === "login" ? "signup" : "login";
      loginForm.classList.toggle("hidden", mode !== "login");
      signupForm.classList.toggle("hidden", mode !== "signup");
      document.getElementById("auth-title").textContent = mode === "login" ? "Welcome back" : "Create your account";
      document.getElementById("auth-sub").textContent = mode === "login" ? "Sign in to see services near you." : "Takes a few seconds.";
      document.getElementById("auth-switch-text").textContent = mode === "login" ? "New to CareConnect?" : "Already have an account?";
      switchBtn.textContent = mode === "login" ? "Create an account" : "Sign in";
    });

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("login-error");
      errEl.classList.add("hidden");
      try {
        const user = await login(document.getElementById("login-email").value, document.getElementById("login-password").value);
        onAuthed(user);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    });

    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("signup-error");
      errEl.classList.add("hidden");
      try {
        const user = await signup(
          document.getElementById("signup-name").value,
          document.getElementById("signup-email").value,
          document.getElementById("signup-password").value
        );
        onAuthed(user);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    });
  }

  function wireDashboard() {
    document.getElementById("situation-input").addEventListener("input", onSituationInput);
    document.getElementById("btn-recenter").addEventListener("click", () => CareUI.recenter());
    document.getElementById("sort-select").addEventListener("change", renderCurrentList);

    document.getElementById("btn-emergency-mode").addEventListener("click", () => CareUI.openEmergencyOverlay());
    document.getElementById("btn-close-emergency").addEventListener("click", () => CareUI.closeEmergencyOverlay());
    CareUI.renderEmergencyGrid(onEmergencyPick);
    document.getElementById("hotline-112").addEventListener("click", () => CareActions.callNumber("112"));
    document.getElementById("hotline-1033").addEventListener("click", () => CareActions.callNumber("1033"));
    document.getElementById("hotline-share").addEventListener("click", doShareLocation);

    document.getElementById("qa-112").addEventListener("click", () => CareActions.callNumber("112"));
    document.getElementById("qa-1033").addEventListener("click", () => CareActions.callNumber("1033"));
    document.getElementById("qa-share").addEventListener("click", doShareLocation);

    document.getElementById("sheet-backdrop").addEventListener("click", CareUI.closeSheet);

    document.getElementById("btn-avatar").addEventListener("click", () => showTab("settings"));
    document.getElementById("tab-home").addEventListener("click", () => showTab("home"));
    document.getElementById("tab-emergency").addEventListener("click", () => CareUI.openEmergencyOverlay());
    document.getElementById("tab-offline").addEventListener("click", () => showTab("settings"));
    document.getElementById("tab-settings").addEventListener("click", () => showTab("settings"));
    document.getElementById("btn-close-settings").addEventListener("click", () => showTab("home"));

    document.getElementById("btn-logout").addEventListener("click", logout);
    document.getElementById("btn-download-offline").addEventListener("click", downloadOfflineArea);
    document.getElementById("btn-clear-offline").addEventListener("click", clearOfflineArea);
    document.getElementById("btn-flashlight").addEventListener("click", toggleFlashlight);

    document.getElementById("pref-units").addEventListener("change", (e) => { state.prefs.units = e.target.value; savePrefs(); renderCurrentList(); });
    document.getElementById("pref-theme").addEventListener("change", (e) => { state.prefs.theme = e.target.value; savePrefs(); applyTheme(); });
    document.getElementById("pref-default-category").addEventListener("change", (e) => { state.prefs.defaultCategory = e.target.value; savePrefs(); });

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      const btn = document.getElementById("btn-install");
      btn.disabled = false;
      btn.textContent = "Install";
      btn.addEventListener("click", async () => {
        if (!state.deferredInstallPrompt) return;
        state.deferredInstallPrompt.prompt();
        await state.deferredInstallPrompt.userChoice;
        state.deferredInstallPrompt = null;
        btn.disabled = true;
        btn.textContent = "Installed";
      });
    });
  }

  function wireLiveStatus() {
    CareLocation.on(({ state: locState, fix }) => {
      CareUI.renderLocationChip(CareLocation.statusLabel());
      if (locState === "denied") {
        CareUI.showBanner("Location access is off, so nearby results can't be shown. Enable location permission for CareConnect and try again.", "red");
      } else if (locState === "unavailable") {
        CareUI.showBanner("We couldn't get a location fix. You can still use Emergency Mode hotlines and any saved offline area.", "red");
      }
      if (fix) {
        CareUI.setUserPosition(fix.lat, fix.lng, fix.accuracy, !state._hasCentered);
        state._hasCentered = true;
        refreshServices();
      }
    });

    CareOffline.onConnectivityChange((online) => {
      CareUI.renderConnectivityChip(online);
      if (online) refreshServices();
      else CareUI.showBanner("You're offline. Showing your saved offline area if one is available.", "amber");
    });
    CareUI.renderConnectivityChip(CareOffline.isOnline());

    CareOffline.getBattery().then((b) => {
      CareUI.renderBatteryChip(b);
      if (b && b.level <= 0.2 && !b.charging) {
        document.getElementById("app-shell").classList.add("low-battery");
      }
    });
  }

  function onAuthed(user) {
    state.user = user;
    state.prefs = loadPrefs(user.email);
    applyTheme();
    document.getElementById("greeting-text").textContent = `${greetingWord()}, ${user.name.split(" ")[0]} 👋`;
    document.getElementById("btn-avatar").textContent = initials(user.name);
    document.getElementById("settings-name").textContent = user.name;
    document.getElementById("settings-email").textContent = user.email;
    document.getElementById("pref-units").value = state.prefs.units;
    document.getElementById("pref-theme").value = state.prefs.theme;

    showScreen("dashboard");
    showTab("home");
    CareUI.renderFilters(state.activeCategories, onToggleFilter);
    CareUI.initMap();
    CareLocation.startWatch();
    CareOffline.getOfflineArea().then(CareUI.renderOfflineStatus);
    CareOffline.registerServiceWorker();
  }

  function greetingWord() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  // ---------------- Boot ----------------
  function boot() {
    wireAuth();
    wireDashboard();
    wireLiveStatus();
    const existing = restoreSession();
    if (existing) onAuthed(existing);
    else showScreen("auth");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
