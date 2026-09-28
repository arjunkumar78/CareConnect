/* ==========================================================================
   INTENT LAYER
   Classifies a plain-language situation into one or more *service
   categories* — nothing more. This layer must never attempt to diagnose,
   assess severity, or give medical/legal judgment. It only decides which
   nearby-service categories are relevant and in what priority order.
   ========================================================================== */

const CareIntent = (() => {
  // Each rule: keywords -> ordered category priority + a plain label.
  // Keep this data-driven so it stays auditable and easy to extend.
  const RULES = [
    {
      id: "accident",
      label: "Accident",
      keywords: ["accident", "crash", "collision", "hit by", "run over", "injured", "injury"],
      categories: ["hospital", "police", "fire_station", "blood_bank"],
    },
    {
      id: "medical",
      label: "Medical emergency",
      keywords: ["emergency", "medical", "heart attack", "not breathing", "unconscious", "seizure", "bleeding badly", "severe pain"],
      categories: ["hospital", "blood_bank"],
    },
    {
      id: "blood",
      label: "Need blood",
      keywords: ["blood", "transfusion", "blood bank", "blood donor"],
      categories: ["blood_bank", "hospital"],
    },
    {
      id: "medicine",
      label: "Need medicine",
      keywords: ["medicine", "pharmacy", "chemist", "prescription", "tablet", "painkiller"],
      categories: ["pharmacy", "hospital"],
    },
    {
      id: "fire",
      label: "Fire",
      keywords: ["fire", "smoke", "burning", "gas leak", "explosion"],
      categories: ["fire_station", "hospital", "police"],
    },
    {
      id: "safety",
      label: "Safety issue",
      keywords: ["unsafe", "don't feel safe", "being followed", "harassment", "assault", "theft", "robbed", "danger", "threat"],
      categories: ["police", "hospital"],
    },
    {
      id: "fuel",
      label: "Out of fuel",
      keywords: ["petrol", "fuel", "gas station", "out of gas", "ran out of petrol", "diesel"],
      categories: ["fuel", "roadside", "highway_assist"],
    },
    {
      id: "breakdown",
      label: "Vehicle breakdown",
      keywords: ["car broke down", "broke down", "breakdown", "flat tyre", "flat tire", "puncture", "vehicle repair", "mechanic", "towing", "tow truck"],
      categories: ["roadside", "fuel", "highway_assist"],
    },
    {
      id: "clinic",
      label: "Clinic / general care",
      keywords: ["clinic", "doctor", "checkup", "appointment"],
      categories: ["clinic", "hospital", "pharmacy"],
    },
    {
      id: "accessible",
      label: "Accessible facility",
      keywords: ["wheelchair", "accessible", "accessibility", "disabled access"],
      categories: ["accessible", "hospital"],
    },
  ];

  function classify(text) {
    const q = (text || "").toLowerCase().trim();
    if (!q) return null;
    for (const rule of RULES) {
      if (rule.keywords.some((k) => q.includes(k))) {
        return { id: rule.id, label: rule.label, categories: rule.categories, matchedFrom: "keyword" };
      }
    }
    // Fall back: treat the raw text as a category/free-text search term.
    return { id: "freeform", label: `Results for "${text}"`, categories: [], matchedFrom: "freeform", query: text };
  }

  return { classify, RULES };
})();
