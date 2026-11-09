// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.66.0",
  versionCode: 76,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Appointments paina kotha 'Confirm pending' list — agent slot hold cheste 30 nimishallo call chesi ✅ Confirm ayindi nokkandi. Slot time daatina ganta tarvata 'Vacharu / Raledu' adugutundi — ippudu evaru vacharo app ki telustundi. Lead ki ganta daatithe red alarm. 📞 Call nokkagane patient ki WhatsApp heads-up veltundi — call lift chestaru. Files tab (1.65) kuda ide lo undi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
