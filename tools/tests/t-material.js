// Academy study material, and the WhatsApp templates the clinic sends.
//
// The course PDFs are what a student pays for. A link opens them only for a
// student whose payment is recorded and whose seat is live, only for their
// own specialisation, and the complete book only for trainers. A token for
// one student cannot be edited into another's.
//
// The templates are submitted to Meta from /api/wa-setup. Meta rejects a
// template whose example does not fill every {{n}} — and a rejected template
// is a reminder, a receipt or a review ask that silently never goes out.
const path = require("path");
const crypto = require("crypto");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

const submitted = [];
global.fetch = async (url, opt) => {
  if (String(url).includes("message_templates") && opt && opt.method === "POST") { submitted.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({ id: "1" }) }; }
  return { ok: true, json: async () => ({ data: [] }) };
};

const material = h.load("material"), waSetup = h.load("wa-setup");
const sig = (id) => crypto.createHmac("sha256", process.env.STAFF_SECRET).update("acad:" + id).digest("hex").slice(0, 24);
const pdf = (r) => r.code === 200 && r.headers["Content-Type"] === "application/pdf";
const student = (id, o) => h.run(["SET", `acad:st:${id}`, JSON.stringify(Object.assign({ id, name: id, course: "skin", paid: 9999, fee: 49999, status: "active" }, o))]);

(async () => {
  console.log("STUDY MATERIAL AND TEMPLATES\n");

  console.log("  — who opens the course material —");
  is((await h.call(material, { diag: "1" })).body.files > 60, true, "the PDFs travel with the function");
  student("DLA-0001");
  student("DLA-0002", { paid: 0 });
  student("DLA-0003", { status: "dropped" });
  student("DLA-0004", { course: "both" });
  const t1 = `DLA-0001.${sig("DLA-0001")}`;
  is(pdf(await h.call(material, { t: t1, track: "skin", day: "3" })), true, "a paid student opens their day's material");
  is(pdf(await h.call(material, { k: `${t1}~skin~4` })), true, "and through the one-value link a WhatsApp button carries");
  is((await h.call(material, { t: t1, track: "hair", day: "3" })).code, 403, "not the other specialisation");
  is((await h.call(material, { t: t1, book: "full" })).code, 403, "and not the trainer's complete book");
  is((await h.call(material, { t: t1, track: "skin", day: "31" })).code, 403, "there is no day 31");
  is((await h.call(material, { t: `DLA-0002.${sig("DLA-0002")}`, track: "skin" })).code, 403, "no payment recorded, no material");
  is((await h.call(material, { t: `DLA-0003.${sig("DLA-0003")}`, track: "skin" })).code, 403, "a student who has dropped out is shut out");
  is(pdf(await h.call(material, { t: `DLA-0004.${sig("DLA-0004")}`, track: "hair" })), true, "a skin-and-hair student opens both");
  is((await h.call(material, { t: `DLA-0002.${sig("DLA-0001")}`, track: "skin" })).code, 403, "one student's signature does not open another's account");
  is((await h.call(material, { t: "DLA-0001.forged", track: "skin" })).code, 403, "nor does a made-up one");
  is(JSON.parse(h.run(["LRANGE", "acad:dl", "0", "0"])[0]).id, "DLA-0004", "every student download is recorded");
  process.env.ACADEMY_TRAINER_PHONES = "9876500601";
  is(pdf(await h.call(material, { t: `t9876500601.${sig("t9876500601")}`, book: "skin" })), true, "a trainer opens the manual");
  is((await h.call(material, { t: `t9876500602.${sig("t9876500602")}`, book: "skin" })).code, 403, "a correctly signed trainer link for somebody no longer a trainer does not");
  const staffTok = { headers: { authorization: "Bearer " + Buffer.from(JSON.stringify({ exp: Date.now() + 3600000 })).toString("base64url") + "." + crypto.createHmac("sha256", process.env.STAFF_SECRET).update(Buffer.from(JSON.stringify({ exp: Date.now() + 3600000 })).toString("base64url")).digest("hex") } };
  h.as(["academy.material"]);
  is(pdf(await h.call(material, { track: "skin", day: "1" }, null, staffTok)), true, "staff with academy.material open the day's material");
  is((await h.call(material, { book: "skin" }, null, staffTok)).code, 403, "but only trainers (academy.certify) the manual");
  h.as(["leads.view"]);
  is((await h.call(material, { track: "skin" }, null, staffTok)).code, 403, "and staff without it, nothing — even with a valid login");
  h.as(["*"]);

  console.log("\n  — the WhatsApp templates —");
  process.env.WA_CLOUD_TOKEN = "cloud";
  h.as(["leads.view"]);
  is((await h.call(waSetup, { key: "guess" })).code, 401, "the template tool refuses a wrong key — and a colleague who does not run the settings");
  h.as(["settings.manage"]);
  is((await h.call(waSetup, { action: "test", to: "123" })).code, 400, "but a manager gets in from the app, with no key in the link");
  h.as(["*"]);
  is((await h.call(waSetup, { key: "local-admin", action: "test", to: "123" })).code, 400, "a test send needs a real number");
  await h.call(waSetup, { key: "local-admin", action: "create" });
  is(submitted.length > 5, true, "every template in the source is submitted");
  const bad = [];
  for (const t of submitted) {
    for (const c of t.components || []) {
      const vars = (String(c.text || "").match(/\{\{\d+\}\}/g) || []).length;
      if (c.type === "BODY" && vars) {
        const ex = ((c.example || {}).body_text || [])[0] || [];
        if (ex.length !== vars) bad.push(`${t.name} body: ${vars} slots, ${ex.length} examples`);
      }
      if (c.type === "HEADER" && c.format === "TEXT" && vars && !((c.example || {}).header_text || []).length) bad.push(`${t.name} header`);
      if (c.type === "FOOTER" && vars) bad.push(`${t.name} footer has a variable — Meta refuses those`);
    }
    if (t.optional !== undefined || t.optionalWhy !== undefined) bad.push(`${t.name} sends our own bookkeeping to Meta`);
    if (!/^[a-z0-9_]+$/.test(t.name)) bad.push(`${t.name}: Meta names are lower case and underscores`);
  }
  is(bad, [], "each one's example fills every slot, so Meta has nothing to reject it for");
  const names = submitted.map((t) => t.name);
  is(names.length, new Set(names).size, "and no name is used twice");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nstudy material and templates behave");
  process.exit(fails ? 1 : 0);
})();
