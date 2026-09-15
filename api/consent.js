// /api/consent — the patient's agreement to a procedure, on the record.
//
// Photographs have always asked for consent. The procedures themselves never
// did: a laser, a peel, PRP, microneedling — all of them carry real risks, all
// of them were explained across a desk, and none of it was written down
// anywhere. If a patient ever said "nobody told me that", the clinic had
// nothing but memory.
//
// Three things make a record like this worth having, and all three are here:
//
//   * The text is frozen into the record at the moment it is signed. A
//     template edited next year must not change what somebody agreed to last
//     year, so the signed copy carries its own full text and version.
//   * The signature is the patient's own, taken on the screen in front of
//     them, stored encrypted like a clinical photograph.
//   * It cannot be quietly changed afterwards. There is no edit. A consent
//     that was wrong is withdrawn, visibly, with a reason and a name.
//
// *** The WORDING of these templates is medical and legal, and is not mine to
// settle. Every template ships unapproved and cannot be used until a doctor
// has read it and approved it in the app; who approved it and when is stored
// on the template and stamped into every consent signed from it. ***
const crypto = require("crypto");
const guard = require("./_guard.js");
const staff = require("./staff.js");
const store = require("./_photo-store.js");

const json = (res, code, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
};
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const MAX_SIG = 400 * 1024;

// Drafts, written plainly and conservatively: what it is, what it cannot
// promise, what can go wrong, and what the patient must tell us. They say
// nothing about price and promise nothing about results. A doctor has to
// read each one and approve it before it can be used on anybody.
const DRAFTS = [
  {
    id: "laser-hair",
    name: "Laser hair removal",
    body: "Naaku laser hair removal treatment gurinchi vivarinchaaru.\n\n• Idi oka session tho ayipoyedi kaadu — chala sessions avasaram, and prati okkari result veru veru untundi.\n• Mottam vendrukalu poyipotayi ani evaru guarantee ivvaledu.\n• Treatment tarvata erupu, konchem mantalu, veeputa raavachu — ivi konni gantalu nunchi konni rojulu untayi.\n• Adaruga: chamaka rangu marpu (nalupu leda tellaga), bobbalu, infection, mazzalu (scar) — ivi thakkuva mandiki, kaani raavachu.\n• Ennadaina sun burn, tanning, leda medicines (isotretinoin laanti vi) unte treatment vayidha vestham.\n• Treatment tarvata cheppina sun protection, creams vaadatam naa banadhyata.\n\nNa aarogya vivaralu, medicines, allergies, garbham (pregnancy) gurinchi nenu nijam cheppanu. Naa prashnalu adigaanu, samadhanam vachindi.",
    risks: ["Erupu, mantalu, veeputa", "Chamaka rangu marpu", "Bobbalu leda scar (thakkuva)", "Anni vendrukalu poyipovu"],
  },
  {
    id: "peel",
    name: "Chemical peel",
    body: "Naaku chemical peel treatment gurinchi vivarinchaaru.\n\n• Peel chesaka chamaka erupu ekki, konni rojulu podi (peeling) vastundi — adi mamuley.\n• Result prati okkariki veru; enni sessions kavalo mundhe cheppalemu.\n• Adaruga: chamaka rangu marpu, mantalu, infection, herpes (jaladhoshapu bobbalu) malli raavadam, arudhuga scar.\n• Treatment tarvata konni rojulu ఎండ lo veltey rangu marpu ekkuva avutundi — sunscreen tappaka vaadali.\n• Naaku ippudu vaadutunna creams, acids, medicines anni cheppanu.\n\nNa aarogya vivaralu, allergies, mundu chesukunna treatments gurinchi nenu nijam cheppanu. Naa prashnalu adigaanu, samadhanam vachindi.",
    risks: ["Erupu, peeling", "Chamaka rangu marpu", "Infection leda herpes malli", "Arudhuga scar"],
  },
  {
    id: "prp-gfc",
    name: "PRP / GFC (hair)",
    body: "Naaku PRP / GFC treatment gurinchi vivarinchaaru.\n\n• Naa sonta raktham teesi, daanini prosess chesi, thala chamaka lo injections ivvatam jarugutundi.\n• Vendrukalu perugutayi ani guarantee ledu. Konthamandiki bagundi, konthamandiki takkuva phalitham.\n• Sessions chala kavali, and taruvata kuda maintenance avasaram avvochu.\n• Adaruga: noppi, veeputa, nalla mచ్చalu (bruising), thala noppi, arudhuga infection.\n• Raktham paluchu chese medicines (blood thinners), raktha samasyalu unte tappaka cheppali.\n\nNa aarogya vivaralu, medicines, allergies gurinchi nenu nijam cheppanu. Naa prashnalu adigaanu, samadhanam vachindi.",
    risks: ["Noppi, veeputa, bruising", "Phalitham prati okkariki veru", "Arudhuga infection", "Chala sessions avasaram"],
  },
  {
    id: "mnrf",
    name: "Microneedling / MNRF",
    body: "Naaku microneedling / MNRF treatment gurinchi vivarinchaaru.\n\n• Chinna soodulu tho chamaka meeda chinna gaayaalu chesi, chamaka thanne baagu cheskunela chestam.\n• Treatment tarvata erupu, veeputa konni rojulu untundi.\n• Result nemmadiga vastundi — konni vaaralu, konni sessions.\n• Adaruga: chamaka rangu marpu, infection, herpes malli raavadam, arudhuga scar.\n• Naaku keloid (pedda mazzalu) vache alavatu unte, chamaka infection unte mundhe cheppali.\n\nNa aarogya vivaralu, medicines, allergies gurinchi nenu nijam cheppanu. Naa prashnalu adigaanu, samadhanam vachindi.",
    risks: ["Erupu, veeputa", "Chamaka rangu marpu", "Infection leda herpes malli", "Arudhuga scar / keloid"],
  },
  {
    id: "general",
    name: "General procedure",
    body: "Naaku ee treatment gurinchi — adi emi cheyyalo, enni sessions kavalo, em jaragochho — vivarinchaaru.\n\n• Phalitham prati okkariki veru untundi; e phalitham ani guarantee ivvaledu.\n• Treatment tarvata erupu, veeputa, noppi raavachu.\n• Arudhuga infection, chamaka rangu marpu, scar raavachu.\n• Treatment tarvata cheppina jagrathalu paatinchadam naa banadhyata.\n• Emaina ibbandi vaste ventane clinic ki cheppali.\n\nNa aarogya vivaralu, medicines, allergies, garbham gurinchi nenu nijam cheppanu. Naa prashnalu adigaanu, samadhanam vachindi.",
    risks: ["Erupu, veeputa, noppi", "Phalitham prati okkariki veru", "Arudhuga infection leda scar"],
  },
];

