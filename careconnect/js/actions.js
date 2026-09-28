/* ==========================================================================
   ACTION LAYER
   Turns a service or a location into a real device action: phone call,
   turn-by-turn navigation hand-off, or sharing the user's location.
   Never silently transmits location anywhere — every share is a user-
   initiated action through the native Share sheet or an explicit link.
   ========================================================================== */

const CareActions = (() => {
  function callNumber(number) {
    if (!number) return;
    window.location.href = `tel:${number.replace(/[^\d+]/g, "")}`;
  }

  function mapsLink(lat, lng, label) {
    const q = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`;
    return `https://www.google.com/maps?q=${q}`;
  }

  function directionsLink(destLat, destLng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
  }

  function openDirections(lat, lng) {
    window.open(directionsLink(lat, lng), "_blank", "noopener");
  }

  async function shareLocation(fix, label = "My current location") {
    if (!fix) return { ok: false, reason: "no-fix" };
    const link = mapsLink(fix.lat, fix.lng, label);
    const text = `${label} (±${Math.round(fix.accuracy)}m accuracy): ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "CareConnect location", text, url: link });
        return { ok: true, method: "webshare" };
      } catch (err) {
        if (err.name === "AbortError") return { ok: false, reason: "cancelled" };
        // fall through to clipboard
      }
    }
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return { ok: true, method: "clipboard" };
      } catch {
        /* fall through */
      }
    }
    return { ok: true, method: "manual", link, text };
  }

  function openWebsite(url) {
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    window.open(href, "_blank", "noopener");
  }

  return { callNumber, mapsLink, directionsLink, openDirections, shareLocation, openWebsite };
})();
