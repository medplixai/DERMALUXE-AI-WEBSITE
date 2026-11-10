#!/usr/bin/env python3 -I
"""Pull the English study-material text back out of the 60 day PDFs.

The original generator (content_skin.py / content_hair.py) is gone; the PDFs
are the only copy. Telugu text comes out of a PDF as glyph fragments, so every
Telugu line is re-supplied from api/_academy_days.json or a fixed label — this
script only trusts the PDF for English.

Usage: extract.py <material-dir> <academy_days.json> <out.json>
"""
import json, re, subprocess, sys, html
import xml.etree.ElementTree as ET

MAT, DAYS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
days = json.load(open(DAYS))
TELUGU = ("NotoSansTelugu", "Kohinoor", "TeluguSangam", "LavaTelugu")
EMOJI = ("AppleColorEmoji",)

def nodes(pdf):
    xml = subprocess.run(["pdftohtml", "-xml", "-i", "-stdout", pdf], capture_output=True, text=True).stdout
    root = ET.fromstring(xml)
    pages = []
    fonts = {}  # fontspecs accumulate across pages: page 2 only declares the new ones
    for pg in root.findall("page"):
        fonts.update({f.get("id"): (f.get("family", ""), int(f.get("size", "0"))) for f in pg.findall("fontspec")})
        rows = []
        for t in pg.findall("text"):
            fam, size = fonts[t.get("font")]
            txt = "".join(t.itertext())
            rows.append(dict(top=int(t.get("top")), left=int(t.get("left")), w=int(t.get("width")),
                             fam=fam, size=size, bold=t.find("b") is not None, text=txt))
        pages.append(rows)
    return pages

def is_tel(r): return any(k in r["fam"] for k in TELUGU)
def is_marker(r): return "ZapfDingbats" in r["fam"] and r["text"].strip() == "✦"
def is_label(r):
    # Section labels are letter-spaced capitals ("T O D A Y ' S   O B J E C T I V E S   ·"),
    # set in Jost at 9 or 11 px — Light for the sub-labels, Medium for the running head.
    if "JostRoman" not in r["fam"] or r["size"] > 11: return False
    s = r["text"].replace(" ", "").replace("·", "")
    return len(s) >= 5 and re.fullmatch(r"[A-Z'&\-]+", s) is not None
def is_head(r): return "CormorantGaramond" in r["fam"] and r["size"] >= 17 and r["size"] < 30
def is_title(r): return "CormorantGaramond" in r["fam"] and r["size"] >= 30
def is_body(r): return not is_tel(r) and not is_marker(r) and not is_label(r) and not is_head(r) and not is_title(r) \
    and not any(k in r["fam"] for k in EMOJI) and r["size"] <= 15 and r["text"].strip() != ""

def label_top(rows, word):
    for r in rows:
        if is_label(r) and word in r["text"].replace(" ", ""):
            return r["top"]
    raise SystemExit(f"label {word} not found")

def lines(rows, top0, top1, left0, left1, kinds):
    """Merge same-line nodes (±6 px) inside a box into text lines, then into
    bullets/paragraphs. kinds: 'bullets' (✦ starts an item) or 'para'."""
    body = [r for r in rows if top0 < r["top"] < top1 and left0 <= r["left"] < left1 and is_body(r)]
    marks = [r["top"] for r in rows if top0 < r["top"] < top1 and left0 <= r["left"] < left1 and is_marker(r)]
    # Telugu subtitles sit beside the section labels; those are expected and
    # re-supplied as fixed text. Telugu anywhere else in the body is lost and
    # must be reported.
    label_tops = [r["top"] for r in rows if is_label(r)]
    tel = [r for r in rows if top0 < r["top"] < top1 and left0 <= r["left"] < left1 and is_tel(r)
           and not any(abs(r["top"] - lt) <= 25 for lt in label_tops)]
    # Group into lines by vertical position first (an inline → sits 5 px lower
    # than the words around it), then read each line left to right.
    body.sort(key=lambda r: r["top"])
    merged = []
    for r in body:
        if merged and abs(r["top"] - merged[-1]["top"]) <= 6:
            merged[-1]["parts"].append(r)
        else:
            merged.append(dict(top=r["top"], parts=[r]))
    items, warn = [], []
    for ln in merged:
        txt = "".join(p["text"] for p in sorted(ln["parts"], key=lambda p: p["left"]))
        txt = re.sub(r"\s+", " ", txt).strip()
        new = kinds == "bullets" and any(-3 <= m - ln["top"] <= 7 for m in marks)
        if new or not items:
            items.append(txt)
        elif items[-1].endswith("-") and txt[:1].islower():
            # a word broken at its own hyphen ("post-" / "partum") — no space
            items[-1] = items[-1] + txt
        else:
            items[-1] = (items[-1] + " " + txt).strip()
    if tel:
        warn.append("telugu fragments inside body: " + " ".join(t["text"] for t in tel)[:60])
    return items, warn

