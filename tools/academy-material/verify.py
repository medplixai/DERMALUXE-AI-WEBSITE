#!/usr/bin/env python3 -I
"""Prove the white edition says everything the dark edition said.

For every day: page count is 2, and every English sentence in content.json
(objectives, theory headings and paragraphs, hands-on, safety, key points,
homework, tip, self-check) appears in the new PDF's text. Books: page counts
and the 4.2 MB ceiling api/material.js enforces.
Usage: python3 tools/academy-material/verify.py  (defaults to content.json beside it and assets/academy/material)
"""
import json, re, subprocess, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "content.json")))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "..", "assets", "academy", "material")
LIMIT = 4.2 * 1024 * 1024
def text(pdf): return re.sub(r"\s+", " ", subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True).stdout)
def pages(pdf): return int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1))
def norm(s): return re.sub(r"\s+", " ", s).strip()
def tel(s): return re.sub(r"[ఀ-౿]+", "", s)   # Telugu comes back as fragments; compare English only
import collections
# pdftotext joins a word wrapped at its hyphen as one word ("hospital-" +
# "grade" → "hospitalgrade"), so hyphens are dropped on both sides.
def squash(s): return re.sub(r"[\s\-]+", "", tel(s))
def words(s): return collections.Counter(re.findall(r"[A-Za-z0-9%'’]+", tel(s).replace("-", "")))
bad = 0
for track in C:
    for d in C[track]:
        pdf = f"{OUT}/{track}-day-{d['n']:02d}.pdf"
        raw = text(pdf); t = squash(raw); bag = words(raw)
        # single-column text must appear whole; the side-by-side cards come
        # out of pdftotext interleaved, so those are checked word by word
        whole = [d["title"]] + d["objectives"] + [b["h"] for b in d["theory"]] + [b["p"] for b in d["theory"]] + d["selfcheck"]
        cards = d["hands"] + d["safety"] + d["keys"] + [d["homework"], d["tip"]]
        miss = [w for w in whole if squash(w) not in t]
        need = words(" ".join(cards))
        short = [f"{w}×{n - bag.get(w, 0)}" for w, n in need.items() if bag.get(w, 0) < n]
        if short: miss.append("card words short: " + ", ".join(short[:6]))
        pc = pages(pdf)
        if miss or pc != 2:
            bad += 1; print(f"✗ {track} {d['n']:02d}: pages={pc} missing={len(miss)} " + (" | ".join(m[:70] for m in miss[:3])))
print(f"days: {60 - bad} of 60 complete and 2 pages each")
for name, want in [("skin-trainer-manual.pdf", 61), ("hair-trainer-manual.pdf", 61), ("full-30-day-study-material.pdf", 123)]:
    p = f"{OUT}/{name}"; sz = os.path.getsize(p); pc = pages(p)
    ok = pc == want and sz < LIMIT
    bad += 0 if ok else 1
    print(f"{'ok' if ok else '✗ '} {name}: {pc} pages (want {want}), {sz/1048576:.2f} MB (limit 4.2)")
total = sum(os.path.getsize(f"{OUT}/{f}") for f in os.listdir(OUT) if f.endswith(".pdf"))
print(f"total {total/1048576:.1f} MB; {'all good' if not bad else str(bad) + ' problems'}")
sys.exit(1 if bad else 0)
