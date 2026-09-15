process.env.BLOB_READ_WRITE_TOKEN = "test-token";
// An in-memory stand-in for Vercel Blob, so the real backup and the real
// restore run against each other.
const BLOBS = new Map();
const Module = require("module"), origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === "@vercel/blob") return "vercel-blob-stub";
  return origResolve.call(this, req, ...rest);
};
require.cache["vercel-blob-stub"] = { id: "vercel-blob-stub", filename: "vercel-blob-stub", loaded: true, exports: {
  put: async (pathname, body) => { BLOBS.set(pathname, Buffer.from(body)); return { pathname, size: body.length }; },
  get: async (pathname) => { if (!BLOBS.has(pathname)) return { statusCode: 404 };
    const b = BLOBS.get(pathname);
    return { statusCode: 200, stream: (async function* () { yield b; })() }; },
  list: async ({ prefix }) => ({ blobs: [...BLOBS.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ pathname: k, size: BLOBS.get(k).length, uploadedAt: new Date().toISOString() })) }),
  del: async (pathname) => { BLOBS.delete(pathname); },
} };

const h = require("./harness.js");
const backup = h.load("cron-backup");
const restore = h.load("kvrestore");
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

(async () => {
  console.log("BACKUP → RESTORE — can the clinic actually come back?\n");
  h.run(["RPUSH", "dl_leads", JSON.stringify({ name: "Latha", phone: "9876500091" })]);
  h.run(["RPUSH", "dl_leads", JSON.stringify({ name: "Ravi", phone: "9876500092" })]);
  h.run(["SET", "bill:B1001", JSON.stringify({ id: "B1001", total: 5000 })]);
  h.run(["HSET", "staff:users", "9876500051", JSON.stringify({ name: "Sowmya", role: "reception" })]);
  h.run(["HSET", "staff:users", "9876500052", JSON.stringify({ name: "Latha", role: "therapist" })]);
  h.run(["SADD", "dl_optout", "9876500099"]);
  h.run(["SET", "otp:9876500051", "123456", "EX", "600"]);

  const day = backup.istDay();
  const made = await backup.writeBackup({ kind: "pg" }, day);
  is(made.keys > 0, true, `the backup holds ${made.keys} keys, ${made.bytes} bytes`);

  const stored = BLOBS.get(`${backup.PREFIX}${day}.json`);
  is(stored.includes(Buffer.from("Sowmya")), false, "and a staff name is NOT readable inside the file");
  is(stored.includes(Buffer.from("9876500091")), false, "nor is a patient's number");
  is(JSON.parse(stored.toString()).enc, true, "it is marked encrypted");

  // look inside it without changing anything
  const peek = await h.call(restore, { a: "peek" }, { a: "peek", day });
  is(peek.code, 200, "the owner can look inside a backup");
  is(peek.body.leads, 2, "and see it has both leads");
  console.log(`      types inside: ${JSON.stringify(peek.body.byType)}`);

  // now lose everything
  h.run(["DEL", "dl_leads"]); h.run(["DEL", "bill:B1001"]);
  h.run(["DEL", "staff:users"]); h.run(["DEL", "dl_optout"]);
  is(h.run(["LRANGE", "dl_leads", "0", "9"]).length, 0, "everything is gone");

  // restore needs the date typed twice
  const noConfirm = await h.call(restore, { a: "restore" }, { a: "restore", day });
  is(noConfirm.code, 400, "restoring without typing the date again is refused");
  const wrongDay = await h.call(restore, { a: "restore" }, { a: "restore", day, confirm: "2020-01-01" });
  is(wrongDay.code, 400, "and typing a different date is refused");

  const r = await h.call(restore, { a: "restore" }, { a: "restore", day, confirm: day });
  is(r.code, 200, `restored ${r.body.keys} keys`);

  const leads = h.run(["LRANGE", "dl_leads", "0", "9"]).map((x) => JSON.parse(x));
  is(leads.length, 2, "both leads are back");
  is(leads.map((l) => l.name).sort(), ["Latha", "Ravi"], "with their names");
  is(leads[0].name, "Latha", "and in the order they were in");
  is(JSON.parse(h.run(["GET", "bill:B1001"])).total, 5000, "the bill is back");
  const users = h.run(["HGETALL", "staff:users"]);
  is(users.length, 4, "both staff logins are back");
  is(h.run(["SMEMBERS", "dl_optout"]), ["9876500099"], "and who asked not to be messaged");

  // restoring does not delete work done since
  h.run(["RPUSH", "dl_leads", JSON.stringify({ name: "Came in today", phone: "9876500093" })]);
  h.run(["SET", "bill:B1002", JSON.stringify({ id: "B1002", total: 900 })]);
  await h.call(restore, { a: "restore" }, { a: "restore", day, confirm: day });
  is(!!h.run(["GET", "bill:B1002"]), true, "a bill raised after the backup survives the restore");
  console.log(`  ·   (the restored leads list goes back to ${h.run(["LRANGE", "dl_leads", "0", "9"]).length} — a list is replaced whole)`);

  const audit = h.run(["LRANGE", "staff:audit", "0", "5"]);
  is(audit.some((x) => /RESTORED/.test(x)), true, "a restore is written into the audit");

  // and the list of backups
  const list = await h.call(restore, { a: "list" });
  is(list.body.backups.length, 1, "the owner can see what backups exist");

  h.as(["money.view"]);
  is((await h.call(restore, { a: "list" })).code, 403, "nobody but the owner can touch backups");
  h.as(["*"]);
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nbackup and restore behave");
})();
