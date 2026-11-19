// /api/app-version — what the newest staff APK is.
//
// The app asks on every launch and tells the person when they are behind.
// Public on purpose: it carries a version number and a download link, nothing
// else, and the app has to reach it before anyone has logged in.
const LATEST = {
  version: "1.75.0",
  versionCode: 85,
  // Below this, the app is too old to trust — it nags until they update.
  minVersionCode: 6,
  url: "https://www.dermaluxe.ai/assets/app/DermaLuxe-Staff.apk",
  page: "https://www.dermaluxe.ai/staff-app.html",
  notes: "Staff list (13, 14 Nov) lo points: ivala call chesina leads Ippude call lo malli raavu; Leads today lo touch cheyyanivi matrame; calendar tho oka roju leads; Upcoming follow-up label; okate number lo iddaru unte rendu cards; patients vachina roju kinda, vachinavaallu paina; age / address / inko number edit; discount tho amount automatic ga taggutundi; Discontinued red lo; attendance popup; Academy badge = booked seats; app version side bar lo; Password marchipoyara option. 1.74 lo vachinavi anni idi lo unnayi.",
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(Object.assign({ ok: true }, LATEST));
};
