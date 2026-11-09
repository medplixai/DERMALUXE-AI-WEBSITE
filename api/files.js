// /api/files — the clinic's file library, for the staff app's Files tab.
//
// Owner, 9 Nov 2026: "docs anni staff app lo oka folder petti" — every form,
// poster, video and photo the clinic hands out or posts, in one place, so
// anybody on the team can download it when they need it instead of asking
// whoever made it last.
//
//   a=list   the forms, posters, videos and photos in files/manifest.json
//            (written by tools/files-sync.js, served as plain static files),
//            plus what else this person may open: the academy study-material
//            index if they may send material, and whether they see the saved
//            Instagram posters (those come from /api/poster, as on the Post tab).
//   a=mlink  a fifteen-minute link to one study-material PDF for a staff
//            member who holds academy.material. The PDF itself stays behind
//            /api/material, which checks the link — the material is paid
//            content and is never in the static folder.
const guard = require("./_guard.js");
const staff = require("./staff.js");
const manifest = require("../files/manifest.json");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};

module.exports = async (req, res) => {
  const q = req.query || {}, b = (req.method === "POST" && req.body) || {};
  const a = String(q.a || b.a || "");
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("files.view")) return json(res, 403, { error: "Mee role ki files chuse permission ledu" });

  if (a === "list") {
    const material = allow("academy.material")
      ? { tracks: [{ key: "skin", title: "Skin track" }, { key: "hair", title: "Hair track" }], days: 30,
          // the whole book is the trainer's; the day-by-day PDFs are for anyone who sends them
          books: allow("academy.certify") ? [{ key: "full", title: "30-day study material — skin & hair" }, { key: "skin", title: "Skin book" }, { key: "hair", title: "Hair book" }] : [] }
      : null;
    return json(res, 200, { ok: true, generated: manifest.generated, groups: manifest.groups, material, posters: allow("posts.view") });
  }

  if (a === "mlink") {
    if (!allow("academy.material")) return json(res, 403, { error: "Mee role ki course material access ledu" });
    const track = String(q.track || b.track || ""), day = Number(q.day || b.day || 0), book = String(q.book || b.book || "");
    const full = allow("academy.certify");
    if (book) {
      if (!["full", "skin", "hair"].includes(book)) return json(res, 400, { error: "book full/skin/hair" });
      if (!full) return json(res, 403, { error: "Trainer manual trainers ki matrame. Roju-vaari PDF lu open cheyyochu." });
    } else if (!["skin", "hair"].includes(track) || !(Number.isInteger(day) && day >= 1 && day <= 30)) {
      return json(res, 400, { error: "track skin/hair, day 1-30" });
    }
    const url = require("./material.js").staffLink(me, full, book ? { book } : { track, day });
    if (!url) return json(res, 501, { error: "Material access is not configured" });
    return json(res, 200, { ok: true, url, expiresIn: 15 * 60 });
  }

  return json(res, 400, { error: "Unknown action" });
};
