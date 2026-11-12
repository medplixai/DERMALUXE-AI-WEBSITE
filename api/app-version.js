// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.71.0",
  versionCode: 81,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Students: prathi student ki status (Seat booked / Active / Training / Inactive / Discontinued) — Inactive, Discontinued ki reason adugutundi, card meeda kanipistundi; status chips tho filter. Record payment lo nijamaina balance. Leads: tile tap chesthe list anni rojulavi chupistundi, clinic / academy split tap chesthe aa list, period bayata unnavi enni ani cheptundi. Kotha lead: oke number, veru peru (family) ayite direct ga add avutundi. Sidebar lo Patients / Students numbers modatlone. Appointments: numbers paina. Patients: ✅ Vachina vaaru filter. 1.70 lo vachinavi anni idi lo unnayi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
