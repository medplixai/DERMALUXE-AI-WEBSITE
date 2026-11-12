// Grand opening invitation built on the owner's own walk-through of the clinic (IMG_7555).
// Pure function of time: window.seek(t) paints frame t. Every picture is a real photograph:
// stills taken from the owner's clip, the four hosts' own portraits, the team at the reception.
// Nothing generated, so no AI mark. Doctors' photos are in it, so it is sent, never boosted (NMC 9.2).
import * as M from './lib/motion.js';

const { W, H, E, prog, lerp, kf, springU, SPRING, font, text, fitSize, cover, rrect } = M;

const C = { ink: '#0d0c0b', gold: '#d9b56c', hi: '#f3dfae', cream: '#f4ece0', muted: '#b9ab95' };
const DISPLAY = 'Display', SERIF = 'Upright', UI = 'UI', TE = 'Te';

// the walk-through: one still per room, two beats each
const TOUR = [
  ['wait', 'Waiting area', 0.5, 0.55],
  ['cons', 'Consultation room', 0.5, 0.5],
  ['scan', 'Skin analysis', 0.5, 0.45],
  ['machines', 'Treatment room', 0.4, 0.5],
  ['beds', 'Procedure room', 0.5, 0.5],
  ['hair', 'Hair care', 0.5, 0.5],
  ['lounge', 'Lounge', 0.5, 0.5],
  ['sofa', 'Premium skin & hair clinic', 0.5, 0.5],
];
const T0 = 12, TB = 2;   // tour starts at beat 12, two beats a room

const HOSTS = [
  ['nagaraju', 'Nagaraju Bandaru', 'MBA', 'Founder & Managing Director', 0.42],
  ['meghana', 'Dr. Meghana Valeti', 'MD (DVL)', 'Co-Founder & Medical Director', 0.3],
  ['nikhitha', 'Dr. Nikhitha Priyanka', 'MD (DVL)', 'Chief Dermatologist, DermaLuxe', 0.3],
  ['saidivija', 'Dr. Kamma Sai Divija', 'MD (DVL)', 'Chief Dermatologist,|Medicare Skin & Hair Clinic', 0.3],
];
const H0 = 30, HB = 4;   // hosts start at beat 30, four beats each

