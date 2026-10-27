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
let bad = 0, checked = 0;

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");   // a comment is not a declaration

function look(file, text) {
  text = strip(text);
  const lines = text.split("\n");
  for (const m of text.matchAll(/font-family\s*:\s*([^;}"']*(?:"[^"]*"[^;}]*)*)[;}]/g)) {
    const stack = m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    if (!stack.some((s) => TE.test(s) || TE.test(`"${s}"`))) continue;
    checked++;
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
  checked++;
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

console.log(bad ? `\n  ${bad} of ${checked} Telugu stacks pull the font's Latin letters down with it`
                : `\n  ${checked} Telugu stacks, every one behind a Latin face`);
process.exit(bad ? 1 : 0);
