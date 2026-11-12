// Dr. Meghana Valeti introduces DermaLuxe: pure function of time. window.seek(t) paints frame t.
// Real photographs only, nothing generated, so no AI mark is needed: the owner's photo of the
// building, Dr. Meghana at the reception, and the team at the reception. Her name, degree and
// registration number are on screen whenever she is (NMC 3.2 Expl. III/IV).
import * as M from './lib/motion.js';

const { W, H, E, prog, lerp, clamp, kf, springU, SPRING, wobble, font, text, fitSize, cover, rrect } = M;

const C = { ink: '#0d0c0b', gold: '#d9b56c', hi: '#f3dfae', cream: '#f4ece0', muted: '#b9ab95' };
const DISPLAY = 'Display', SERIF = 'Serif', UI = 'UI', TE = 'Te';
const REG = 'Reg. No. APMC/FMR/91692';

const TREATMENTS = ['Acne & acne marks', 'Pigmentation & melasma', 'Hair fall', 'Laser hair reduction', 'Anti-ageing care', 'Hydrafacial', 'Psoriasis & eczema'];

const HITS = [
  [0, 'logo', 'bell', { pitch: 'F5' }],
  [2, 'eluru', 'tick'],
  [4, 'meet', 'pop', { pitch: 'C6' }],
  [7.5, 'to doctor', 'whoosh', { len: 0.5 }],
  [8, 'doctor', 'impact'],
  [9, 'name', 'pop', { pitch: 'F5' }],
  [10, 'degree', 'tick'], [11, 'role', 'tick'], [12, 'reg', 'tick'],
  [16, 'point 1', 'pop', { pitch: 'A5' }],
  [18, 'point 2', 'pop', { pitch: 'C6' }],
  [23.5, 'to team', 'whoosh', { len: 0.5 }],
  [24, 'team', 'thud'],
  [31.5, 'to treatments', 'whoosh', { len: 0.5, from: 2400, to: 600 }],
  [32, 'treatments', 'impact'],
  ...TREATMENTS.map((_, i) => [33 + i, `t${i}`, 'blip', { pitch: ['F5', 'G5', 'A5', 'C6', 'D6', 'F6', 'G6'][i] }]),
  [41.5, 'to opening', 'whoosh', { len: 0.5 }],
  [42, 'opening', 'impact'],
  [45.5, 'to end', 'whoosh', { len: 0.4 }],
  [46, 'end', 'impact'],
  [47.5, 'phone', 'bell', { pitch: 'F6' }],
  [49, 'resolve', 'crash', { len: 2 }],
];

