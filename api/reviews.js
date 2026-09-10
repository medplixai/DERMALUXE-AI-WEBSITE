// GET /api/reviews — Google Business Profile rating + latest reviews for the
// homepage "Patient Reviews" section. Public, read-only, numbers/text only.
//
// Needs GOOGLE_PLACES_API_KEY (Places API (New) enabled on the key).
// GOOGLE_PLACE_ID is optional: when missing, the place is looked up once by
// name + city via Text Search and the id is cached in KV.
// Results are cached in KV for 6h and at the edge for 1h, so Google is hit a
// handful of times a day regardless of traffic.
const guard = require("./_guard.js");

const CACHE_KEY = "gplace:reviews:v1";
const PLACE_KEY = "gplace:id";
const CACHE_SEC = 6 * 3600;
const LOOKUP_QUERY = "DermaLuxe by Medicare Skin and Hair Clinic, Kasturi Vari Street, Eluru";
// Listing's Google Maps CID — the fallback "write a review" link when the
// place id is not (yet) known. Opens the listing where "Write a review" sits.
const MAPS_CID_URL = "https://www.google.com/maps?cid=6720707313608974554";

const H = (key) => ({ "X-Goog-Api-Key": key, "Content-Type": "application/json" });

async function findPlaceId(key) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { ...H(key), "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress" },
    body: JSON.stringify({ textQuery: LOOKUP_QUERY, languageCode: "en", regionCode: "IN", maxResultCount: 3 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`searchText ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const hit = (j.places || []).find((p) => /dermaluxe/i.test((p.displayName || {}).text || "")) || (j.places || [])[0];
  return hit ? hit.id : null;
}

async function fetchPlace(key, placeId) {
  const fields = "id,rating,userRatingCount,googleMapsUri,reviews";
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en&regionCode=IN`, {
    headers: { ...H(key), "X-Goog-FieldMask": fields },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`placeDetails ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

function shape(p, placeId) {
  const reviews = (p.reviews || [])
    .map((rv) => ({
      author: ((rv.authorAttribution || {}).displayName || "Google user").trim(),
      rating: Number(rv.rating || 0),
      text: (((rv.text || {}).text) || ((rv.originalText || {}).text) || "").trim(),
      when: rv.relativePublishTimeDescription || "",
      time: rv.publishTime || "",
      url: ((rv.authorAttribution || {}).uri) || "",
    }))
    .filter((rv) => rv.rating >= 4 && rv.text.length >= 12)
    .sort((a, b) => (b.rating - a.rating) || (b.time > a.time ? 1 : -1))
    .slice(0, 6);
  return {
    ok: true,
    configured: true,
    placeId,
    rating: p.rating ? Math.round(Number(p.rating) * 10) / 10 : null,
    count: Number(p.userRatingCount || 0),
    mapsUrl: p.googleMapsUri || MAPS_CID_URL,
    writeUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    reviews,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(200).json({ ok: true, configured: false, writeUrl: MAPS_CID_URL, mapsUrl: MAPS_CID_URL, reviews: [] });

  const cfg = guard.kvConfig();
  const ip = guard.getIp(req);
  const rl = await guard.rateLimit(cfg, `rl:rv:m:${ip}`, 30, 60);
  if (!rl.allowed) return res.status(429).json({ error: "Too many requests" });

  // Serve the KV copy when fresh
  if (cfg && !(req.query && req.query.refresh)) {
    try {
      const c = await guard.kvCommand(cfg, ["GET", CACHE_KEY]);
      if (c && c.result) return res.status(200).json(JSON.parse(c.result));
    } catch (e) {}
  }

  try {
    let placeId = process.env.GOOGLE_PLACE_ID || "";
    if (!placeId && cfg) {
      try { const c = await guard.kvCommand(cfg, ["GET", PLACE_KEY]); if (c && c.result) placeId = c.result; } catch (e) {}
    }
    if (!placeId) {
      placeId = await findPlaceId(key);
      if (!placeId) throw new Error("place not found via searchText");
      if (cfg) { try { await guard.kvCommand(cfg, ["SET", PLACE_KEY, placeId]); } catch (e) {} }
    }
    const out = shape(await fetchPlace(key, placeId), placeId);
    if (cfg) { try { await guard.kvCommand(cfg, ["SET", CACHE_KEY, JSON.stringify(out), "EX", String(CACHE_SEC)]); } catch (e) {} }
    return res.status(200).json(out);
  } catch (e) {
    console.error("reviews:", e.message);
    // Never break the page — fall back to the plain CTA
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, configured: true, error: e.message.slice(0, 160), writeUrl: MAPS_CID_URL, mapsUrl: MAPS_CID_URL, reviews: [] });
  }
};
