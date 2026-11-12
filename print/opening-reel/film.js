// DermaLuxe Grand Opening: pure function of time. window.seek(t) paints frame t (see lib/motion.js).
// Timing is in beats (u) on the measured grid; docs/shotlist.md is the plan this file follows.
import * as M from './lib/motion.js';

const { W, H, E, prog, lerp, clamp, kf, springU, SPRING, wobble, font, layout, glyph, text, fitSize, cover, bump } = M;

const C = { ink: '#0d0c0b', gold: '#d9b56c', hi: '#f3dfae', cream: '#f4ece0', muted: '#b9ab95' };
const DISPLAY = 'Display', SERIF = 'Serif', UI = 'UI', TE = 'Te';

const HOSTS = [
  ['nagaraju', 'Nagaraju Bandaru', 'MBA', ['Founder & Managing Director']],
  ['meghana', 'Dr. Meghana Valeti', 'MD (DVL)', ['Co-Founder & Medical Director']],
  ['nikhitha', 'Dr. Nikhitha Priyanka', 'MD (DVL)', ['Chief Dermatologist', 'DermaLuxe']],
  ['saidivija', 'Dr. Kamma Sai Divija', 'MD (DVL)', ['Chief Dermatologist', 'Medicare Skin & Hair Clinic']],
];
const HOST_AT = [24, 25.5, 27, 28.5];

const HITS = [
  [0, 'title', 'impact'],
  [2, 'telugu kicker', 'bell', { pitch: 'A5' }],
  [4, 'cordially invited', 'pop', { pitch: 'D6' }],
  [7.5, 'push to sign', 'whoosh', { len: 0.5 }],
  [8, '06 lands', 'impact'],
  [9, 'november', 'pop', { pitch: 'A5' }],
  [10, 'rule', 'tick'],
  [11, 'friday 10:32', 'pop', { pitch: 'D6' }],
  [13, 'telugu date', 'bell', { pitch: 'F#6' }],
  [15.5, 'to entrance', 'whoosh', { len: 0.5, from: 2400, to: 600 }],
  [16, 'pin', 'thud'],
  [17, 'rama mahal', 'tick'],
  [18, 'address 1', 'tick'],
  [19, 'address 2', 'tick'],
  [20, 'eluru', 'bell', { pitch: 'A5' }],
  [23.5, 'curtain', 'whoosh', { len: 0.6, from: 600, to: 2400 }],
  [24, 'invited by', 'tick'],
  ...HOST_AT.map((b, i) => [b, `host ${i + 1}`, 'pop', { pitch: ['D6', 'E6', 'F#6', 'A6'][i] }]),
  [35.5, 'to end', 'whoosh', { len: 0.5 }],
  [36, 'logo', 'impact'],
  [38, 'phone', 'bell', { pitch: 'D6' }],
  [40, 'resolve', 'crash', { len: 2 }],
];

// gold ink, top-lit like the sign: built in the glyph's own coordinates (baseline at 0)
function gold(ctx, size, y0 = -0.78, y1 = 0.12) {
  const g = ctx.createLinearGradient(0, y0 * size, 0, y1 * size);
  g.addColorStop(0, '#f8e9c2'); g.addColorStop(0.45, '#e3c074'); g.addColorStop(1, '#b0843f');
  return g;
}
function goldAt(ctx, y, size) {
  const g = ctx.createLinearGradient(0, y - 0.78 * size, 0, y + 0.12 * size);
  g.addColorStop(0, '#f8e9c2'); g.addColorStop(0.45, '#e3c074'); g.addColorStop(1, '#b0843f');
  return g;
}
const shadow = (ctx, b = 24, a = 0.75) => { ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowBlur = b; };
const noShadow = (ctx) => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; };

// a centred line that rises into place from under a mask line (direction + weight, not a fade)
function rise(ctx, str, y, f, color, u, u0, { track = 0, dur = 0.9, align = 'center' } = {}) {
  const p = E.outQuint(prog(u, u0, u0 + dur));
  if (p <= 0) return;
  const size = parseInt(f.split(' ')[1], 10);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y - size * 1.25, W, size * 1.6); ctx.clip();
  text(ctx, str, align === 'center' ? W / 2 : 0, y + (1 - p) * size * 1.3, f, color, align, track);
  ctx.restore();
}
// Telugu is shaped as a whole string (conjuncts), so it reveals with a left-to-right wipe
function wipe(ctx, str, y, f, color, u, u0, dur = 1.2) {
  const p = E.inOutCubic(prog(u, u0, u0 + dur));
  if (p <= 0) return;
  ctx.font = f;
  const w = ctx.measureText(str).width, x0 = (W - w) / 2 - 20;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y - 140, (w + 40) * p, 220); ctx.clip();
  text(ctx, str, W / 2, y, f, color, 'center');
  ctx.restore();
}