function goldAt(ctx, y, size) {
  const g = ctx.createLinearGradient(0, y - 0.78 * size, 0, y + 0.12 * size);
  g.addColorStop(0, '#f8e9c2'); g.addColorStop(0.45, '#e3c074'); g.addColorStop(1, '#b0843f');
  return g;
}
const shadow = (ctx, b = 24, a = 0.8) => { ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowBlur = b; };
function rise(ctx, str, y, f, color, u, u0, { track = 0, dur = 0.8, x = W / 2, align = 'center' } = {}) {
  const p = E.outQuint(prog(u, u0, u0 + dur));
  if (p <= 0) return;
  const s = parseInt(f.split(' ')[1], 10);
  ctx.save(); ctx.beginPath(); ctx.rect(0, y - s * 1.25, W, s * 1.6); ctx.clip();
  text(ctx, str, x, y + (1 - p) * s * 1.3, f, color, align, track);
  ctx.restore();
}
function grad(ctx, y0, y1, a0, a1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(10,9,8,${a0})`); g.addColorStop(1, `rgba(10,9,8,${a1})`);
  ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
}
const veil = (ctx, a) => { if (a > 0) { ctx.fillStyle = `rgba(10,9,8,${a})`; ctx.fillRect(0, 0, W, H); } };
const rule = (ctx, y, w, u, u0) => { const r = E.outCubic(prog(u, u0, u0 + 0.9)); if (r > 0) { ctx.fillStyle = C.gold; ctx.fillRect(W / 2 - w / 2 * r, y, w * r, 3); } };
function logo(ctx, IMG, cx, cy, w, k = 1) {
  if (!IMG.logo || k <= 0) return;
  const h = w * IMG.logo.height / IMG.logo.width;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); shadow(ctx, 40, 0.8); ctx.drawImage(IMG.logo, -w / 2, -h / 2, w, h); ctx.restore();
}
// the doctor's credit line: name, degree, registration, whenever she is on screen
function credit(ctx, y, u, u0, size = 30) {
  rise(ctx, `Dr. Meghana Valeti · MD (DVL) · ${REG}`, y, font(size, 400, UI), C.muted, u, u0);
}

// ---------------------------------------------------------------- 1 the building (0..8)
// the owner's own photo; the camera stays above the bicycle and the passer-by at the foot of it
function sBuilding(ctx, u, IMG) {
  const [fy, lz] = kf(u, [[0, [0.12, Math.log(1.45)]], [8, [0.41, Math.log(1.62)]]], E.inOutSine);
  cover(ctx, IMG.building, 0, 0, W, H, { fx: 0.5, fy, zoom: Math.exp(lz) });
  grad(ctx, 0, 1000, 0.92, 0); grad(ctx, 1300, 1920, 0, 0.7);
  logo(ctx, IMG, W / 2, 420, 700, springU(u, -0.2, SPRING.bouncy));
  ctx.save(); shadow(ctx);
  rise(ctx, 'ELURU  ·  R.R. PETA', 640, font(40, 500, UI), C.hi, u, 2, { track: 12 });
  rise(ctx, 'Meet our Medical Director', 790, font(78, 500, DISPLAY), goldAt(ctx, 790, 78), u, 4);
  ctx.restore();
}

// ---------------------------------------------------------------- 2-3 Dr. Meghana (8..24)
function sDoctor(ctx, u, IMG) {
  // a slow push to her face, then a little back out for the two statements
  const [fy, lz] = kf(u, [[8, [0.22, Math.log(1.0)]], [15.5, [0.2, Math.log(1.16)]], [17, [0.24, Math.log(1.08)]], [24, [0.24, Math.log(1.14)]]], E.inOutSine);
  cover(ctx, IMG.meghana, 0, 0, W, H, { fx: 0.47, fy, zoom: Math.exp(lz) });
  grad(ctx, 950, 1920, 0, 0.94);
  // the name block leaves to the left as the statements come in
  const out = E.inBack(prog(u, 15.2, 16), 1.2);
  ctx.save(); ctx.translate(-out * W, 0); shadow(ctx);
  rise(ctx, 'Dr. Meghana Valeti', 1200, font(104, 500, DISPLAY), goldAt(ctx, 1200, 104), u, 9);
  rise(ctx, 'MD (DVL)  ·  DERMATOLOGY', 1275, font(40, 500, UI), C.cream, u, 10, { track: 6 });
  rise(ctx, 'Co-Founder & Medical Director', 1340, font(46, 400, UI), C.hi, u, 11);
  rise(ctx, REG, 1405, font(34, 400, UI), C.muted, u, 12, { track: 2 });
  rule(ctx, 1450, 360, u, 12.4);
  ctx.restore();
  if (u >= 15.5) {
    ctx.save(); shadow(ctx);
    const pt = (str, y, u0) => {
      const k = springU(u, u0 - 0.1, SPRING.bouncy);
      if (k > 0) { ctx.save(); ctx.translate(W / 2 - 400, y - 16); ctx.scale(k, k); ctx.rotate(Math.PI / 4); ctx.fillStyle = C.gold; ctx.fillRect(-11, -11, 22, 22); ctx.restore(); }
      rise(ctx, str, y, font(fitSize(ctx, str, 500, UI, 760, 50), 500, UI), C.cream, u, u0, { x: W / 2 - 360, align: 'left' });
    };
    pt('Treatments only by qualified', 1150, 16);
    rise(ctx, 'MD doctors', 1212, font(50, 500, UI), C.hi, u, 16.2, { x: W / 2 - 360, align: 'left' });
    pt('USFDA-approved lasers', 1310, 18);
    rise(ctx, '& machines', 1372, font(50, 500, UI), C.hi, u, 18.2, { x: W / 2 - 360, align: 'left' });
    credit(ctx, 1470, u, 16.5);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 4 the team (24..32)
function sTeam(ctx, u, IMG) {
  cover(ctx, IMG.team, 0, 0, W, H, { fx: 0.5, fy: 0.5, zoom: 1.0 });
  veil(ctx, 0.82);
  ctx.save(); shadow(ctx);
  rise(ctx, 'OUR TEAM', 430, font(38, 500, UI), C.gold, u, 23.8, { track: 14 });
  rise(ctx, 'At your service in Eluru', 530, font(84, 500, DISPLAY), goldAt(ctx, 530, 84), u, 24.2);
  ctx.restore();
  const k = springU(u, 24.1, SPRING.gentle);
  if (k > 0) {
    const w = 980, h = w * IMG.team.height / IMG.team.width, x = (W - w) / 2, y = lerp(H, 640, k);
    // a slow drift across the six of them, in log space
    const z = Math.exp(lerp(Math.log(1.0), Math.log(1.12), prog(u, 24, 32)));
    rrect(ctx, x - 8, y - 8, w + 16, h + 16, 22); ctx.fillStyle = C.gold; ctx.fill();
    cover(ctx, IMG.team, x, y, w, h, { fx: lerp(0.45, 0.55, prog(u, 24, 32)), fy: 0.6, zoom: z, radius: 16 });
  }
  ctx.save(); shadow(ctx);
  rise(ctx, 'Doctors and clinic team at our reception', 1400, font(40, 400, UI), C.cream, u, 25.5);
  rise(ctx, 'మా వైద్యులు, సిబ్బంది', 1475, font(44, 500, TE), C.hi, u, 26);
  ctx.restore();
}

// ---------------------------------------------------------------- 5 treatments (32..42)
function sTreatments(ctx, u, IMG) {
  M.fill(ctx, C.ink);
  const g = ctx.createRadialGradient(W / 2, 700, 60, W / 2, 800, 1000);
  g.addColorStop(0, '#2e2517'); g.addColorStop(1, 'rgba(13,12,11,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); shadow(ctx);
  rise(ctx, 'SKIN  ·  HAIR  ·  NAILS', 390, font(38, 500, UI), C.gold, u, 31.8, { track: 12 });
  rise(ctx, 'What we treat', 490, font(96, 500, DISPLAY), goldAt(ctx, 490, 96), u, 32);
  TREATMENTS.forEach((t, i) => {
    const y = 640 + i * 112, u0 = 33 + i;
    const k = springU(u, u0 - 0.1, SPRING.bouncy);
    if (k > 0) { ctx.save(); ctx.translate(250, y - 17); ctx.scale(k, k); ctx.rotate(Math.PI / 4); ctx.fillStyle = C.gold; ctx.fillRect(-10, -10, 20, 20); ctx.restore(); }
    rise(ctx, t, y, font(56, 500, UI), C.cream, u, u0, { x: 300, align: 'left' });
  });
  rise(ctx, 'A doctor consultation first,', 1450, font(44, 400, UI), C.hi, u, 40);
  rise(ctx, 'then a plan for your skin', 1510, font(44, 400, UI), C.hi, u, 40.3);
  ctx.restore();
}

// ---------------------------------------------------------------- 6 grand opening (42..46)
function sOpening(ctx, u, IMG) {
  cover(ctx, IMG.building, 0, 0, W, H, { fx: 0.5, fy: 0.41, zoom: Math.exp(lerp(Math.log(1.62), Math.log(1.75), prog(u, 42, 46))) });
  veil(ctx, 0.55); grad(ctx, 300, 1300, 0.2, 0.6);
  ctx.save(); shadow(ctx, 30, 0.9);
  rise(ctx, 'ప్రారంభోత్సవం', 560, font(70, 600, TE), C.hi, u, 41.8);
  const k = springU(u, 41.8, SPRING.bouncy);
  if (k > 0) { ctx.save(); ctx.translate(W / 2, 760); ctx.scale(k, k); text(ctx, 'Grand Opening', 0, 0, font(150, 500, DISPLAY), goldAt(ctx, 0, 150), 'center'); ctx.restore(); }
  rise(ctx, 'FRIDAY · 6 NOVEMBER 2026', 900, font(54, 500, UI), C.cream, u, 42.6, { track: 6 });
  rise(ctx, '10:32 AM', 990, font(70, 500, UI), C.hi, u, 43.2, { track: 6 });
  ctx.restore();
}

// ---------------------------------------------------------------- 7 end card (46..52)
function sEnd(ctx, u, IMG) {
  M.fill(ctx, C.ink);
  const g = ctx.createRadialGradient(W / 2, 600, 50, W / 2, 600, 900);
  g.addColorStop(0, '#2e2517'); g.addColorStop(1, 'rgba(13,12,11,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  logo(ctx, IMG, W / 2, 560, 800, springU(u, 45.8, SPRING.bouncy));
  ctx.save(); shadow(ctx);
  rise(ctx, 'Rama Mahal, R.R. Peta, Eluru', 900, font(46, 400, UI), C.cream, u, 46.6);
  const p = springU(u, 47.3, SPRING.bouncy);
  if (p > 0) {
    ctx.save(); ctx.translate(W / 2, 1060); ctx.scale(p, p);
    rrect(ctx, -440, -70, 880, 140, 70); ctx.fillStyle = goldAt(ctx, 30, 120); ctx.fill();
    text(ctx, 'WhatsApp  99591 34666', 0, 24, font(66, 600, UI), C.ink, 'center');
    ctx.restore();
  }
  rise(ctx, 'www.dermaluxe.ai', 1210, font(50, 400, UI), C.hi, u, 48, { track: 3 });
  credit(ctx, 1420, u, 48.5, 32);
  ctx.restore();
}

M.film({
  fonts: [font(100, 500, DISPLAY), font(40, 400, UI), font(40, 500, UI), font(40, 600, UI), font(40, 500, TE), font(40, 600, TE)],
  images: { building: 'assets/building.jpg', meghana: 'assets/meghana.jpg', team: 'assets/team.jpg', logo: 'assets/logo.png' },
  hits: HITS,
  draw(ctx, u, t, IMG) {
    if (u < 8) sBuilding(ctx, u, IMG);
    else if (u < 24) sDoctor(ctx, u, IMG);
    else if (u < 32) sTeam(ctx, u, IMG);
    else if (u < 42) sTreatments(ctx, u, IMG);
    else if (u < 46) sOpening(ctx, u, IMG);
    else sEnd(ctx, u, IMG);
  },
});
