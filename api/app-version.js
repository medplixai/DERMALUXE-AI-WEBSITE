// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.76.0",
  versionCode: 86,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Kotha: ❌ WhatsApp cheraledu badge — patient ki mana message vellakapothe Leads card lo, Inbox lo red ga kanipistundi, kaaranam (Meta billing / 24 gantala window) tho. 🔁 Malli pampu okka tap — window open aite ade message, lekapothe template. Message cherina ventane badge potundi. 1.75 lo vachinavi anni idi lo unnayi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
