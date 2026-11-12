// Gold gradient titles that survive PDF. Chrome prints `background-clip: text` as a solid gold
// rectangle (the screenshots look right, the press PDF does not), so after the fonts load each
// matching element's text is redrawn as an SVG <text> filled with the same gradient, in place.
// Runs inside the page:  await pg.evaluate(goldify, ".title")
module.exports = function goldify(sel) {
  const ns = "http://www.w3.org/2000/svg";
  document.querySelectorAll(sel).forEach((el, i) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const size = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || size * 1.2;
    const pt = parseFloat(cs.paddingTop), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    const c = document.createElement("canvas").getContext("2d");
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = c.measureText(el.textContent);
    const base = pt + (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", r.width); svg.setAttribute("height", r.height);
    svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    svg.style.display = "block"; svg.style.overflow = "visible";
    svg.innerHTML = `<defs><linearGradient id="gold${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${base - 0.78 * size}" x2="0" y2="${base + 0.12 * size}">
      <stop offset="0" stop-color="#f6e6bd"/><stop offset=".45" stop-color="#e3c074"/><stop offset="1" stop-color="#b88d45"/></linearGradient></defs>`;
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", pl + (r.width - pl - pr) / 2); t.setAttribute("y", base);
    t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", `url(#gold${i})`);
    Object.assign(t.style, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontStyle: cs.fontStyle, fontWeight: cs.fontWeight });
    t.textContent = el.textContent;
    svg.appendChild(t);
    el.textContent = "";
    Object.assign(el.style, { background: "none", webkitBackgroundClip: "border-box", backgroundClip: "border-box", padding: "0", width: r.width + "px", height: r.height + "px" });
    el.appendChild(svg);
  });
};
