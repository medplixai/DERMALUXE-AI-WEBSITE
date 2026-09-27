// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.43.0",
  versionCode: 53,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Ads page ippudu leads ekkada nunchi vastunnaro chupistundi — Eluru chuttu 25 km, 80 km lopu, chaala dooram — inka enta mandi Hindi lo raastunnaro. Dooram nunchi ekkuva vasthe e ad techindo peru tho cheptundi. Mana campaigns ippudu Telugu/English vaalliki matrame veltayi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
