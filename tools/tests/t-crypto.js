process.env.STAFF_SECRET = "local-test-secret";
process.env.ADMIN_KEY = "local-admin";
const path = require("path"), crypto = require("crypto");
const P = path.join(process.env.DL_API, "_photo-store.js");
const store = require(P);
let fails = 0;
const is = (got, want, what) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++; console.log(`  ${ok ? "ok " : "✗  "} ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };

console.log("ENCRYPTION — a patient photo on its way to storage\n");
const original = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), crypto.randomBytes(4096)]);
const rec = store.encrypt(original);
is(rec.enc, true, "it is actually encrypted (the key is there)");
is(rec.buf.includes(Buffer.from("\x89PNG")), false, "the PNG header is gone — not recognisable as a photo");
is(!!rec.iv && !!rec.tag, true, "with a fresh iv and an authentication tag");
is(Buffer.compare(rec.buf, original) !== 0, true, "and different bytes");

const twice = store.encrypt(original);
is(twice.iv === rec.iv, false, "the same photo encrypts differently every time");

is(Buffer.compare(store.decrypt(rec.buf, rec), original), 0, "decrypting gives back exactly the original");

let threw = false;
const bad = Buffer.from(rec.buf); bad[bad.length - 5] ^= 0xff;
try { store.decrypt(bad, rec); } catch (e) { threw = true; }
is(threw, true, "one changed byte and it refuses — never silently wrong data");

let threw2 = false;
try { store.decrypt(rec.buf, Object.assign({}, rec, { tag: twice.tag })); } catch (e) { threw2 = true; }
is(threw2, true, "the tag from another photo does not open it either");

process.env.STAFF_SECRET = "somebody-elses-secret";
delete require.cache[P];
const other = require(P);
let threw3 = false;
try { other.decrypt(rec.buf, rec); } catch (e) { threw3 = true; }
is(threw3, true, "somebody with the stored blob but not the key gets nothing");
process.env.STAFF_SECRET = "local-test-secret";

// and with no key at all, it must not pretend
delete require.cache[P];
delete process.env.STAFF_SECRET; delete process.env.ADMIN_KEY;
const nokey = require(P);
const plain = nokey.encrypt(original);
is(plain.enc, false, "with no key configured it says so rather than pretending");
is(Buffer.compare(plain.buf, original), 0, "and stores the photo as it is (the store itself is private)");
console.log(fails ? `\n${fails} FAILURE(S)` : "\nencryption behaves");
