/* ==========================================================================
   DATA LAYER
   All real-world service data comes from OpenStreetMap via the Overpass
   API. Nothing here fabricates a business, phone number, rating, or
   opening hour — fields that OSM doesn't have for a given place are left
   undefined and the UI shows "Information not provided".

   For a production deployment this layer should sit behind your own
   backend/cache (see README) instead of calling Overpass directly from
   the browser, to respect rate limits and add resilience.
   ========================================================================== */

const CareData = (() => {
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  // Category taxonomy: id -> { label, emoji, Overpass query fragments }
  const CATEGORIES = {
    hospital: { label: "Hospitals", emoji: "🏥", tags: [["amenity", "hospital"]] },
    clinic: { label: "Clinics", emoji: "🩺", tags: [["amenity", "clinic"], ["amenity", "doctors"]] },
    pharmacy: { label: "Pharmacies", emoji: "💊", tags: [["amenity", "pharmacy"]] },
    blood_bank: { label: "Blood banks", emoji: "🩸", tags: [["healthcare", "blood_donation"], ["amenity", "blood_bank"]] },
    police: { label: "Police", emoji: "👮", tags: [["amenity", "police"]] },
    fire_station: { label: "Fire stations", emoji: "🚒", tags: [["amenity", "fire_station"]] },
    fuel: { label: "Petrol pumps", emoji: "⛽", tags: [["amenity", "fuel"]] },
    roadside: { label: "Vehicle repair", emoji: "🛠️", tags: [["shop", "car_repair"], ["shop", "tyres"]] },
    accessible: { label: "Accessible facilities", emoji: "♿", tags: [["amenity", "toilets"]] }, // filtered by wheelchair=yes below
  };

  // categories that only exist as a label/hotline, not an Overpass query
  const VIRTUAL_CATEGORIES = {
    highway_assist: { label: "Highway assistance", emoji: "🛣️" },
  };

  const cache = new Map(); // key -> { data, ts }
  const CACHE_TTL_MS = 3 * 60 * 1000;
  let inFlight = null;
  let inFlightKey = null;

  function cacheKey(lat, lng, radiusM, catIds) {
    // Round coordinates so small GPS jitter reuses the same cache entry.
    const rl = (n) => Math.round(n * 500) / 500;
    return `${rl(lat)},${rl(lng)},${radiusM},${catIds.slice().sort().join("|")}`;
  }

  function buildQuery(lat, lng, radiusM, catIds) {
    const clauses = [];
    catIds.forEach((id) => {
      const cat = CATEGORIES[id];
      if (!cat) return;
      cat.tags.forEach(([k, v]) => {
        clauses.push(`node["${k}"="${v}"](around:${radiusM},${lat},${lng});`);
        clauses.push(`way["${k}"="${v}"](around:${radiusM},${lat},${lng});`);
      });
    });
    return `[out:json][timeout:25];(${clauses.join("")});out center tags;`;
  }

  function haversineKm(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function normalizeElement(el, origin, catId) {
    const tags = el.tags || {};
    const lat = el.type === "node" ? el.lat : el.center && el.center.lat;
    const lng = el.type === "node" ? el.lon : el.center && el.center.lon;
    if (lat == null || lng == null) return null;
    const distanceKm = haversineKm(origin, { lat, lng });

    let name = tags.name || null;
    if (!name) {
      // Never invent a business name; fall back to a generic category label instead.
      name = CATEGORIES[catId] ? CATEGORIES[catId].label.replace(/s$/, "") : "Service";
    }

    const addressParts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"] || tags["addr:city"]]
      .filter(Boolean);

    return {
      id: `${el.type}/${el.id}`,
      category: catId,
      name,
      hasRealName: !!tags.name,
      lat,
      lng,
      distanceKm,
      phone: tags.phone || tags["contact:phone"] || null,
      website: tags.website || tags["contact:website"] || null,
      openingHours: tags.opening_hours || null,
      wheelchair: tags.wheelchair || null,
      emergency: tags.emergency || null,
      operator: tags.operator || null,
      rating: null, // OSM has no reliable rating field — never fabricate one
      raw: tags,
    };
  }

  async function fetchOverpass(query) {
    let lastErr;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: query,
        });
        if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("All Overpass endpoints failed");
  }

  /**
   * Fetch nearby services for the given categories. Debounced/coalesced so
   * rapid UI changes (e.g. dragging the map) don't hammer the public API,
   * and cached for CACHE_TTL_MS so repeat requests reuse recent data.
   */
  async function fetchNearby({ lat, lng, radiusM = 5000, categoryIds }) {
    const catIds = categoryIds.filter((id) => CATEGORIES[id]);
    if (catIds.length === 0) return [];

    const key = cacheKey(lat, lng, radiusM, catIds);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

    // Coalesce identical concurrent requests instead of firing duplicates.
    if (inFlight && inFlightKey === key) return inFlight;

    const query = buildQuery(lat, lng, radiusM, catIds);
    inFlightKey = key;
    inFlight = fetchOverpass(query).then((json) => {
      const origin = { lat, lng };
      const results = [];
      (json.elements || []).forEach((el) => {
        const tags = el.tags || {};
        let matchedCat = null;
        for (const id of catIds) {
          const cat = CATEGORIES[id];
          if (cat.tags.some(([k, v]) => tags[k] === v)) { matchedCat = id; break; }
        }
        if (!matchedCat) return;
        if (matchedCat === "accessible" && tags.wheelchair !== "yes") return;
        const normalized = normalizeElement(el, origin, matchedCat);
        if (normalized) results.push(normalized);
      });
      results.sort((a, b) => a.distanceKm - b.distanceKm);
      cache.set(key, { data: results, ts: Date.now() });
      inFlight = null;
      inFlightKey = null;
      return results;
    }).catch((err) => {
      inFlight = null;
      inFlightKey = null;
      throw err;
    });

    return inFlight;
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      return new Promise((resolve, reject) => {
        t = setTimeout(() => fn(...args).then(resolve).catch(reject), wait);
      });
    };
  }

  const fetchNearbyDebounced = debounce(fetchNearby, 350);

  return { CATEGORIES, VIRTUAL_CATEGORIES, fetchNearby, fetchNearbyDebounced, haversineKm, buildQuery };
})();
