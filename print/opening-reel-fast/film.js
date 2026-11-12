// DermaLuxe Opening Reel (fast): pure function of time. window.seek(t) paints frame t (see lib/motion.js).
// Timing is in beats (u) on the measured grid; docs/shotlist.md is the plan this file follows.
import * as M from './lib/motion.js';

const { W, H, E, prog, lerp, clamp, springU, SPRING, wobble, font, layout, glyph, text, fitSize, fill, cover, rrect, shake } = M;

const C = { paper: '#f6f2ea', ink: '#0d0c0b', gold: '#b8873b', goldHi: '#e7c98a', grey: '#6d665c' };
const UI = 'UI', TE = 'Te';

const HOSTS = [
  ['nagaraju', 'NAGARAJU', 'BANDARU', 'MBA', 'Founder & Managing Director'],
  ['meghana', 'DR. MEGHANA', 'VALETI', 'MD (DVL)', 'Co-Founder & Medical Director'],
  ['nikhitha', 'DR. NIKHITHA', 'PRIYANKA', 'MD (DVL)', 'Chief Dermatologist, DermaLuxe'],
  ['saidivija', 'DR. KAMMA', 'SAI DIVIJA', 'MD (DVL)', 'Chief Dermatologist, Medicare Skin & Hair Clinic'],
];

const HITS = [
  [0, 'GRAND', 'impact'],
  [1, 'OPENING', 'thud', { pitch: 140, to: 50 }],
  [1.5, 'telugu', 'tick'],
  [2, 'card whips in', 'whoosh', { len: 0.35 }],
  [3, 'invited pill', 'pop', { pitch: 'B5' }],
  [5, 'SAVE', 'click'], [6, 'THE', 'click'], [7, 'DATE', 'click'],
  [8, 'drop: 06', 'riser', { len: 1.8 }],
  [8, '06 lands', 'impact'],
  [9, 'NOV 2026', 'click'],
  [10, 'FRIDAY', 'thud'],
  [11, '10:32', 'click'],
  [12, 'telugu band', 'pop', { pitch: 'E6' }],
  [14, 'pin + ELURU', 'thud'],
  [15, 'RAMA MAHAL', 'click'],
  [16, 'entrance card', 'whoosh', { len: 0.3 }],
  [17, 'address', 'tick'],
  [18, 'host 1', 'whoosh', { len: 0.3 }], [20, 'host 2', 'whoosh', { len: 0.3, pan: 0.3 }],
  [22, 'host 3', 'whoosh', { len: 0.3 }], [24, 'host 4', 'whoosh', { len: 0.3, pan: -0.3 }],
  [25.75, 'grid', 'pop', { pitch: 'E6' }],
  [28, 'end card', 'impact'],
  [29, 'phone', 'bell', { pitch: 'E6' }],
];

const sizeOf = (f) => parseInt(f.split(' ')[1], 10);

// a word whose letters slam in from above (dir -1) or below (dir 1), each a hair later, then squash
function slam(ctx, str, cx, base, size, color, u, u0, dir = -1, weight = 900, track = -0.03) {
  const f = font(size, weight, UI);
  const L = layout(ctx, str, f, track * size);
  const x0 = cx - L.width / 2;
  L.glyphs.forEach((g, j) => {
    if (g.ch === ' ') return;
    const k = springU(u, u0 - 0.35 + j * 0.035, SPRING.snappy);
    if (k <= 0) return;
    const q = 0.09 * wobble(u - u0 - j * 0.035, 2.6, 6);
    glyph(ctx, g.ch, x0 + g.cx, base + dir * (1 - k) * H * 0.7, f, color, 1 - q, 1 + q);
  });
}
// a small line rising out of a mask
function rise(ctx, str, x, y, f, color, u, u0, align = 'center', track = 0) {
  const p = E.outQuint(prog(u, u0, u0 + 0.6));
  if (p <= 0) return;
  const s = sizeOf(f);
  ctx.save(); ctx.beginPath(); ctx.rect(0, y - s * 1.2, W, s * 1.55); ctx.clip();
  text(ctx, str, x, y + (1 - p) * s * 1.3, f, color, align, track);
  ctx.restore();
}
function pill(ctx, str, cx, cy, u, u0, bg = C.ink, fg = C.paper) {
  const k = springU(u, u0 - 0.15, SPRING.bouncy);
  if (k <= 0) return;
  const f = font(46, 800, UI);
  ctx.font = f; ctx.letterSpacing = '6px';
  const w = ctx.measureText(str).width + 90, h = 96;
  ctx.letterSpacing = '0px';
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
  text(ctx, str, 0, 16, f, fg, 'center', 6);
  ctx.restore();
}
// whip: A leaves while B arrives, both on screen; returns the offset for A (B is A + W*dir)
const whip = (u, u0, dur = 0.5) => E.inOutCubic(prog(u, u0 - dur / 2, u0 + dur / 2));