const HITS = [
  [0, 'logo', 'bell', { pitch: 'F5' }],
  [2, 'telugu', 'tick'],
  [3, 'grand opening', 'impact'],
  [7.6, 'to reception', 'whoosh', { len: 0.4 }],
  [8, 'reception', 'thud'],
  [9, 'step inside', 'pop', { pitch: 'C6' }],
  ...TOUR.map((_, i) => [T0 + i * TB, `room ${i}`, i ? 'whoosh' : 'impact', i ? { len: 0.35 } : {}]),
  [28, 'hosted by', 'impact'],
  ...HOSTS.map((_, i) => [H0 + i * HB, `host ${i}`, 'pop', { pitch: ['F5', 'A5', 'C6', 'F6'][i] }]),
  [46, 'all hosts', 'impact'],
  [49.6, 'to team', 'whoosh', { len: 0.4 }],
  [50, 'team', 'thud'],
  [55.6, 'to date', 'whoosh', { len: 0.4 }],
  [56, 'date', 'impact'],
  [57, 'time', 'tick'], [58.5, 'venue', 'tick'],
  [61.6, 'to end', 'whoosh', { len: 0.4 }],
  [62, 'end', 'impact'],
  [63.5, 'phone', 'bell', { pitch: 'F6' }],
  [65, 'resolve', 'crash', { len: 2 }],
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
function inkGround(ctx, cy = 700) {
  M.fill(ctx, C.ink);
  const g = ctx.createRadialGradient(W / 2, cy, 60, W / 2, cy, 1000);
  g.addColorStop(0, '#33281a'); g.addColorStop(1, 'rgba(13,12,11,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function logo(ctx, IMG, cx, cy, w, k = 1) {
  if (!IMG.logo || k <= 0) return;
  const h = w * IMG.logo.height / IMG.logo.width;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); shadow(ctx, 40, 0.8); ctx.drawImage(IMG.logo, -w / 2, -h / 2, w, h); ctx.restore();
}
function diamond(ctx, x, y, k, s = 11) {
  if (k <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.rotate(Math.PI / 4); ctx.fillStyle = C.gold; ctx.fillRect(-s, -s, 2 * s, 2 * s); ctx.restore();
}
// a portrait in a gold ring
function medallion(ctx, img, cx, cy, r, fy, zoom = 1.12) {
  ctx.save(); shadow(ctx, 50, 0.7);
  ctx.beginPath(); ctx.arc(cx, cy, r + 12, 0, M.TAU); ctx.fillStyle = goldAt(ctx, cy + r, 2 * r); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, M.TAU); ctx.clip();
  cover(ctx, img, cx - r, cy - r, 2 * r, 2 * r, { fx: 0.5, fy, zoom });
  ctx.restore();
}

// ---------------------------------------------------------------- 1 the building (0..8)
function sOpen(ctx, u, IMG) {
  const lz = lerp(Math.log(1.0), Math.log(1.14), prog(u, 0, 8));
  cover(ctx, IMG.c_b, 0, 0, W, H, { fx: 0.5, fy: lerp(0.3, 0.42, prog(u, 0, 8)), zoom: Math.exp(lz) });
  grad(ctx, 0, 640, 0.9, 0); grad(ctx, 1150, 1500, 0, 0.88); grad(ctx, 1500, 1920, 0.88, 0.97);
  logo(ctx, IMG, W / 2, 330, 640, springU(u, -0.2, SPRING.bouncy));
  ctx.save(); shadow(ctx, 30, 0.9);
  rise(ctx, 'ప్రారంభోత్సవం', 1500, font(76, 600, TE), C.hi, u, 2);
  const k = springU(u, 2.9, SPRING.bouncy);
  if (k > 0) { ctx.save(); ctx.translate(W / 2, 1670); ctx.scale(k, k); text(ctx, 'Grand Opening', 0, 0, font(156, 500, DISPLAY), goldAt(ctx, 0, 156), 'center'); ctx.restore(); }
  rule(ctx, 1725, 420, u, 4);
  rise(ctx, 'ELURU  ·  R.R. PETA', 1810, font(42, 500, UI), C.cream, u, 4.4, { track: 12 });
  ctx.restore();
}

// ---------------------------------------------------------------- 2 the reception (8..12)
function sReception(ctx, u, IMG) {
  const lz = lerp(Math.log(1.06), Math.log(1.18), prog(u, 8, 12.5));
  cover(ctx, IMG.c_rec, 0, 0, W, H, { fx: 0.5, fy: 0.35, zoom: Math.exp(lz) });
  grad(ctx, 900, 1920, 0, 0.9);
  ctx.save(); shadow(ctx, 30, 0.9);
  rise(ctx, 'YOU ARE INVITED', 1380, font(42, 500, UI), C.hi, u, 8.4, { track: 14 });
  rise(ctx, 'Step inside', 1530, font(150, 500, DISPLAY), goldAt(ctx, 1530, 150), u, 9);
  rise(ctx, 'our new clinic', 1620, font(56, 400, UI), C.cream, u, 9.6);
  ctx.restore();
}

// ---------------------------------------------------------------- 3 the walk-through (12..28)
// each room pushes in slowly; the next one pans in from the right in the last third of a beat,
// both on screen, landing on the beat
function room(ctx, u, IMG, i, dx) {
  const [k, , fx, fy] = TOUR[i], a = T0 + i * TB;
  const z = Math.exp(lerp(Math.log(1.04), Math.log(1.14), prog(u, a - 0.4, a + TB)));
  ctx.save(); ctx.translate(dx, 0);
  cover(ctx, IMG[`c_${k}`], 0, 0, W, H, { fx, fy, zoom: z });
  grad(ctx, 1250, 1920, 0, 0.85);
  ctx.restore();
}
function sTour(ctx, u, IMG) {
  const i = Math.min(TOUR.length - 1, Math.floor((u - T0) / TB));
  const next = T0 + (i + 1) * TB, w = 0.38;
  const p = i < TOUR.length - 1 ? E.inOutCubic(prog(u, next - w, next)) : 0;
  room(ctx, u, IMG, i, -p * W);
  if (p > 0) room(ctx, u, IMG, i + 1, (1 - p) * W);
  // the room's name, a gold tag that rises on the beat
  const a = T0 + i * TB, label = TOUR[i][1];
  ctx.save(); ctx.translate(-p * W, 0); shadow(ctx, 24, 0.85);
  rise(ctx, `0${i + 1}  ·  INSIDE DERMALUXE`, 1600, font(34, 500, UI), C.gold, u, a + 0.05, { track: 8 });
  rise(ctx, label, 1700, font(fitSize(ctx, label, 500, DISPLAY, 940, 104), 500, DISPLAY), goldAt(ctx, 1700, 104), u, a + 0.15);
  ctx.restore();
}

// ---------------------------------------------------------------- 4 hosted by (28..30)
function sHostedBy(ctx, u, IMG) {
  cover(ctx, IMG.c_logo, 0, 0, W, H, { fx: 0.5, fy: 0.12, zoom: Math.exp(lerp(Math.log(1.3), Math.log(1.38), prog(u, 28, 30))) });
  veil(ctx, 0.62);
  ctx.save(); shadow(ctx, 30, 0.9);
  rise(ctx, 'ఆహ్వానించువారు', 1180, font(64, 600, TE), C.hi, u, 28.1);
  const k = springU(u, 27.95, SPRING.bouncy);
  if (k > 0) { ctx.save(); ctx.translate(W / 2, 1360); ctx.scale(k, k); text(ctx, 'Hosted by', 0, 0, font(160, 500, DISPLAY), goldAt(ctx, 0, 160), 'center'); ctx.restore(); }
  ctx.restore();
}

// ---------------------------------------------------------------- 5 the four hosts (30..46)
function host(ctx, u, IMG, i, dx) {
  const [k, name, deg, role, fy] = HOSTS[i], a = H0 + i * HB;
  ctx.save(); ctx.translate(dx, 0);
  const s = springU(u, a - 0.15, SPRING.gentle);
  const z = Math.exp(lerp(Math.log(1.1), Math.log(1.2), prog(u, a, a + HB)));
  if (s > 0) medallion(ctx, IMG[`h_${k}`], W / 2, 760, 360 * (0.85 + 0.15 * s), fy, z);
  ctx.save(); shadow(ctx, 20, 0.7);
  rise(ctx, name, 1330, font(fitSize(ctx, name, 500, SERIF, 960, 100), 600, SERIF), goldAt(ctx, 1330, 100), u, a + 0.3);
  rise(ctx, deg, 1420, font(46, 500, UI), C.cream, u, a + 0.7, { track: 8 });
  role.split('|').forEach((r, j) => rise(ctx, r, 1510 + j * 62, font(44, 400, UI), C.hi, u, a + 1.0 + j * 0.15));
  rule(ctx, role.includes('|') ? 1620 : 1560, 300, u, a + 1.2);
  ctx.restore();
  ctx.restore();
}
function sHosts(ctx, u, IMG) {
  inkGround(ctx, 760);
  ctx.save(); shadow(ctx, 20, 0.7);
  text(ctx, 'HOSTED BY', W / 2, 250, font(36, 500, UI), C.gold, 'center', 14);
  ctx.restore();
  const i = Math.min(HOSTS.length - 1, Math.floor((u - H0) / HB));
  const next = H0 + (i + 1) * HB, w = 0.4;
  const p = i < HOSTS.length - 1 ? E.inOutCubic(prog(u, next - w, next)) : 0;
  host(ctx, u, IMG, i, -p * W);
  if (p > 0) host(ctx, u, IMG, i + 1, (1 - p) * W);
  // four dots: which host of four
  HOSTS.forEach((_, j) => { ctx.beginPath(); ctx.arc(W / 2 - 66 + j * 44, 1760, j === i ? 9 : 6, 0, M.TAU); ctx.fillStyle = j === i ? C.gold : 'rgba(217,181,108,.35)'; ctx.fill(); });
}

// ---------------------------------------------------------------- 6 all four together (46..50)
function sAll(ctx, u, IMG) {
  inkGround(ctx, 900);
  ctx.save(); shadow(ctx, 20, 0.7);
  rise(ctx, 'HOSTED BY', 250, font(36, 500, UI), C.gold, u, 45.6, { track: 14 });
  rise(ctx, 'Welcoming you', 370, font(96, 500, DISPLAY), goldAt(ctx, 370, 96), u, 45.8);
  ctx.restore();
  HOSTS.forEach(([k, name, deg, , fy], j) => {
    const cx = j % 2 ? W * 0.73 : W * 0.27, cy = 700 + Math.floor(j / 2) * 620;
    const s = springU(u, 45.75 + j * 0.2, SPRING.bouncy);
    if (s <= 0) return;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
    medallion(ctx, IMG[`h_${k}`], cx, cy, 190, fy, 1.15);
    ctx.save(); shadow(ctx, 16, 0.7);
    const nm = name.replace('Dr. ', 'Dr. ');
    text(ctx, nm, cx, cy + 275, font(fitSize(ctx, nm, 600, SERIF, 470, 50), 600, SERIF), C.hi, 'center');
    text(ctx, deg, cx, cy + 330, font(34, 500, UI), C.cream, 'center', 4);
    ctx.restore();
    ctx.restore();
  });
}

// ---------------------------------------------------------------- 7 the team (50..56)
function sTeam(ctx, u, IMG) {
  cover(ctx, IMG.team, 0, 0, W, H, { fx: 0.5, fy: 0.5, zoom: 1.0 });
  veil(ctx, 0.9);
  ctx.save(); shadow(ctx);
  rise(ctx, 'OUR TEAM', 430, font(38, 500, UI), C.gold, u, 49.7, { track: 14 });
  rise(ctx, 'Our team welcomes you', 535, font(fitSize(ctx, 'Our team welcomes you', 500, DISPLAY, 980, 92), 500, DISPLAY), goldAt(ctx, 535, 92), u, 49.8);
  ctx.restore();
  const k = springU(u, 49.8, SPRING.gentle);
  if (k > 0) {
    const w = 980, h = w * IMG.team.height / IMG.team.width, x = (W - w) / 2, y = lerp(H, 650, k);
    const z = Math.exp(lerp(Math.log(1.0), Math.log(1.1), prog(u, 50, 56)));
    rrect(ctx, x - 8, y - 8, w + 16, h + 16, 22); ctx.fillStyle = C.gold; ctx.fill();
    cover(ctx, IMG.team, x, y, w, h, { fx: lerp(0.45, 0.55, prog(u, 50, 56)), fy: 0.6, zoom: z, radius: 16 });
  }
  ctx.save(); shadow(ctx);
  rise(ctx, 'మా బృందం మీకు సాదర స్వాగతం', 1420, font(50, 500, TE), C.hi, u, 51.5);
  rise(ctx, 'పలుకుతోంది', 1500, font(50, 500, TE), C.hi, u, 51.7);
  ctx.restore();
}

// ---------------------------------------------------------------- 8 date and venue (56..62)
function sDate(ctx, u, IMG) {
  cover(ctx, IMG.c_b, 0, 0, W, H, { fx: 0.5, fy: 0.45, zoom: Math.exp(lerp(Math.log(1.2), Math.log(1.3), prog(u, 56, 62))) });
  veil(ctx, 0.72);
  ctx.save(); shadow(ctx, 30, 0.9);
  rise(ctx, 'SAVE THE DATE', 380, font(40, 500, UI), C.gold, u, 55.7, { track: 14 });
  const k = springU(u, 55.75, SPRING.bouncy);
  if (k > 0) {
    ctx.save(); ctx.translate(W / 2, 590); ctx.scale(k, k);
    text(ctx, 'Friday', 0, -110, font(84, 500, DISPLAY), C.hi, 'center');
    text(ctx, '6 November', 0, 40, font(150, 500, DISPLAY), goldAt(ctx, 40, 150), 'center');
    ctx.restore();
  }
  rise(ctx, '2026', 760, font(64, 500, UI), C.cream, u, 56.4, { track: 20 });
  // the muhurtham, in a gold pill
  const p = springU(u, 56.9, SPRING.bouncy);
  if (p > 0) {
    ctx.save(); ctx.translate(W / 2, 900); ctx.scale(p, p);
    rrect(ctx, -250, -62, 500, 124, 62); ctx.fillStyle = goldAt(ctx, 28, 110); ctx.fill();
    text(ctx, '10:32 AM', 0, 26, font(72, 600, UI), C.ink, 'center', 4);
    ctx.restore();
  }
  rule(ctx, 1040, 360, u, 58.2);
  rise(ctx, 'VENUE', 1140, font(36, 500, UI), C.gold, u, 58.4, { track: 14 });
  rise(ctx, 'Rama Mahal', 1250, font(96, 600, SERIF), goldAt(ctx, 1250, 96), u, 58.5);
  const lines = ['Door No. 3-12, Ground Floor', 'Kasturi Vari Street, R.R. Peta', 'Opp. Happy Mobiles,', 'Near Lakshmi Ganapathi Temple', 'Eluru 534002'];
  lines.forEach((l, j) => rise(ctx, l, 1345 + j * 64, font(44, 400, UI), C.cream, u, 59 + j * 0.2));
  ctx.restore();
}

// ---------------------------------------------------------------- 9 end card (62..68)
function sEnd(ctx, u, IMG) {
  inkGround(ctx, 600);
  logo(ctx, IMG, W / 2, 560, 800, springU(u, 61.7, SPRING.bouncy));
  ctx.save(); shadow(ctx);
  rise(ctx, 'అందరికీ ఆహ్వానం', 880, font(64, 600, TE), C.hi, u, 62.5);
  rise(ctx, 'All are welcome', 990, font(84, 500, DISPLAY), goldAt(ctx, 990, 84), u, 62.8);
  const p = springU(u, 63.3, SPRING.bouncy);
  if (p > 0) {
    ctx.save(); ctx.translate(W / 2, 1170); ctx.scale(p, p);
    rrect(ctx, -440, -70, 880, 140, 70); ctx.fillStyle = goldAt(ctx, 30, 120); ctx.fill();
    text(ctx, 'WhatsApp  99591 34666', 0, 24, font(66, 600, UI), C.ink, 'center');
    ctx.restore();
  }
  rise(ctx, 'www.dermaluxe.ai', 1320, font(50, 400, UI), C.hi, u, 64, { track: 3 });
  rise(ctx, 'Friday 6 Nov 2026  ·  10:32 AM  ·  Rama Mahal, Eluru', 1440, font(36, 400, UI), C.muted, u, 64.4);
  ctx.restore();
}

const IMAGES = { team: 'assets/team.jpg', logo: 'assets/logo.png' };
['b', 'rec', 'logo', ...TOUR.map((r) => r[0])].forEach((k) => { IMAGES[`c_${k}`] = `assets/c_${k}.jpg`; });
HOSTS.forEach(([k]) => { IMAGES[`h_${k}`] = `assets/h_${k}.jpg`; });

M.film({
  fonts: [font(100, 500, DISPLAY), font(100, 600, SERIF), font(40, 400, UI), font(40, 500, UI), font(40, 600, UI), font(40, 500, TE), font(40, 600, TE)],
  images: IMAGES,
  hits: HITS,
  draw(ctx, u, t, IMG) {
    if (u < 8) sOpen(ctx, u, IMG);
    else if (u < 12) sReception(ctx, u, IMG);
    else if (u < 28) sTour(ctx, u, IMG);
    else if (u < 30) sHostedBy(ctx, u, IMG);
    else if (u < 46) sHosts(ctx, u, IMG);
    else if (u < 50) sAll(ctx, u, IMG);
    else if (u < 56) sTeam(ctx, u, IMG);
    else if (u < 62) sDate(ctx, u, IMG);
    else sEnd(ctx, u, IMG);
  },
});