// ---------------------------------------------------------------- the camera on the building
// [fx, fy, log zoom]; zoom runs in log space so pushes read as a steady dolly
const CAM = [
  [0, [0.5, 0.0, Math.log(1.34)]],
  [7.2, [0.5, 0.42, Math.log(1.1)]],
  [8.6, [0.48, 0.36, Math.log(1.7)]],
  [15.3, [0.48, 0.4, Math.log(1.86)]],
  [16.6, [0.56, 1.0, Math.log(1.62)]],
  [23.4, [0.56, 1.0, Math.log(1.72)]],
  [24.6, [0.5, 0.6, Math.log(1.06)]],
  [35.4, [0.5, 0.56, Math.log(1.14)]],
  [36.6, [0.5, 0.5, Math.log(1.0)]],
  [44, [0.5, 0.5, Math.log(1.07)]],
];
function photo(ctx, u, IMG) {
  const [fx, fy, lz] = kf(u, CAM, E.inOutSine);
  cover(ctx, IMG.building, 0, 0, W, H, { fx, fy, zoom: Math.exp(lz) });
}
function grad(ctx, y0, y1, a0, a1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(10,9,8,${a0})`); g.addColorStop(1, `rgba(10,9,8,${a1})`);
  ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
}
function veil(ctx, a) { if (a > 0) { ctx.fillStyle = `rgba(10,9,8,${a})`; ctx.fillRect(0, 0, W, H); } }

// ---------------------------------------------------------------- S1 hook   (u 0..8)
function sceneTitle(ctx, u) {
  const lift = E.inBack(prog(u, 6.9, 7.9), 1.3) * 900;
  // dark sky band for the words, it leaves with them
  grad(ctx, 0, 1050, 0.9, 0);
  ctx.save(); ctx.translate(0, -lift);
  wipe(ctx, 'ప్రారంభోత్సవ ఆహ్వానం', 430, font(54, 500, TE), C.hi, u, 1.6);
  const size = 178, f = font(size, 500, DISPLAY);
  const L = layout(ctx, 'Grand Opening', f, -2);
  const x0 = (W - L.width) / 2, base = 640;
  shadow(ctx, 30, 0.6);
  L.glyphs.forEach((g, j) => {
    if (g.ch === ' ') return;
    const k = springU(u, -0.75 + j * 0.11, SPRING.bouncy);
    if (k <= 0) return;
    glyph(ctx, g.ch, x0 + g.cx, base + (1 - k) * 120, f, gold(ctx, size), 1, clamp(k, 0, 1.2));
  });
  noShadow(ctx);
  rise(ctx, 'You are cordially invited', 745, font(60, 500, DISPLAY), C.cream, u, 4);
  // a short gold rule grows under the invitation line
  const r = E.outCubic(prog(u, 4.5, 5.5));
  if (r > 0) { ctx.fillStyle = C.gold; ctx.fillRect(W / 2 - 160 * r, 800, 320 * r, 3); }
  ctx.restore();
}

// ---------------------------------------------------------------- S2 the date   (u 8..16)
function sceneDate(ctx, u) {
  veil(ctx, 0.3 * E.outCubic(prog(u, 7.6, 8.6)));
  grad(ctx, 0, 1150, 0.75, 0.35);
  grad(ctx, 1150, 1400, 0.35, 0);
  const out = E.inBack(prog(u, 15.1, 16), 1.3) * 1300;
  ctx.save(); ctx.translate(0, -out);
  // "06": drops onto its baseline and squashes
  const k = springU(u, 7.6, SPRING.snappy);
  if (k > 0) {
    const size = 420, f = font(size, 300, UI), base = 700;
    const q = 0.1 * wobble(u - 8.1, 2.4, 5);
    ctx.save(); ctx.translate(W / 2, base); ctx.scale(1 + q, 1 - q);
    shadow(ctx, 40, 0.7);
    glyph(ctx, '06', 0, -(1 - k) * 900, f, gold(ctx, size, -0.72, 0.02));
    noShadow(ctx);
    ctx.restore();
  }
  // NOVEMBER 2026: tracking opens out
  const tp = E.outExpo(prog(u, 9, 10.2));
  if (tp > 0) {
    const f = font(64, 500, UI);
    ctx.save(); shadow(ctx, 18, 0.7); ctx.globalAlpha = clamp(tp * 3);
    text(ctx, 'NOVEMBER 2026', W / 2, 805, f, C.cream, 'center', lerp(0, 22, tp));
    ctx.restore();
  }
  const r = E.outCubic(prog(u, 10, 11));
  if (r > 0) { ctx.fillStyle = C.gold; ctx.fillRect(W / 2 - 330 * r, 855, 660 * r, 3); }
  ctx.save(); shadow(ctx, 18, 0.7);
  rise(ctx, 'FRIDAY  ·  10:32 AM', 945, font(56, 500, UI), C.hi, u, 11, { track: 10 });
  wipe(ctx, 'శుక్రవారం, 6 నవంబర్ 2026 · ఉదయం 10:32', 1040, font(44, 500, TE), C.cream, u, 13);
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- S3 venue   (u 16..24)
function pin(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-14, -22, -34, -40, -34, -62);
  ctx.arc(0, -62, 34, Math.PI, 0);
  ctx.bezierCurveTo(34, -40, 14, -22, 0, 0);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(0, -62, 13, 0, M.TAU); ctx.fillStyle = C.ink; ctx.fill();
  ctx.restore();
}
function sceneVenue(ctx, u) {
  grad(ctx, 760, 1920, 0, 0.94);
  veil(ctx, 0.15);
  // pin drops on its beat and bounces
  const k = springU(u, 15.8, SPRING.bouncy);
  if (k > 0) {
    const q = 0.12 * wobble(u - 16.1, 2.6, 6);
    ctx.save(); ctx.translate(W / 2, 1035); ctx.scale(1 - q, 1 + q);
    pin(ctx, 0, -(1 - k) * 500, 1, goldAt(ctx, -100, 100));
    ctx.restore();
  }
  ctx.save(); shadow(ctx, 20, 0.8);
  rise(ctx, 'VENUE', 1095, font(30, 500, UI), C.gold, u, 16.5, { track: 12 });
  rise(ctx, 'Rama Mahal', 1205, font(104, 500, DISPLAY), goldAt(ctx, 1205, 104), u, 17);
  rise(ctx, 'Door No. 3-12, Ground Floor,', 1285, font(44, 400, UI), C.cream, u, 18);
  rise(ctx, 'Kasturi Vari Street, R.R. Peta', 1342, font(44, 400, UI), C.cream, u, 18.3);
  rise(ctx, 'Opp. Happy Mobiles', 1412, font(44, 400, UI), C.cream, u, 19);
  rise(ctx, 'Near Lakshmi Ganapathi Temple', 1469, font(44, 400, UI), C.cream, u, 19.3);
  rise(ctx, 'ELURU  534002', 1550, font(46, 500, UI), C.hi, u, 20, { track: 10 });
  ctx.restore();
}

// ---------------------------------------------------------------- S4 invited by   (u 24..36)
const CELL = [[290, 600], [790, 600], [290, 1150], [790, 1150]];
function host(ctx, u, i, IMG) {
  const [id, name, deg, role] = HOSTS[i], [cx, cy] = CELL[i], u0 = HOST_AT[i];
  const k = springU(u, u0 - 0.1, SPRING.bouncy);
  if (k <= 0) return;
  const R = 148;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(k, k);
  ctx.beginPath(); ctx.arc(0, 0, R + 10, 0, M.TAU);
  ctx.fillStyle = goldAt(ctx, R, 2 * R); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, R + 4, 0, M.TAU); ctx.fillStyle = C.ink; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R - 4, 0, M.TAU); ctx.clip();
  const im = IMG[id];
  if (im) ctx.drawImage(im, -R + 4, -R + 4, 2 * R - 8, 2 * R - 8);
  ctx.restore();
  ctx.restore();
  // words rise under the ring a beat behind it
  const ny = cy + R + 82;
  ctx.save();
  const nf = font(fitSize(ctx, name, 600, SERIF, 440, 58), 600, SERIF);
  const lineAt = (str, y, f, col, d, tr = 0) => {
    const p = E.outQuint(prog(u, u0 + d, u0 + d + 0.9));
    if (p <= 0) return;
    const s = parseInt(f.split(' ')[1], 10);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - 250, y - s * 1.2, 500, s * 1.55); ctx.clip();
    text(ctx, str, cx, y + (1 - p) * s * 1.3, f, col, 'center', tr);
    ctx.restore();
  };
  lineAt(name, ny, nf, C.hi, 0.35);
  lineAt(deg, ny + 52, font(35, 500, UI), C.cream, 0.55, 4);
  role.forEach((r, j) => lineAt(r, ny + 98 + j * 42, font(fitSize(ctx, r, 400, UI, 480, 33), 400, UI), C.cream, 0.7 + j * 0.1));
  ctx.restore();
}
function sceneHosts(ctx, u, IMG) {
  // the curtain that rose at the end of the venue shot is the ground here
  veil(ctx, 0.86);
  const gone = E.inBack(prog(u, 35.1, 36.1), 1.2);
  ctx.save();
  M.zoomAbout(ctx, 1 - 0.25 * gone, W / 2, 880); ctx.translate(0, -gone * 1400);
  rise(ctx, 'INVITED BY', 330, font(36, 500, UI), C.gold, u, 23.6, { track: 14 });
  const r = E.outCubic(prog(u, 23.8, 24.8));
  if (r > 0) { ctx.fillStyle = C.gold; ctx.fillRect(W / 2 - 90 * r, 370, 180 * r, 3); }
  for (let i = 0; i < 4; i++) host(ctx, u, i, IMG);
  ctx.restore();
}
function curtain(ctx, u) {
  // venue -> hosts: an ink panel rises from the bottom with a gold leading edge
  const p = E.inOutCubic(prog(u, 23.2, 24.4));
  if (p <= 0 || p >= 1) return;
  const y = H * (1 - p);
  ctx.fillStyle = 'rgba(13,12,11,0.86)'; ctx.fillRect(0, y, W, H - y);
  ctx.fillStyle = C.gold; ctx.fillRect(0, y - 3, W, 3);
}

// ---------------------------------------------------------------- S5 end card   (u 36..44)
function sceneEnd(ctx, u, IMG) {
  veil(ctx, 0.5);
  grad(ctx, 0, 700, 0.7, 0);
  grad(ctx, 820, 1080, 0, 0.93);
  ctx.fillStyle = 'rgba(10,9,8,0.93)'; ctx.fillRect(0, 1079, W, H - 1079);
  const k = springU(u, 35.9, SPRING.bouncy);
  if (k > 0 && IMG.logo) {
    const w = 780, h = w * IMG.logo.height / IMG.logo.width;
    ctx.save(); ctx.translate(W / 2, 520); ctx.scale(k, k);
    shadow(ctx, 50, 0.8);
    ctx.drawImage(IMG.logo, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.save(); shadow(ctx, 20, 0.85);
  rise(ctx, 'Grand Opening', 1170, font(112, 500, DISPLAY), goldAt(ctx, 1170, 112), u, 36.6);
  rise(ctx, 'FRIDAY · 6 NOVEMBER 2026 · 10:32 AM', 1255, font(38, 500, UI), C.cream, u, 37, { track: 5 });
  rise(ctx, '+91 99591 34666', 1395, font(78, 500, UI), goldAt(ctx, 1395, 78), u, 38, { track: 2 });
  rise(ctx, 'www.dermaluxe.ai', 1470, font(44, 400, UI), C.cream, u, 38.5, { track: 4 });
  ctx.restore();
  // one slow light sweep across the logo on the resolve, masked to the logo's own pixels
  const s = prog(u, 40, 42.5);
  if (s > 0 && s < 1 && IMG.logo && k > 0) {
    const w = 780, h = w * IMG.logo.height / IMG.logo.width;
    const c = SWEEP.getContext('2d');
    SWEEP.width = w; SWEEP.height = Math.ceil(h);
    c.drawImage(IMG.logo, 0, 0, w, h);
    c.globalCompositeOperation = 'source-atop';
    const x = lerp(-200, w + 200, E.inOutSine(s));
    const g = c.createLinearGradient(x - 120, 0, x + 120, 0);
    g.addColorStop(0, 'rgba(255,245,215,0)'); g.addColorStop(0.5, 'rgba(255,245,215,0.75)'); g.addColorStop(1, 'rgba(255,245,215,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
    ctx.drawImage(SWEEP, W / 2 - w / 2, 520 - h / 2); ctx.restore();
  }
}
const SWEEP = document.createElement('canvas');

function vignette(ctx) {
  const g = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.5, H * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

M.film({
  fonts: [font(100, 500, DISPLAY), font(60, 600, SERIF), font(40, 400, UI), font(40, 500, UI), font(100, 300, UI), font(40, 500, TE)],
  images: {
    building: 'assets/building.jpg', logo: 'assets/logo.png',
    nagaraju: 'assets/nagaraju.jpg', meghana: 'assets/meghana.jpg', nikhitha: 'assets/nikhitha.jpg', saidivija: 'assets/saidivija.jpg',
  },
  hits: HITS,
  draw(ctx, u, t, IMG) {
    photo(ctx, u, IMG);
    vignette(ctx);
    if (u < 8) sceneTitle(ctx, u);
    else if (u < 16) sceneDate(ctx, u);
    else if (u < 24) sceneVenue(ctx, u);
    else if (u < 36) sceneHosts(ctx, u, IMG);
    else sceneEnd(ctx, u, IMG);
    // overlaps across the cuts: the outgoing block keeps moving while the next one lands
    if (u >= 23 && u < 24) curtain(ctx, u);
  },
});
