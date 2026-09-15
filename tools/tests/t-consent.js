process.env.STAFF_SECRET = "local-test-secret";
const path = require("path"), API = path.resolve("api");
const stub = (n, e) => { const p = path.join(API, n); require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
const KV = {}, L = {};
const real = require(path.join(API, "_guard.js"));
function run(c) {
  const [op, k] = c;
  if (op === "GET") return KV[k] !== undefined ? KV[k] : null;
  if (op === "SET") { KV[k] = c[2]; return "OK"; }
  if (op === "DEL") { delete KV[k]; return 1; }
  if (op === "LPUSH") { (L[k] = L[k] || []).unshift(c[2]); return 1; }
  if (op === "LRANGE") return L[k] || [];
  if (op === "LTRIM") return "OK";
  return null;
}
stub("_guard.js", Object.assign({}, real, {
  kvConfig: () => ({ kind: "pg" }), rateLimit: async () => ({ allowed: true }),
  kvCommand: async (cfg, c) => ({ result: run(c) }),
  kvPipeline: async (cfg, cmds) => cmds.map(run),
  kvWrite: async (cfg, c) => { run(c); return true; },
}));
let CAPS = ["leads.view", "consent.take", "settings.manage"];
let WHO = { name: "Dr Meghana", phone: "9010427777" };
stub("staff.js", { requireStaff: async () => ({ ok: true, me: WHO, allow: (c) => CAPS.includes(c) }) });
const consent = require(path.join(API, "consent.js"));
const call = (q, body) => new Promise((r) => {
  const res = { setHeader(){}, status(c){ this._c=c; return this; }, json(o){ r({ code:this._c, body:o }); return this; },
                send(x){ r({ code:this._c, bin:x }); return this; } };
  consent({ method: body ? "POST" : "GET", headers: {}, query: q||{}, body: body||{} }, res);
});
const PNG = "data:image/png;base64," + Buffer.from("\x89PNG\r\n\x1a\n" + "x".repeat(400), "binary").toString("base64");
(async () => {
  let t = await call({ a: "templates" });
  console.log("templates shipped:", t.body.templates.length, "· approved at the start:", t.body.templates.filter(x=>x.approved).length);

  const blocked = await call({ a: "sign" }, { a: "sign", phone: "9876500061", name: "Sita Rani", templateId: "laser-hair", agreed: true, signature: PNG });
  console.log("signing before a doctor approved it ->", blocked.code, "|", blocked.body.error);

  await call({ a: "approve" }, { a: "approve", id: "laser-hair" });
  t = await call({ a: "templates" });
  const appr = t.body.templates.find(x=>x.id==="laser-hair").approved;
  console.log("after approval ->", "by " + appr.by, "· recorded:", !!appr.ts);

  const noTick = await call({ a: "sign" }, { a: "sign", phone: "9876500061", name: "Sita Rani", templateId: "laser-hair", agreed: false, signature: PNG });
  console.log("without the patient ticking ->", noTick.code, "|", noTick.body.error);

  const signed = await call({ a: "sign" }, { a: "sign", phone: "9876500061", name: "Sita Rani", templateId: "laser-hair", agreed: true, signature: PNG });
  console.log("signed ->", signed.code, "· signature stored:", signed.body.consent.hasSig, "· wording v" + signed.body.consent.templateVersion);
  const frozenText = signed.body.consent.body.slice(0, 40);

  // now change the wording and check the old consent is untouched
  await call({ a: "edit-template" }, { a: "edit-template", id: "laser-hair", body: "COMPLETELY DIFFERENT WORDING that nobody ever agreed to, long enough to pass the check." });
  t = await call({ a: "templates" });
  const after = t.body.templates.find(x=>x.id==="laser-hair");
  console.log("editing the words -> version", after.version, "· approval cleared:", after.approved === null);
  const of = await call({ a: "of", phone: "9876500061" });
  console.log("the signed copy still says:", of.body.rows[0].body.slice(0,40) === frozenText ? "exactly what she agreed to ✓" : "CHANGED ✗");
  const blocked2 = await call({ a: "sign" }, { a: "sign", phone: "9876500062", name: "X", templateId: "laser-hair", agreed: true, signature: PNG });
  console.log("signing the edited-but-unapproved wording ->", blocked2.code);

  // withdrawal keeps the original
  const wd = await call({ a: "withdraw" }, { a: "withdraw", id: signed.body.consent.id, reason: "tappu patient ki teesukunnam" });
  const of2 = await call({ a: "of", phone: "9876500061" });
  console.log("withdrawn ->", wd.code, "· original text still there:", of2.body.rows[0].body.slice(0,40) === frozenText,
              "· reason kept:", of2.body.rows[0].withdrawn.reason);
  const twice = await call({ a: "withdraw" }, { a: "withdraw", id: signed.body.consent.id, reason: "again" });
  console.log("withdrawing twice ->", twice.code, "|", twice.body.error);
  console.log("there is no edit action:", (await call({ a: "edit" }, { a: "edit", id: signed.body.consent.id })).body.error);

  CAPS = ["leads.view"];
  const noPerm = await call({ a: "sign" }, { a: "sign", phone: "9876500063", name: "Y", templateId: "laser-hair", agreed: true });
  console.log("someone without consent.take ->", noPerm.code, "|", noPerm.body.error);
  const canStillSee = await call({ a: "of", phone: "9876500061" });
  console.log("but can still read the file:", canStillSee.code === 200);
  console.log("\nconsent behaves");
})();
