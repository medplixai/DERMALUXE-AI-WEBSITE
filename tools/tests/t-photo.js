// Clinical photos, and the phones that get the clinic's notifications.
//
// Photos are patients' faces. Nothing is kept without a recorded consent
// tick, nothing is served to somebody whose role does not cover that record,
// and which record it is — a patient's or a student's — is read from the
// record itself, never from what the request says. The encryption here is
// the real one; only the blob store is in memory.
//
// A phone registered for notifications receives lead names and numbers, so
// a device belongs to one person, can be moved only by that person, and the
// Control panel can cut any of them off.
const path = require("path");
const h = require("./harness.js");
const API = process.env.DL_API;
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

// the real device registry, over the harness store (the harness stubs it)
delete require.cache[path.join(API, "_push.js")];
const photo = h.load("photo"), push = h.load("push");
const JPEG = "data:image/jpeg;base64," + Buffer.from("\xff\xd8\xff face").toString("base64");
const OWNER = { name: "Owner", phone: "9010427777", role: "owner" };
const DESK = { name: "Sowmya", phone: "9876500301", role: "reception" };
const TRAINER = { name: "Ravi", phone: "9876500302", role: "trainer" };

(async () => {
  console.log("PHOTOS AND DEVICES\n");

  console.log("  — taking a photo —");
  h.as(["leads.view", "leads.edit"], DESK);
  const noConsent = await h.call(photo, {}, { a: "put", kind: "patient", ref: "9876500310", dataUrl: JPEG });
  is(noConsent.code, 400, "without the consent tick, nothing is stored");
  is((await h.call(photo, {}, { a: "put", kind: "patient", ref: "9876500310", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=", consent: true })).code, 400, "only JPEG, PNG or WebP — no SVG");
  const big = "data:image/jpeg;base64," + "A".repeat(1300000);
  is((await h.call(photo, {}, { a: "put", kind: "patient", ref: "9876500310", dataUrl: big, consent: true })).code, 413, "and nothing too large");
  const put = await h.call(photo, {}, { a: "put", kind: "patient", ref: "9876500310", dataUrl: JPEG, consent: true, label: "Before" });
  is(put.code, 200, "with it, the photo is kept");
  const rec = JSON.parse(h.run(["GET", `ph:img:${put.body.id}`]));
  is([rec.consent.given, rec.consent.by, rec.by], [true, "Sowmya", "Sowmya"], "stamped with who confirmed consent, and who took it");
  is(rec.b64, undefined, "the picture itself is not in the record");
  is(String(h.store.blobs.get(put.body.id).buf).includes("face"), false, "and what is stored is encrypted");
  const back = await h.call(photo, { a: "get", id: put.body.id });
  is([back.code, String(back.bin).includes("face"), back.headers["Cache-Control"]], [200, true, "no-store, private"], "it comes back out unchanged, and is never cached");
  const lst = await h.call(photo, { a: "list", kind: "patient", ref: "9876500310" });
  is(lst.body.photos.map((p) => p.label), ["Before"], "and is on the patient's timeline");

  console.log("\n  — who may see it —");
  h.as(["academy.view", "academy.edit"], TRAINER);
  is((await h.call(photo, { a: "get", id: put.body.id })).code, 403, "a trainer cannot open a patient's photo");
  is((await h.call(photo, { a: "get", id: put.body.id, kind: "student" })).code, 403, "not even by claiming it is a student's");
  const st = await h.call(photo, {}, { a: "put", kind: "student", ref: "DLA-0001", dataUrl: JPEG, consent: true, label: "ID proof" });
  is(st.code, 200, "a trainer can file a student's document");
  h.as(["leads.view", "leads.edit"], DESK);
  is((await h.call(photo, { a: "get", id: st.body.id, kind: "lead" })).code, 403, "and the desk cannot open it by calling it a lead");
  is((await h.call(photo, {}, { a: "del", id: st.body.id, kind: "lead" })).code, 403, "or delete it that way");
  h.as(["leads.view"], DESK);
  is((await h.call(photo, {}, { a: "put", kind: "patient", ref: "9876500310", dataUrl: JPEG, consent: true })).code, 403, "somebody who may only look cannot add");

  console.log("\n  — deleting —");
  h.as(["leads.view", "leads.edit"], DESK);
  const del = await h.call(photo, {}, { a: "del", id: put.body.id });
  is(del.code, 200, "the desk can delete a patient photo");
  is([h.run(["GET", `ph:img:${put.body.id}`]), h.store.blobs.has(put.body.id)], [null, false], "the record and the picture are both gone");
  is((await h.call(photo, { a: "list", kind: "patient", ref: "9876500310" })).body.photos, [], "and off the timeline");
  is(JSON.parse(h.run(["LRANGE", "staff:audit", "0", "0"])[0]).what.startsWith("Deleted a patient photo"), true, "and the deletion is in the audit");

  console.log("\n  — phones that get notifications —");
  const TOK = "d".repeat(40), TOK2 = "e".repeat(40);
  h.as(["leads.view"], DESK);
  is((await h.call(push, {}, { a: "register", token: "short" })).code, 400, "a token that is not one is refused");
  const reg = await h.call(push, {}, { a: "register", token: TOK });
  is([reg.code, reg.body.first], [200, true], "a phone registers");
  is((await h.call(push, { a: "status" })).body.devices, 1, "and is counted as this person's");
  h.as(["leads.view"], TRAINER);
  await h.call(push, {}, { a: "register", token: TOK });
  is(h.run(["SMEMBERS", "push:ph:9876500301"]), [], "the same phone signing in as someone else moves to them");
  is(h.run(["SMEMBERS", "push:ph:9876500302"]), [TOK], "and only them — no-one gets another's notifications");
  h.as(["leads.view"], DESK);
  await h.call(push, {}, { a: "register", token: TOK2 });
  is((await h.call(push, {}, { a: "unregister", token: TOK })).code, 403, "you cannot remove somebody else's phone");
  is((await h.call(push, { a: "devices" })).code, 403, "and the device list is for the Control panel only");
  h.as(["*"], OWNER);
  is(((await h.call(push, { a: "devices" })).body.devices || []).length, 2, "the owner sees every phone");
  await h.call(push, {}, { a: "revoke", phone: "9876500301" });
  is([h.run(["SMEMBERS", "push:ph:9876500301"]), h.run(["SISMEMBER", "push:tokens", TOK2])], [[], 0], "and can cut a person's phones off");
  const health = await h.call(push, { a: "health" });
  is(Object.keys(health.body).sort(), ["configured", "ok", "parsed", "present", "project"], "the open health check says only whether it is set up");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nphotos and devices behave");
  process.exit(fails ? 1 : 0);
})();