// ---------------------------------------------------------------- 1 GRAND OPENING (0..2)
function sGrand(ctx, u) {
  fill(ctx, C.paper);
  shake(ctx, u, 0, 18); shake(ctx, u, 1, 12, 7);
  const size = fitSize(ctx, 'OPENING', 900, UI, 980, 300, -0.03);
  slam(ctx, 'GRAND', W / 2, 860, size, C.ink, u, 0, -1);
  slam(ctx, 'OPENING', W / 2, 860 + size * 0.92, size, C.gold, u, 1, 1);
  const p = E.inOutCubic(prog(u, 1.4, 1.9));
  if (p > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 1150, W * p, 140); ctx.clip();
    text(ctx, 'ప్రారంభోత్సవ ఆహ్వానం', W / 2, 1250, font(64, 600, TE), C.ink, 'center');
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 2-3 the building (2..8)
function sBuilding(ctx, u, IMG) {
  fill(ctx, C.paper);
  // card geometry: whips in from the right, then grows to full bleed by beat 5
  const g = E.inOutCubic(prog(u, 4, 5));
  const cw = lerp(860, W, g), ch = lerp(1240, H, g);
  const tilt = (1 - springU(u, 1.8, SPRING.bouncy)) * 0.12;
  const x = (W - cw) / 2 + (1 - whip(u, 2)) * W, y = lerp(300, 0, g);
  // the push into the sign, in log space
  const z = Math.exp(lerp(Math.log(1.0), Math.log(1.9), E.inOutSine(prog(u, 2, 8))));
  const fy = lerp(0.45, 0.6, prog(u, 2, 8));
  ctx.save();
  ctx.translate(x + cw / 2, y + ch / 2); ctx.rotate(tilt); ctx.translate(-cw / 2, -ch / 2);
  cover(ctx, IMG.building, 0, 0, cw, ch, { fx: 0.5, fy, zoom: z, radius: lerp(36, 0, g) });
  ctx.restore();
  // the date stamps over the photo on its beats
  if (u >= 4.5) {
    ctx.fillStyle = `rgba(13,12,11,${0.35 * prog(u, 4.5, 5.2)})`; ctx.fillRect(0, 0, W, H);
    [['SAVE', 5], ['THE', 6], ['DATE', 7]].forEach(([w, b], i) => {
      if (u < b - 0.1) return;
      const k = springU(u, b - 0.12, SPRING.snappy);
      const sz = 220;
      ctx.save(); ctx.translate(W / 2, 720 + i * 255); ctx.scale(lerp(1.6, 1, k), lerp(1.6, 1, k));
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30;
      text(ctx, w, 0, 0, font(sz, 900, UI), i === 2 ? C.goldHi : C.paper, 'center', -6);
      ctx.restore();
    });
  } else {
    pill(ctx, "YOU'RE INVITED", W / 2, 1640, u, 3);
  }
  // the whip carries GRAND OPENING out to the left
  const a = whip(u, 2);
  if (a < 1) { ctx.save(); ctx.translate(-a * W, 0); sGrand(ctx, u); ctx.restore(); }
}

// ---------------------------------------------------------------- 4 the date (8..14), a cut a beat
function sDate(ctx, u) {
  if (u < 10) {
    fill(ctx, C.paper);
    shake(ctx, u, 8, 22);
    const k = springU(u, 7.55, SPRING.snappy), q = 0.12 * wobble(u - 7.95, 2.4, 5);
    ctx.save(); ctx.translate(W / 2, 1060); ctx.scale(1 - q, 1 + q);
    glyph(ctx, '06', 0, -(1 - k) * 900, font(720, 900, UI), C.ink);
    ctx.restore();
    rise(ctx, 'NOVEMBER 2026', W / 2, 1230, font(92, 800, UI), C.gold, u, 8.6, 'center', 10);
  } else if (u < 11) {
    fill(ctx, C.ink);
    slam(ctx, 'FRIDAY', W / 2, 1060, fitSize(ctx, 'FRIDAY', 900, UI, 960, 330, -0.03), C.paper, u, 10, 1);
  } else if (u < 12) {
    fill(ctx, C.paper);
    const sz = fitSize(ctx, '10:32', 900, UI, 960, 380, -0.03);
    slam(ctx, '10:32', W / 2, 1040, sz, C.ink, u, 11, -1);
    rise(ctx, 'AM', W / 2, 1200, font(120, 800, UI), C.gold, u, 11.2, 'center', 12);
  } else {
    fill(ctx, C.paper);
    const sz = fitSize(ctx, '10:32', 900, UI, 960, 380, -0.03);
    text(ctx, '10:32', W / 2, 1040, font(sz, 900, UI), C.ink, 'center', -0.03 * sz);
    text(ctx, 'AM', W / 2, 1200, font(120, 800, UI), C.gold, 'center', 12);
    // a gold band sweeps across with the Telugu line on it
    const p = E.outExpo(prog(u, 12, 12.6));
    ctx.fillStyle = C.gold; ctx.fillRect(0, 1320, W * p, 150);
    if (p > 0.5) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 1320, W * p, 150); ctx.clip();
      text(ctx, 'శుక్రవారం · ఉదయం 10:32 గంటలకు', W / 2, 1418, font(56, 600, TE), C.paper, 'center');
      ctx.restore();
    }
    rise(ctx, '6 NOV · FRI', W / 2, 760, font(86, 800, UI), C.ink, u, 12.5, 'center', 8);
  }
}

