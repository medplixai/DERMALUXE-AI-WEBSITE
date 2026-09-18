/* golddust.js — the homepage hero's moving gold.
 *
 * Gold dust drifting up through dark air, the way light catches it. Move a
 * finger or the mouse through it and it parts around you; press and hold and
 * it gathers to the point and brightens; let go and it drifts off again.
 *
 * It exists to make the first screen feel like the clinic, and it must never
 * cost the clinic a patient. Everything below is written around that:
 *
 *  - It starts AFTER the page is up. The headline and the WhatsApp button are
 *    what a visitor came for, so this waits for load and an idle moment, then
 *    fades in. It cannot delay the first paint.
 *  - It is small. No library: one canvas, one pre-drawn glow sprite stamped
 *    many times, which is far cheaper than drawing blurred circles.
 *  - It knows what it is running on. Fewer particles on a phone, fewer again
 *    on a weak one, and none at all — one still frame — when the visitor has
 *    asked their device for reduced motion or to save data.
 *  - It stops when nobody is looking: scrolled past, or another tab.
 *  - It watches its own frame time and halves itself if it is dropping frames,
 *    rather than stuttering on a cheap phone.
 *  - It never takes a tap or a scroll. The canvas ignores the pointer; the
 *    hero is listened to passively, so buttons work and the page scrolls.
 *  - It keeps off the doctor's photograph. Gold light on dark air reads as
 *    gold; the same specks on a bright photo of a face read as dust on the
 *    lens. On a phone the photo sits across the top, on a desktop down the
 *    right, so the dust lives in whatever dark space is left and fades out
 *    at the photo's edge.
 */
