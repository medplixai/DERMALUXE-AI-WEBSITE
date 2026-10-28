// A Telugu line on this site is almost never all Telugu — "బ్యాచ్ 10 Nov",
// "AI చర్మ & జుట్టు విశ్లేషణ", prices, dates, the "·" that starts a sub-line.
// Name a Telugu face FIRST in a font stack and those Latin characters are
// rendered from the Telugu font, which makes the browser fetch that font's
// Latin subset as well: 31 KB from Noto Sans Telugu and 28 KB from Noto Serif
// Telugu, on every page, for letters Jost and Cormorant already carry. 59 KB
// on a phone on mobile data in Eluru, bought for nothing.
//
// Naming a Telugu face is not the mistake — naming it first is. Behind a
// Latin face it costs nothing: neither Jost nor Cormorant has a Telugu glyph,
// so every Telugu character still falls through to Noto. The generic
// (sans-serif / serif) has to stay behind Noto, though, or it answers for the
// Telugu before Noto gets the chance.
//
// The last two offenders were inline style="" attributes in index.html, which
// no stylesheet rule could have overridden, and which cost the 28 KB on their
// own until 27 October 2026.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const TE = /^"?Noto (Sans|Serif) Telugu"?$/;
const GENERIC = /^(serif|sans-serif|system-ui)$/;
let bad = 0, stacks = 0, pages = 0;

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");   // a comment is not a declaration

function look(file, text) {
  text = strip(text);
  const lines = text.split("\n");
  for (const m of text.matchAll(/font-family\s*:\s*([^;}"']*(?:"[^"]*"[^;}]*)*)[;}]/g)) {
    const stack = m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    if (!stack.some((s) => TE.test(s) || TE.test(`"${s}"`))) continue;
    stacks++;
    const line = text.slice(0, m.index).split("\n").length;
    const te = stack.findIndex((s) => TE.test(s) || TE.test(`"${s}"`));
    if (te === 0) {
      bad++;
      console.log(`  ✗  ${file}:${line} starts with ${stack[0]} — its Latin subset comes down too`);
      console.log(`         ${lines[line - 1].trim().slice(0, 96)}`);
      continue;
    }
    const gen = stack.findIndex((s) => GENERIC.test(s));
    if (gen >= 0 && gen < te) {
      bad++;
      console.log(`  ✗  ${file}:${line} has "${stack[gen]}" ahead of ${stack[te]} — the system font answers for the Telugu`);
      console.log(`         ${lines[line - 1].trim().slice(0, 96)}`);
    }
  }
}

// The two shared stacks are custom properties, not font-family declarations,
// so look() never sees them — and they are the ones everything else leans on.
const css = strip(fs.readFileSync(path.join(ROOT, "styles.css"), "utf8"));
for (const [name, latin] of [["--font-sans-te", "Jost"], ["--font-serif-te", "Cormorant Garamond"]]) {
  const m = css.match(new RegExp("^\\s*" + name + "\\s*:([^;]+);", "m"));
  if (!m) { bad++; console.log(`  ✗  ${name} is not defined`); continue; }
  stacks++;
  const stack = m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
  const te = stack.findIndex((s) => TE.test(s) || TE.test(`"${s}"`));
  const gen = stack.findIndex((s) => GENERIC.test(s));
  if (te < 0) { bad++; console.log(`  ✗  ${name} names no Telugu face — Telugu falls back to the system font`); }
  else if (te === 0) { bad++; console.log(`  ✗  ${name} starts with the Telugu face — its Latin subset comes down too`); }
  else if (stack.indexOf(latin) > te) { bad++; console.log(`  ✗  ${name} puts ${latin} behind the Telugu face`); }
  else if (gen >= 0 && gen < te) { bad++; console.log(`  ✗  ${name} has "${stack[gen]}" ahead of the Telugu face`); }
}

look("styles.css", fs.readFileSync(path.join(ROOT, "styles.css"), "utf8"));
for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")))
  look(f, fs.readFileSync(path.join(ROOT, f), "utf8"));

// Every page that leans on styles.css has to ask Google for the same four
// families, and ask for them as variable ranges. Fixed weight lists fetch one
// static file per weight: academy.html asked for 0,400;0,500;0,600;0,700;1,400
// and came down in 9 font files, 351 KB, where a treatment page on the same
// stylesheet takes 4 files and 281 KB. careers.html had the other half of the
// mistake — it never asked for Noto Sans Telugu at all, so its 39 Telugu
// characters were drawn by whatever the phone had. A family a page does not
// use costs nothing: a face is only fetched when a character needs it.
const CANON = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700" +
  "&family=Jost:wght@300..700&family=Noto+Serif+Telugu:wght@400..700" +
  "&family=Noto+Sans+Telugu:wght@300..700&display=swap";
for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (!text.includes('href="styles.css"')) continue;   // a standalone page carries its own faces
  const m = text.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]*/);
  if (!m) { bad++; console.log(`  ✗  ${f} uses styles.css but asks for no web fonts`); continue; }
  pages++;
  if (m[0] !== CANON) { bad++; console.log(`  ✗  ${f} asks Google for a different set than every other page`); console.log(`         ${m[0].slice(0, 96)}`); }
}

// Twelve pixels is the floor. wire-mobile holds it in the browser, but it
// cannot open the pages behind a login — staff, leads, marketing, the portal
// — and those are exactly where the smallest type was: thirty-eight rules in
// the staff dashboard alone, down to .6rem. A size written in the source is
// something a reader can check without a session, so check it here.
let sizes = 0;   // the file already has a strip() for comments
for (const f of fs.readdirSync(ROOT).filter((f) => /\.(html|css)$/.test(f))) {
  const text = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
  for (const m of text.matchAll(/font-size:\s*(\.\d+|0?\.\d+)rem/g)) {
    sizes++;
    const px = parseFloat(m[1]) * 16;
    if (px < 12) { bad++; console.log(`  ✗  ${f} sets text at ${m[1]}rem — ${px.toFixed(2)}px, under the 12px floor`); }
  }
  for (const m of text.matchAll(/font-size:\s*(\d+)px/g)) {
    if (/<svg[\s\S]*$/.test(text.slice(0, m.index)) && !/<\/svg>[\s\S]*$/.test(text.slice(0, m.index))) continue;
    sizes++;
    if (+m[1] < 12) { bad++; console.log(`  ✗  ${f} sets text at ${m[1]}px, under the 12px floor`); }
  }
}

console.log(bad ? `\n  ${bad} problem(s) in ${stacks} Telugu stacks, ${pages} font requests and ${sizes} sizes`
                : `\n  ${stacks} Telugu stacks each behind a Latin face, ${pages} pages asking for the same four families, ${sizes} sizes all at 12px or more`);
process.exit(bad ? 1 : 0);