async function templates(cfg) {
  const r = await guard.kvCommand(cfg, ["GET", "cns:tpl"]).catch(() => ({}));
  const saved = parse((r && r.result) || "", null);
  if (Array.isArray(saved) && saved.length) return saved;
  return DRAFTS.map((d) => Object.assign({}, d, { version: 1, approved: null }));
}
const saveTemplates = (cfg, list) => guard.kvWrite(cfg, ["SET", "cns:tpl", JSON.stringify(list)], "consent templates");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  const cfg = guard.kvConfig();
  if (!cfg) return json(res, 501, { error: "Storage not configured" });

  const auth = await staff.requireStaff(cfg, req);
  if (!auth.ok) return json(res, auth.code, { error: auth.error });
  const me = auth.me, allow = auth.allow;
  if (!allow("leads.view")) return json(res, 403, { error: "Mee role ki idi chuse permission ledu" });

  const q = req.query || {}, b = (req.method === "POST" ? req.body : null) || {};
  const a = String(q.a || b.a || "of");

  // The templates, and whether a doctor has signed off on each one.
  if (a === "templates") {
    return json(res, 200, {
      ok: true, templates: await templates(cfg),
      canApprove: allow("settings.manage"), canTake: allow("consent.take"),
    });
  }

  // One person's consents. The text is whatever they actually agreed to.
  if (a === "of") {
    const phone = digits10(q.phone || b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const r = await guard.kvCommand(cfg, ["LRANGE", `cns:of:${phone}`, "0", "49"]).catch(() => ({}));
    const ids = r.result || [];
    if (!ids.length) return json(res, 200, { ok: true, rows: [] });
    const raw = await guard.kvPipeline(cfg, ids.map((id) => ["GET", `cns:${id}`])).catch(() => []);
    const rows = raw.map((x) => parse(x, null)).filter(Boolean)
      .map((c) => Object.assign({}, c, { sig: undefined, hasSig: !!c.sigId }))
      .sort((x, y) => y.signedAt - x.signedAt);
    return json(res, 200, { ok: true, rows });
  }

  // The signature image, one at a time, never in a list.
  if (a === "sig") {
    const id = clean(q.id, 32);
    const c = parse((await guard.kvCommand(cfg, ["GET", `cns:${id}`]).catch(() => ({}))).result || "", null);
    if (!c || !c.sigId) return json(res, 404, { error: "Not found" });
    let buf;
    try { buf = await store.get(cfg, c.sigId, c.sigRec || {}); }
    catch (e) { console.error("consent: sig", e && e.message); return json(res, 404, { error: "Signature teeyaleka poyam" }); }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, private");
    return res.status(200).send(buf);
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST" });

  // Approving a template is a clinical act, so it is the owner's and it is
  // recorded. Editing the words bumps the version and clears the approval —
  // nobody should be able to change the text under an old sign-off.
  if (a === "approve" || a === "edit-template") {
    if (!allow("settings.manage")) return json(res, 403, { error: "Idi owner ki matrame" });
    const list = await templates(cfg);
    const i = list.findIndex((t) => t.id === clean(b.id, 32));
    if (i < 0) return json(res, 404, { error: "Template dorakaledu" });
    if (a === "approve") {
      list[i].approved = { by: me.name, phone: me.phone, ts: Date.now() };
      await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
        ts: Date.now(), by: me.name, phone: me.phone,
        what: `Approved the "${list[i].name}" consent wording (v${list[i].version || 1})`,
      })]).catch(() => {});
    } else {
      const body = clean(b.body, 6000);
      if (body.length < 40) return json(res, 400, { error: "Consent text chala chinnadi" });
      list[i].body = body;
      list[i].name = clean(b.name, 60) || list[i].name;
      list[i].version = Number(list[i].version || 1) + 1;
      list[i].approved = null;                 // new words, new sign-off
    }
    await saveTemplates(cfg, list);
    return json(res, 200, { ok: true, templates: list });
  }

  if (!allow("consent.take")) return json(res, 403, { error: "Mee role ki consent teesukune permission ledu" });

  // Sign it.
  if (a === "sign") {
    const phone = digits10(b.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Valid number ivvandi" });
    const name = clean(b.name, 80);
    if (!name) return json(res, 400, { error: "Patient peru ivvandi" });
    if (b.agreed !== true) return json(res, 400, { error: "Patient ophukunnaru ani tick cheyyandi" });

    const list = await templates(cfg);
    const tpl = list.find((t) => t.id === clean(b.templateId, 32));
    if (!tpl) return json(res, 404, { error: "Template dorakaledu" });
    if (!tpl.approved) return json(res, 400, { error: "Ee consent maatalaki inka doctor approval ledu — mundu approve cheyyandi" });

    const rl = await guard.rateLimit(cfg, `rl:cns:${me.phone}`, 120, 3600);
    if (!rl.allowed) return json(res, 429, { error: "Konchem aagandi" });

    const id = crypto.randomBytes(12).toString("hex");
    const now = Date.now();

    // The signature is a clinical record like any photograph: encrypted, in
    // the private store, reachable only through this endpoint.
    let sigId = "", sigRec = null;
    const m = String(b.signature || "").match(/^data:image\/png;base64,(.+)$/);
    // A consent with nobody's mark on it is a note, not a consent.
    if (!m) return json(res, 400, { error: "Patient signature kavali" });
    {
      const buf = Buffer.from(m[1], "base64");
      if (buf.length > MAX_SIG) return json(res, 413, { error: "Signature chala peddadi" });
      sigId = crypto.randomBytes(16).toString("hex");
      try { sigRec = await store.put(cfg, sigId, buf, { ttl: 3650 * 86400 }); }
      catch (e) { console.error("consent: sig save", e && e.message); return json(res, 500, { error: "Signature save avvaledu" }); }
    }

    const rec = {
      id, phone, name,
      templateId: tpl.id, templateName: tpl.name, templateVersion: Number(tpl.version || 1),
      // frozen: a template edited later must never change what this person
      // agreed to today
      body: tpl.body, risks: tpl.risks || [],
      approvedWording: tpl.approved,
      note: clean(b.note, 200),
      signedAt: now, takenBy: me.name, takenByPhone: me.phone,
      sigId, sigRec, withdrawn: null,
    };
    const ok = await guard.kvWrite(cfg, ["SET", `cns:${id}`, JSON.stringify(rec)], "consent");
    if (!ok) return json(res, 500, { error: "Save avvaledu — malli try cheyandi" });
    await guard.kvPipeline(cfg, [
      ["LPUSH", `cns:of:${phone}`, id],
      ["LTRIM", `cns:of:${phone}`, "0", "99"],
    ]).catch(() => {});
    console.log("consent signed", tpl.id, "v" + rec.templateVersion, "by staff", me.phone.slice(-4));
    return json(res, 200, { ok: true, consent: Object.assign({}, rec, { sigRec: undefined, hasSig: !!sigId }) });
  }

  // A consent is never edited and never deleted. If it was taken wrongly, or
  // the patient changes their mind, it is withdrawn — and the original stays
  // exactly as it was, next to the reason it no longer stands.
  if (a === "withdraw") {
    const id = clean(b.id, 32);
    const rec = parse((await guard.kvCommand(cfg, ["GET", `cns:${id}`]).catch(() => ({}))).result || "", null);
    if (!rec) return json(res, 404, { error: "Consent dorakaledu" });
    if (rec.withdrawn) return json(res, 400, { error: "Idi ippatike venakki teesukunnaru" });
    const why = clean(b.reason, 200);
    if (!why) return json(res, 400, { error: "Enduku ani raayandi" });
    rec.withdrawn = { ts: Date.now(), by: me.name, phone: me.phone, reason: why };
    await guard.kvWrite(cfg, ["SET", `cns:${id}`, JSON.stringify(rec)], "consent withdraw");
    await guard.kvCommand(cfg, ["LPUSH", "staff:audit", JSON.stringify({
      ts: Date.now(), by: me.name, phone: me.phone,
      what: `Withdrew the ${rec.templateName} consent of ${rec.name} — ${why}`,
    })]).catch(() => {});
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Unknown action" });
};
module.exports.DRAFTS = DRAFTS;