// ---------------------------------------------------------------- 5 venue (14..18)
function pinShape(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-14, -22, -34, -40, -34, -62); ctx.arc(0, -62, 34, Math.PI, 0); ctx.bezierCurveTo(34, -40, 14, -22, 0, 0);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(0, -62, 13, 0, M.TAU); ctx.fillStyle = C.paper; ctx.fill();
  ctx.restore();
}
function sVenue(ctx, u, IMG) {
  fill(ctx, C.paper);
  // whip up out of the date
  const a = whip(u, 14, 0.4);
  if (a < 1) { ctx.save(); ctx.translate(0, -a * H); sDate(ctx, Math.min(u, 13.99)); ctx.restore(); }
  ctx.save(); ctx.translate(0, (1 - a) * H);
  const up = E.inOutCubic(prog(u, 15.5, 16.1)) * 330;   // the words make room for the card
  ctx.translate(0, -up);
  const k = springU(u, 13.8, SPRING.bouncy), q = 0.15 * wobble(u - 14.05, 2.6, 6);
  ctx.save(); ctx.translate(W / 2, 640); ctx.scale(1 - q, 1 + q); pinShape(ctx, 0, -(1 - k) * 300, 2.2, C.gold); ctx.restore();
  text(ctx, 'ELURU', W / 2, 900, font(fitSize(ctx, 'ELURU', 900, UI, 900, 300), 900, UI), C.ink, 'center', -6);
  rise(ctx, 'RAMA MAHAL', W / 2, 1010, font(96, 800, UI), C.gold, u, 15, 'center', 6);
  ctx.restore();
  // the entrance, in a card, with the address under it
  if (u >= 15.9) {
    const c = springU(u, 16.0, SPRING.snappy);
    const y = lerp(H, 760, c);
    ctx.save(); ctx.translate(0, y);
    cover(ctx, IMG.building, 90, 0, 900, 560, { fx: 0.55, fy: 0.78, zoom: 1.5, radius: 32 });
    ctx.restore();
    rise(ctx, 'Door No. 3-12, Kasturi Vari Street, R.R. Peta', W / 2, 1420, font(44, 500, UI), C.ink, u, 16.6);
    rise(ctx, 'Opp. Happy Mobiles · Near Lakshmi Ganapathi Temple', W / 2, 1480, font(40, 500, UI), C.grey, u, 17);
  }
}

