/* ==========================================================================
   UI LAYER
   Pure(ish) rendering helpers. This layer reads data handed to it and
   updates the DOM / Leaflet map — it does not call Overpass, IndexedDB,
   or Geolocation directly. That keeps the app testable and keeps a
   fabrication of data impossible at the render step (if a field is
   missing, the render function shows "Information not provided").
   ========================================================================== */

const CareUI = (() => {
  let map = null;
  let userMarker = null;
  let accuracyCircle = null;
  let serviceMarkers = new Map(); // id -> marker
  let liveRegion = null;

  function announce(msg) {
    if (!liveRegion) liveRegion = document.getElementById("live-region");
    if (liveRegion) liveRegion.textContent = msg;
  }

  // ---- Map ----
  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView([20.5937, 78.9629], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    return map;
  }

  function setUserPosition(lat, lng, accuracy, recenter = true) {
    if (!map) return;
    const latlng = [lat, lng];
    if (!userMarker) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#0F6E6B;border:3px solid #fff;box-shadow:0 0 0 2px rgba(15,110,107,0.35)"></div>`,
        iconSize: [16, 16],
      });
      userMarker = L.marker(latlng, { icon, zIndexOffset: 1000, title: "Your location" }).addTo(map);
    } else {
      userMarker.setLatLng(latlng);
    }
    if (!accuracyCircle) {
      accuracyCircle = L.circle(latlng, { radius: accuracy, color: "#0F6E6B", fillColor: "#0F6E6B", fillOpacity: 0.08, weight: 1 }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(accuracy);
    }
    if (recenter) map.setView(latlng, Math.max(map.getZoom(), 14));
  }

  function recenter() {
    if (userMarker) map.setView(userMarker.getLatLng(), Math.max(map.getZoom(), 14));
  }

  const categoryEmoji = (cat) => (CareData.CATEGORIES[cat] && CareData.CATEGORIES[cat].emoji) || "📍";

  function clearServiceMarkers() {
    serviceMarkers.forEach((m) => map.removeLayer(m));
    serviceMarkers.clear();
  }

  function renderMarkers(services, onSelect) {
    clearServiceMarkers();
    services.forEach((svc) => {
      const icon = L.divIcon({
        className: "",
        html: `<div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">${categoryEmoji(svc.category)}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const marker = L.marker([svc.lat, svc.lng], { icon, title: svc.name });
      marker.bindPopup(`<b>${escapeHtml(svc.name)}</b><br>${svc.distanceKm.toFixed(1)} km away`);
      marker.on("click", () => onSelect(svc.id));
      marker.addTo(map);
      serviceMarkers.set(svc.id, marker);
    });
  }

  function highlightMarker(id) {
    serviceMarkers.forEach((m) => m.setZIndexOffset(0));
    const m = serviceMarkers.get(id);
    if (m) { m.setZIndexOffset(500); m.openPopup(); }
  }

  // ---- Status chips ----
  function setChip(id, label, tone) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector("span:last-child").textContent = label;
    const dot = el.querySelector(".dot");
    dot.className = `dot dot-${tone}`;
  }

  function renderLocationChip(status) {
    setChip("chip-location", status.text, status.tone === "green" ? "green" : status.tone === "amber" ? "amber" : status.tone === "red" ? "red" : "grey");
  }
  function renderConnectivityChip(online) {
    setChip("chip-connectivity", online ? "Online" : "Offline", online ? "green" : "red");
  }
  function renderBatteryChip(battery) {
    const el = document.getElementById("chip-battery");
    if (!battery) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    const pct = Math.round(battery.level * 100);
    const tone = pct <= 20 && !battery.charging ? "red" : "grey";
    setChip("chip-battery", `${battery.charging ? "⚡" : "🔋"} ${pct}%`, tone);
  }
  function renderDataModeChip(isLive) {
    setChip("chip-data-mode", isLive ? "Live data" : "Offline data", isLive ? "green" : "amber");
    const badge = document.getElementById("map-live-badge");
    badge.textContent = isLive ? "🟢 LIVE" : "🟠 OFFLINE DATA";
  }

  // ---- Banners ----
  function showBanner(html, tone = "amber") {
    const slot = document.getElementById("banner-slot");
    slot.innerHTML = `<div class="banner banner-${tone}" role="status">${html}</div>`;
  }
  function clearBanner() {
    document.getElementById("banner-slot").innerHTML = "";
  }

  function showIntentBanner(intentLabel, onClear) {
    const slot = document.getElementById("intent-banner-slot");
    slot.innerHTML = `<div class="intent-banner"><span>Showing results for: <strong>${escapeHtml(intentLabel)}</strong></span><button id="btn-clear-intent" type="button">Clear</button></div>`;
    document.getElementById("btn-clear-intent").addEventListener("click", onClear);
  }
  function clearIntentBanner() {
    document.getElementById("intent-banner-slot").innerHTML = "";
  }

  // ---- Filters ----
  function renderFilters(activeIds, onToggle) {
    const row = document.getElementById("filter-row");
    const all = [{ id: "all", label: "All", emoji: "🧭" }, ...Object.entries(CareData.CATEGORIES).map(([id, c]) => ({ id, label: c.label, emoji: c.emoji }))];
    row.innerHTML = "";
    all.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "filter-chip";
      btn.type = "button";
      btn.textContent = `${c.emoji} ${c.label}`;
      const pressed = c.id === "all" ? activeIds.size === 0 : activeIds.has(c.id);
      btn.setAttribute("aria-pressed", String(pressed));
      btn.addEventListener("click", () => onToggle(c.id));
      row.appendChild(btn);
    });
  }

  // ---- Service list ----
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  function fmtDistance(km, units) {
    if (units === "mi") {
      const mi = km * 0.621371;
      return mi < 0.1 ? `${Math.round(mi * 5280)} ft` : `${mi.toFixed(1)} mi`;
    }
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }

  function serviceCardHtml(svc, units) {
    const metaBits = [];
    if (svc.openingHours) metaBits.push(escapeHtml(svc.openingHours));
    else metaBits.push("Hours not provided");
    if (svc.wheelchair === "yes") metaBits.push("♿ Wheelchair accessible");
    const rating = svc.rating ? `<span class="rating">★ ${svc.rating}</span>` : "";

    const addr = [svc.raw && svc.raw["addr:housenumber"], svc.raw && svc.raw["addr:street"], svc.raw && (svc.raw["addr:suburb"] || svc.raw["addr:city"])]
      .filter(Boolean).join(", ");

    return `
      <article class="service-card" data-id="${svc.id}" tabindex="0" role="button" aria-label="${escapeHtml(svc.name)}, ${fmtDistance(svc.distanceKm, units)} away">
        <div class="service-card-top">
          <div class="service-name-row">
            <span class="service-emoji" aria-hidden="true">${categoryEmoji(svc.category)}</span>
            <span class="service-name">${escapeHtml(svc.name)}</span>
          </div>
          <span class="service-distance">${fmtDistance(svc.distanceKm, units)}</span>
        </div>
        <div class="service-meta">${rating}<span>${metaBits.join(" · ")}</span></div>
        <div class="service-address">${addr ? escapeHtml(addr) : "Address not provided"}</div>
        <div class="service-actions">
          ${svc.phone ? `<button class="btn btn-primary btn-sm" data-action="call" data-id="${svc.id}">📞 Call</button>` : ""}
          <button class="btn btn-outline btn-sm" data-action="directions" data-id="${svc.id}">🧭 Directions</button>
          <button class="btn btn-outline btn-sm" data-action="view" data-id="${svc.id}">📍 View</button>
          ${svc.website ? `<button class="btn btn-outline btn-sm" data-action="website" data-id="${svc.id}">🌐 Website</button>` : ""}
        </div>
      </article>`;
  }

  function renderServiceList(services, units, handlers) {
    const list = document.getElementById("service-list");
    document.getElementById("list-heading-text").textContent = `Nearby services (${services.length})`;
    if (services.length === 0) {
      list.innerHTML = `<div class="empty-state"><span class="ico" aria-hidden="true">🔍</span>No services found nearby yet. Try a different category or check your connection.</div>`;
      return;
    }
    list.innerHTML = services.map((s) => serviceCardHtml(s, units)).join("");
    list.querySelectorAll(".service-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-action]")) return;
        handlers.onSelect(card.dataset.id);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlers.onSelect(card.dataset.id); }
      });
    });
    list.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.onAction(btn.dataset.action, btn.dataset.id);
      });
    });
  }

  function renderSkeleton(count = 3) {
    const list = document.getElementById("service-list");
    list.innerHTML = Array.from({ length: count }).map(() => `<div class="skeleton-card"></div>`).join("");
  }

  // ---- Service detail sheet ----
  function openServiceSheet(svc, units, handlers) {
    const backdrop = document.getElementById("sheet-backdrop");
    const sheet = document.getElementById("service-sheet");
    backdrop.classList.remove("hidden");
    sheet.classList.remove("hidden");
    document.getElementById("sheet-content").innerHTML = `
      <h2 id="sheet-name" style="font-size:1.2rem;font-weight:800;margin-bottom:4px;">${categoryEmoji(svc.category)} ${escapeHtml(svc.name)}</h2>
      <p style="color:var(--ink-500);font-size:0.85rem;margin-bottom:14px;">${fmtDistance(svc.distanceKm, units)} away · ${CareData.CATEGORIES[svc.category] ? CareData.CATEGORIES[svc.category].label : "Service"}</p>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:0.9rem;">
        <div><strong>Address:</strong> ${svc.raw && (svc.raw["addr:street"] || svc.raw["addr:full"]) ? escapeHtml([svc.raw["addr:housenumber"], svc.raw["addr:street"]].filter(Boolean).join(" ")) : "Information not provided"}</div>
        <div><strong>Phone:</strong> ${svc.phone ? escapeHtml(svc.phone) : "Information not provided"}</div>
        <div><strong>Opening hours:</strong> ${svc.openingHours ? escapeHtml(svc.openingHours) : "Information not provided"}</div>
        <div><strong>Website:</strong> ${svc.website ? escapeHtml(svc.website) : "Information not provided"}</div>
        <div><strong>Accessibility:</strong> ${svc.wheelchair ? escapeHtml(svc.wheelchair) : "Information not provided"}</div>
        ${!svc.hasRealName ? `<div style="color:var(--ink-300);font-size:0.75rem;">Name not tagged in source data — shown by category.</div>` : ""}
      </div>
      <div class="service-actions" style="margin-top:18px;">
        ${svc.phone ? `<button class="btn btn-primary" id="sheet-call">📞 Call</button>` : ""}
        <button class="btn btn-outline" id="sheet-directions">🧭 Directions</button>
        ${svc.website ? `<button class="btn btn-outline" id="sheet-website">🌐 Website</button>` : ""}
      </div>
    `;
    if (svc.phone) document.getElementById("sheet-call").addEventListener("click", () => handlers.onAction("call", svc.id));
    document.getElementById("sheet-directions").addEventListener("click", () => handlers.onAction("directions", svc.id));
    if (svc.website) document.getElementById("sheet-website").addEventListener("click", () => handlers.onAction("website", svc.id));
    backdrop.onclick = closeSheet;
  }
  function closeSheet() {
    document.getElementById("sheet-backdrop").classList.add("hidden");
    document.getElementById("service-sheet").classList.add("hidden");
  }

  // ---- Emergency overlay ----
  const EMERGENCY_TILES = [
    { id: "accident", label: "Accident", emoji: "🚗" },
    { id: "medical", label: "Medical emergency", emoji: "🏥" },
    { id: "blood", label: "Need blood", emoji: "🩸" },
    { id: "safety", label: "Safety issue", emoji: "👮" },
    { id: "fire", label: "Fire", emoji: "🔥" },
    { id: "fuel", label: "Out of fuel", emoji: "⛽" },
    { id: "breakdown", label: "Vehicle breakdown", emoji: "🛠️" },
    { id: "share", label: "Share location", emoji: "📍" },
  ];
  function renderEmergencyGrid(onPick) {
    const grid = document.getElementById("emergency-grid");
    grid.innerHTML = EMERGENCY_TILES.map((t) => `<button class="emergency-tile" data-id="${t.id}"><span class="ico" aria-hidden="true">${t.emoji}</span>${t.label}</button>`).join("");
    grid.querySelectorAll(".emergency-tile").forEach((btn) => btn.addEventListener("click", () => onPick(btn.dataset.id)));
  }
  function openEmergencyOverlay() { document.getElementById("emergency-overlay").classList.remove("hidden"); }
  function closeEmergencyOverlay() { document.getElementById("emergency-overlay").classList.add("hidden"); }

  // ---- Offline status card (rendered inline in offline tab area of settings-like view) ----
  function renderOfflineStatus(area) {
    const el = document.getElementById("offline-area-status");
    if (!area) { el.textContent = "Not downloaded yet"; return; }
    el.textContent = `${area.count} services · ${area.radiusKm} km radius · Saved ${CareOffline.timeAgo(area.savedAt)}`;
  }

  return {
    initMap, setUserPosition, recenter, renderMarkers, highlightMarker,
    renderLocationChip, renderConnectivityChip, renderBatteryChip, renderDataModeChip,
    showBanner, clearBanner, showIntentBanner, clearIntentBanner,
    renderFilters, renderServiceList, renderSkeleton, fmtDistance,
    openServiceSheet, closeSheet, renderEmergencyGrid, openEmergencyOverlay, closeEmergencyOverlay,
    renderOfflineStatus, announce, escapeHtml,
  };
})();
