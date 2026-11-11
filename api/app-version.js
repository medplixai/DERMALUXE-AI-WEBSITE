// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.70.0",
  versionCode: 80,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Leads: kotha ✅ Dr tho ayina appts tile (tap = list), Not answering list paata date paina, period picker lo counts, cards madhya border. Appointments: ✅ Vachinavi box, confirm call pending gantalu/rojulu lo. Academy: batch vaari students, Batch #2 seats aa batch vi matrame, offer end ayite cheptundi. Patients: date picker + Ee roju / Ninna / Ee vaaram. Students: reception ki Add button. Files: 🔗 URL copy. Attendance: Visits target bar. 1.69 lo vachinavi anni idi lo unnayi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