// ---------------------------------------------------------------- 6-7 invited by (18..28)
function portrait(ctx, im, cx, cy, r, ring = C.gold) {
  ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, M.TAU); ctx.fillStyle = ring; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, M.TAU); ctx.fillStyle = C.paper; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, M.TAU); ctx.clip();
  if (im) ctx.drawImage(im, cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
}
function hostCard(ctx, u, i, IMG) {
  const [id, n1, n2, deg, role] = HOSTS[i];
  const u0 = 18 + i * 2;
  portrait(ctx, IMG[id], W / 2, 830, 300);
  const nf = font(fitSize(ctx, n1, 900, UI, 900, 120, -0.02), 900, UI);
  const nf2 = font(fitSize(ctx, n2, 900, UI, 900, 120, -0.02), 900, UI);
  rise(ctx, n1, W / 2, 1300, nf, C.ink, u, u0 + 0.1, 'center', -2);
  rise(ctx, n2, W / 2, 1300 + sizeOf(nf2) * 0.98, nf2, C.ink, u, u0 + 0.25, 'center', -2);
  const ry = 1300 + sizeOf(nf2) * 0.98 + 80;
  rise(ctx, deg, W / 2, ry, font(52, 800, UI), C.gold, u, u0 + 0.4, 'center', 6);
  rise(ctx, role, W / 2, ry + 62, font(fitSize(ctx, role, 500, UI, 940, 40), 500, UI), C.grey, u, u0 + 0.55);
}
function sHosts(ctx, u, IMG) {
  fill(ctx, C.paper);
  // VENUE leaves left as host 1 arrives from the right; then each host whips in from alternating sides
  const i = clamp(Math.floor((u - 18) / 2), 0, 3);
  const a = whip(u, 18 + i * 2, 0.45), dir = i % 2 ? -1 : 1;
  if (a < 1) {
    ctx.save(); ctx.translate(-dir * a * W, 0);
    if (i === 0) sVenue(ctx, Math.min(u, 17.99), IMG); else { fill(ctx, C.paper); hostCard(ctx, 99, i - 1, IMG); }
    ctx.restore();
  }
  ctx.save(); ctx.translate(dir * (1 - a) * W, 0); hostCard(ctx, u, i, IMG); ctx.restore();
  text(ctx, 'INVITED BY', W / 2, 400, font(50, 800, UI), C.gold, 'center', 14);
}
const GRID = [[290, 700], [790, 700], [290, 1220], [790, 1220]];
function sGrid(ctx, u, IMG) {
  fill(ctx, C.paper);
  text(ctx, 'INVITED BY', W / 2, 400, font(50, 800, UI), C.gold, 'center', 14);
  HOSTS.forEach(([id, n1, n2, deg], j) => {
    const k = springU(u, 25.55 + j * 0.1, SPRING.bouncy);
    if (k <= 0) return;
    const [cx, cy] = GRID[j];
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
    portrait(ctx, IMG[id], cx, cy, 170);
    const nm = (n1 + ' ' + n2).replace('DR. ', 'Dr. ');
    text(ctx, nm.split(' ').map((w) => (w === 'Dr.' ? w : w[0] + w.slice(1).toLowerCase())).join(' '), cx, cy + 250,
      font(fitSize(ctx, nm, 800, UI, 460, 46), 800, UI), C.ink, 'center');
    text(ctx, deg, cx, cy + 302, font(36, 600, UI), C.gold, 'center', 4);
    ctx.restore();
  });
}

// ---------------------------------------------------------------- 8 end card (28..32)
function sEnd(ctx, u, IMG) {
  fill(ctx, C.ink);
  shake(ctx, u, 28, 14);
  const k = springU(u, 27.85, SPRING.bouncy);
  if (k > 0 && IMG.logo) {
    const w = 840, h = w * IMG.logo.height / IMG.logo.width;
    ctx.save(); ctx.translate(W / 2, 620); ctx.scale(k, k); ctx.drawImage(IMG.logo, -w / 2, -h / 2, w, h); ctx.restore();
  }
  rise(ctx, 'GRAND OPENING', W / 2, 960, font(96, 900, UI), C.paper, u, 28.3, 'center', 2);
  rise(ctx, 'FRI · 6 NOV 2026 · 10:32 AM', W / 2, 1050, font(52, 600, UI), C.goldHi, u, 28.6, 'center', 4);
  rise(ctx, 'Rama Mahal, R.R. Peta, Eluru', W / 2, 1125, font(44, 500, UI), '#cfc6b8', u, 28.8);
  // phone in a gold pill
  const p = springU(u, 28.85, SPRING.bouncy);
  if (p > 0) {
    ctx.save(); ctx.translate(W / 2, 1300); ctx.scale(p, p);
    rrect(ctx, -455, -72, 910, 144, 72); ctx.fillStyle = C.goldHi; ctx.fill();
    text(ctx, '+91 99591 34666', 0, 26, font(fitSize(ctx, '+91 99591 34666', 800, UI, 780, 76), 800, UI), C.ink, 'center');
    ctx.restore();
  }
  rise(ctx, 'www.dermaluxe.ai', W / 2, 1450, font(48, 500, UI), C.paper, u, 29.4, 'center', 3);
}

M.film({
  fonts: [font(100, 900, UI), font(100, 800, UI), font(40, 500, UI), font(40, 600, UI), font(40, 600, TE)],
  images: {
    building: 'assets/building.jpg', logo: 'assets/logo.png',
    nagaraju: 'assets/nagaraju.jpg', meghana: 'assets/meghana.jpg', nikhitha: 'assets/nikhitha.jpg', saidivija: 'assets/saidivija.jpg',
  },
  hits: HITS,
  draw(ctx, u, t, IMG) {
    if (u < 2.25) sGrand(ctx, u);
    else if (u < 8) sBuilding(ctx, u, IMG);
    else if (u < 13.8) sDate(ctx, u);
    else if (u < 17.78) sVenue(ctx, u, IMG);
    else if (u < 25.6) sHosts(ctx, u, IMG);
    else if (u < 27.85) sGrid(ctx, u, IMG);
    else sEnd(ctx, u, IMG);
  },
});