def day(track, n):
    pdf = f"{MAT}/{track}-day-{n:02d}.pdf"
    p1, p2 = nodes(pdf)
    W = 892
    warns = []
    # ---- page 1
    title = " ".join(r["text"] for r in sorted((r for r in p1 if is_title(r) and not r["text"].startswith("Day")), key=lambda r: r["top"]))
    title = re.sub(r"\s+", " ", title).strip()
    t_obj, t_theory = label_top(p1, "OBJECTIVES"), label_top(p1, "THEORY")
    footer = max(r["top"] for r in p1) - 10
    objectives, w = lines(p1, t_obj, t_theory, 0, W, "bullets"); warns += w
    heads = sorted((r for r in p1 if is_head(r) and r["top"] > t_theory), key=lambda r: r["top"])
    theory = []
    for i, h in enumerate(heads):
        nxt = heads[i + 1]["top"] if i + 1 < len(heads) else footer
        para, w = lines(p1, h["top"] + 5, nxt, 0, W, "para"); warns += w
        theory.append({"h": re.sub(r"\s+", " ", h["text"]).strip(), "p": " ".join(para)})
    # ---- page 2
    heads2 = {re.sub(r"\s+", " ", r["text"]).strip(): r for r in p2 if is_head(r) and len(r["text"].strip()) > 1}
    def H(word):
        for k, r in heads2.items():
            if word in k: return r["top"]
        raise SystemExit(f"{pdf}: heading {word} missing — have {list(heads2)}")
    t_hands, t_safe = H("Hands-on"), H("Safety")
    t_keys, t_hw, t_tip, t_self = label_top(p2, "KEYPOINTS"), H("Homework"), H("tip"), label_top(p2, "SELF")
    MID = 440
    hands, w = lines(p2, t_hands + 5, t_keys, 0, MID, "bullets"); warns += w
    safety, w = lines(p2, t_safe + 5, t_keys, MID, W, "bullets"); warns += w
    kl, w = lines(p2, t_keys, t_hw, 0, MID, "bullets"); warns += w
    kr, w = lines(p2, t_keys, t_hw, MID, W, "bullets"); warns += w
    hw, w = lines(p2, t_hw + 5, t_self, 0, MID, "para"); warns += w
    tip, w = lines(p2, t_tip + 5, t_self, MID, W, "para")  # Telugu inside the tip is expected; JSON supplies it
    sign = min((r["top"] for r in p2 if "Trainer sign" in r["text"]), default=9999)
    selfc, w = lines(p2, t_self, sign, 0, W, "bullets"); warns += w
    j = days[track][n - 1]
    assert j["n"] == n
    # cross-checks against the message summaries the app already uses
    if j["t"].strip() != title: warns.append(f"title differs from JSON: pdf={title!r} json={j['t']!r}")
    if objectives and j["obj"].strip() != objectives[0]: warns.append(f"obj differs: pdf={objectives[0]!r} json={j['obj']!r}")
    if hands and j["hands"].strip() != hands[0]: warns.append(f"hands differs: pdf={hands[0]!r} json={j['hands']!r}")
    keys = kl + kr
    for k in j["keys"]:
        if k.strip() not in keys: warns.append(f"json key point not in pdf: {k!r}")
    if len(theory) != 3: warns.append(f"{len(theory)} theory blocks")
    return {
        "n": n, "title": title, "te": j["te"], "objectives": objectives, "theory": theory,
        "hands": hands, "safety": safety, "keys": keys, "homework": " ".join(hw),
        "tip_pdf": " ".join(tip), "tip": j["tip"], "selfcheck": selfc,
    }, warns

# The one Telugu word that sits inside an English paragraph (skin day 29, the
# viva answer). The PDF drops it; put it back by hand.
FIXES = {("skin", 29): [("'Idi naaku teliyadu,", "'Idi naaku ఖచ్చితంగా teliyadu,")]}

out = {"skin": [], "hair": []}
allw = []
for track in ("skin", "hair"):
    for n in range(1, 31):
        d, w = day(track, n)
        for old, new in FIXES.get((track, n), []):
            hit = False
            for blk in d["theory"]:
                if old in blk["p"]: blk["p"] = blk["p"].replace(old, new); hit = True
            if not hit: w.append(f"fix text not found: {old!r}")
            else: w = [x for x in w if "telugu fragments" not in x]
        out[track].append(d)
        for x in w: allw.append(f"{track} {n:02d}: {x}")
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
sc = {json.dumps(d["selfcheck"]) for t in out for d in out[t]}
print(f"60 days extracted → {OUT}; {len(sc)} distinct self-check sets; {len(allw)} warnings")
for x in allw: print("  ⚠", x)