(function () {
  "use strict";
  var hero = document.querySelector(".hero");
  if (!hero || !window.HTMLCanvasElement) return;

  var GOLD = ["#f4e2b8", "#e9cf8f", "#c6a25c", "#a87f3c"];
  var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
  var reduced = mq("(prefers-reduced-motion: reduce)");
  var conn = navigator.connection || {};
  var saveData = !!conn.saveData || /(^|-)2g$/.test(String(conn.effectiveType || ""));
  var coarse = mq("(pointer: coarse)");
  var cores = navigator.hardwareConcurrency || 4;
  var mem = navigator.deviceMemory || 4;
  var weak = cores <= 4 || mem <= 2;

  // Particles per 10,000 square pixels of the DARK part of the hero. A phone
  // gets more per pixel than a desktop, not fewer: its dark area is a narrow
  // strip under the photo, and at desktop density that strip held about
  // seventy motes spread over twelve hundred pixels — too thin to read as
  // anything. A few hundred sprite stamps a frame is nothing to a phone.
  var DENSITY = saveData ? 0.8 : weak ? (coarse ? 2.0 : 1.4) : coarse ? 3.6 : 2.6;
  var MAX = weak ? 220 : coarse ? 420 : 1100;
  var DPR = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);

  var canvas = document.createElement("canvas");
  canvas.className = "golddust";
  canvas.setAttribute("aria-hidden", "true");
  var st = canvas.style;
  st.position = "absolute"; st.inset = "0"; st.width = "100%"; st.height = "100%";
  st.zIndex = "0"; st.pointerEvents = "none";
  st.opacity = "0"; st.transition = "opacity 1.6s ease";
  // Above the background and the photo, below the words.
  var inner = hero.querySelector(".hero__inner");
  hero.insertBefore(canvas, inner || null);
  if (inner && getComputedStyle(inner).position === "static") inner.style.position = "relative";
  if (inner && (getComputedStyle(inner).zIndex === "auto")) inner.style.zIndex = "1";
  var ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }

  // One soft round glow per colour, drawn once, stamped every frame.
  var SPRITE = 64;
  var sprites = GOLD.map(function (c) {
    var s = document.createElement("canvas");
    s.width = s.height = SPRITE;
    var g = s.getContext("2d");
    var r = SPRITE / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(255,248,228,1)");
    grad.addColorStop(0.18, c);
    grad.addColorStop(0.45, hexA(c, 0.35));
    grad.addColorStop(1, hexA(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE, SPRITE);
    return s;
  });
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }

  var W = 0, H = 0, parts = [];
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var ss = function (a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Where the photograph is, relative to the hero, and which way it lies.
  // `open(x, y)` is how much dust is allowed at a point: 1 in the dark, easing
  // to 0 across the photo's edge.
  var shape = { kind: "none", a: 0, b: 0 };
  function measurePhoto() {
    var ph = hero.querySelector(".hero__photo");
    shape = { kind: "none", a: 0, b: 0 };
    if (!ph) return;
    var h = hero.getBoundingClientRect(), r = ph.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.width >= h.width * 0.85) {
      // phone: across the top — dust starts just above its lower edge
      var bottom = r.bottom - h.top;
      shape = { kind: "top", a: bottom - 70, b: bottom + 50 };
    } else {
      // desktop: down the right, already fading in from its left edge
      var left = r.left - h.left;
      shape = { kind: "side", a: left + r.width * 0.12, b: left + r.width * 0.5 };
    }
  }
  function open(x, y) {
    if (shape.kind === "top") return ss(shape.a, shape.b, y);
    if (shape.kind === "side") return 1 - ss(shape.a, shape.b, x);
    return 1;
  }
  // The share of the hero that is dark, so density is spread over the space
  // it can actually be seen in rather than the whole box.
  function openShare() {
    if (shape.kind === "top") return Math.max(0.15, 1 - Math.max(0, shape.a) / H);
    if (shape.kind === "side") return Math.max(0.15, Math.min(1, ((shape.a + shape.b) / 2) / W));
    return 1;
  }
  // A starting point in the dark, rejection-sampled against open().
  function spot(anyY) {
    for (var i = 0; i < 12; i++) {
      var x = rnd(0, W), y = anyY ? rnd(0, H) : H + rnd(0, 40);
      if (!anyY) { if (open(x, H - 1) > 0.4) return { x: x, y: y }; continue; }
      if (open(x, y) > 0.35) return { x: x, y: y };
    }
    return { x: rnd(0, W * 0.5), y: anyY ? rnd(H * 0.5, H) : H + 10 };
  }

  function make(anyY) {
    // Most dust is small and faint; a few motes are close to the light.
    var near = Math.random() < 0.12;
    var at0 = spot(anyY);
    return {
      x: at0.x, y: at0.y,
      vx: 0, vy: 0,
      size: near ? rnd(2.6, 4.8) : rnd(0.9, 2.3),
      rise: near ? rnd(0.18, 0.34) : rnd(0.06, 0.22),
      sway: rnd(0.2, 0.9), phase: rnd(0, Math.PI * 2), freq: rnd(0.0006, 0.0016),
      alpha: near ? rnd(0.65, 0.95) : rnd(0.3, 0.72),
      tw: rnd(0.0008, 0.0024), c: (Math.random() * GOLD.length) | 0,
    };
  }

  function size() {
    var r = hero.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    measurePhoto();
    var want = Math.min(MAX, Math.round((W * H * openShare() / 10000) * DENSITY));
    while (parts.length < want) parts.push(make(true));
    if (parts.length > want) parts.length = want;
  }

  // The pointer, in hero coordinates. `held` gathers; otherwise it parts.
  var ptr = { x: -9999, y: -9999, on: false, held: false, t: 0 };
  function at(e) {
    var r = hero.getBoundingClientRect();
    var p = e.touches ? e.touches[0] : e;
    if (!p) return;
    ptr.x = p.clientX - r.left; ptr.y = p.clientY - r.top; ptr.on = true; ptr.t = performance.now();
  }
  var passive = { passive: true };
  hero.addEventListener("pointermove", at, passive);
  hero.addEventListener("pointerdown", function (e) { at(e); ptr.held = true; }, passive);
  window.addEventListener("pointerup", function () { ptr.held = false; }, passive);
  hero.addEventListener("pointerleave", function () { ptr.on = false; ptr.held = false; }, passive);
  hero.addEventListener("touchstart", function (e) { at(e); ptr.held = true; }, passive);
  hero.addEventListener("touchmove", at, passive);
  hero.addEventListener("touchend", function () { ptr.held = false; ptr.on = false; }, passive);

  var R = coarse ? 110 : 150;           // how far a hand reaches into the dust
  var glow = 0;                         // how gathered the light is, 0..1

  function step(now, dt) {
    var k = dt / 16.67;                 // frame-rate independent
    var idle = now - ptr.t > 2500;      // a finger that has not moved is gone
    var live = ptr.on && !idle;
    glow += ((live && ptr.held ? 1 : 0) - glow) * 0.06 * k;

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      // drift: up, with a slow side-to-side like dust in still air
      var sx = Math.sin(now * p.freq + p.phase) * p.sway;
      var tx = sx * 0.25, ty = -p.rise;

      if (live) {
        var dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R * (ptr.held ? 4 : 1)) {
          var d = Math.sqrt(d2) || 1;
          if (ptr.held) {
            // gather: drawn in, and circling a little so it looks alive
            var pull = (1 - d / (R * 2)) * 0.9;
            tx -= (dx / d) * pull + (dy / d) * 0.35 * pull;
            ty -= (dy / d) * pull - (dx / d) * 0.35 * pull;
          } else {
            // part: pushed gently aside, the way a hand moves through it
            var push = (1 - d / R) * 1.6;
            tx += (dx / d) * push;
            ty += (dy / d) * push;
          }
        }
      }

      // ease towards the target velocity, so nothing ever snaps
      p.vx += (tx - p.vx) * 0.08 * k;
      p.vy += (ty - p.vy) * 0.08 * k;
      p.x += p.vx * k; p.y += p.vy * k;

      if (p.y < -20 || p.x < -40 || p.x > W + 40 || (shape.kind === "top" && p.y < shape.a - 30)) parts[i] = make(false);

      var tw = 0.65 + 0.35 * Math.sin(now * p.tw + p.phase);
      var o = open(p.x, p.y);
      if (o < 0.02) continue;
      var a = p.alpha * tw * o;
      if (glow > 0.01 && live) {
        var gx = p.x - ptr.x, gy = p.y - ptr.y;
        var near = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy) / (R * 1.4));
        a = Math.min(1, a + near * glow * 0.8);
      }
      var s = p.size * 6;               // the sprite's soft edge is most of it
      ctx.globalAlpha = a;
      ctx.drawImage(sprites[p.c], p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- running, and not running ------------------------------------------
  // A page opened in a background tab starts hidden; start from the truth
  // rather than assume, or it asks for frames nobody can see.
  var raf = 0, last = 0, visible = !document.hidden, shown = true;
  var slow = 0, frames = 0;
  function loop(now) {
    raf = 0;
    if (!visible || !shown) return;
    var dt = last ? Math.min(64, now - last) : 16.67;
    last = now;
    step(now, dt);
    // A cheap phone that cannot keep up gets less dust rather than a stutter.
    frames++;
    if (dt > 26) slow++;
    if (frames === 90) {
      if (slow > 45 && parts.length > 60) { parts.length = Math.round(parts.length / 2); MAX = parts.length; }
      frames = 0; slow = 0;
    }
    raf = requestAnimationFrame(loop);
  }
  function run() { if (!raf && visible && shown && !reduced) { last = 0; raf = requestAnimationFrame(loop); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { shown = es[0].isIntersecting; shown ? run() : stop(); }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener("visibilitychange", function () { visible = !document.hidden; visible ? run() : stop(); });
  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { size(); if (reduced) step(performance.now(), 16.67); }, 150); });

  function start() {
    size();
    // Reduced motion gets the gold, not the movement: one still frame.
    step(performance.now(), 16.67);
    canvas.style.opacity = "1";
    run();
  }
  // After the page, never before it.
  function later() { (window.requestIdleCallback || function (f) { setTimeout(f, 200); })(start, { timeout: 1500 }); }
  if (document.readyState === "complete") later(); else window.addEventListener("load", later, { once: true });

  window.GoldDust = { count: function () { return parts.length; }, reduced: reduced, weak: weak, coarse: coarse };
})();
