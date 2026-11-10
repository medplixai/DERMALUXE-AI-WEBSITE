// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.68.0",
  versionCode: 78,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Instagram nunchi vachina lead card lo ippudu 📍 ooru kanipistundi — Instagram agent peru, number, ooru moodu adugutundi, kabatti call cheyyadaniki data untundi. Files tab lo Academy study material ippudu white pages lo — direct ga print cheyyochu. 1.67 lo vachinavi (confirm kaani slot kinda karanam, booking form, Confirm pending list, Vacharu/Raledu, call heads-up) anni idi lo unnayi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
