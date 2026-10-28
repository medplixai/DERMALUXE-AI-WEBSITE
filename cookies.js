/* DermaLuxe — lightweight cookie consent banner (self-contained, no dependencies) */
(function () {
  "use strict";
  var KEY = "dl_cookie_consent";
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  var root = document.documentElement;

  // The bar is pinned over the page at z-index 120, so whatever is underneath
  // it is both unreadable and untappable — the bar receives the tap. On a
  // phone it covers 16,600 to 375,780 and the AI chat button sits at 326,662,
  // right inside it, so on a first visit the chat button did nothing at all.
  // Publish how much of the screen the bar takes and let the stylesheet give
  // the foot of the page room and lift a control the bar would bury.
  //
  // Measured from where the bar comes to rest, not from its rectangle: it
  // starts translated 130% below the screen and slides up over half a second,
  // so its rectangle is wrong for most of that time. Its own CSS `bottom`
  // plus its layout height is right from the first frame.
  function fit(bar) {
    // Read the button where it rests, so a second call cannot see the lift it
    // applied itself and talk itself back out of it.
    root.classList.remove("dl-consent-lift");
    var gap = parseFloat(getComputedStyle(bar).bottom) || 0;
    var top = gap + bar.offsetHeight;
    root.style.setProperty("--consent-top", Math.round(top) + "px");
    root.classList.add("dl-consent");

    var btn = document.querySelector(".dlchat-btn");
    var lift = false;
    if (btn) {
      var b = bar.getBoundingClientRect();       // left and right are already at rest
      var c = btn.getBoundingClientRect();
      var restTop = window.innerHeight - top, restBottom = window.innerHeight - gap;
      lift = Math.min(b.right, c.right) > Math.max(b.left, c.left) &&
             Math.min(restBottom, c.bottom) > Math.max(restTop, c.top);
    }
    if (lift) root.classList.add("dl-consent-lift");
  }

  function build() {
    var bar = document.createElement("div");
    bar.className = "cookie-bar";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie consent");
    // This bar is English wherever it appears, including on the 42 pages that
    // declare themselves Telugu. Without this it inherits lang="te" from the
    // document and anything reading the page aloud gives "We use cookies to
    // enhance your browsing experience" to a Telugu voice.
    bar.setAttribute("lang", "en");
    bar.innerHTML =
      '<p class="cookie-bar__text">We use cookies to enhance your browsing experience, analyse site traffic and assist our marketing. ' +
      'By clicking <strong>Accept</strong>, you consent to our use of cookies. ' +
      '<a href="cookies.html">Cookie Policy</a></p>' +
      '<div class="cookie-bar__actions">' +
      '<button type="button" class="cookie-btn cookie-btn--ghost" data-decline>Decline</button>' +
      '<button type="button" class="cookie-btn cookie-btn--gold" data-accept>Accept</button>' +
      "</div>";
    document.body.appendChild(bar);

    var again = function () { fit(bar); };
    window.addEventListener("resize", again);

    function set(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      bar.classList.add("cookie-bar--hide");
      window.removeEventListener("resize", again);
      root.classList.remove("dl-consent", "dl-consent-lift");
      root.style.removeProperty("--consent-top");
      setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 400);
    }
    bar.querySelector("[data-accept]").addEventListener("click", function () {
      set("accepted");
      if (window.dlGrantAnalytics) window.dlGrantAnalytics();
    });
    bar.querySelector("[data-decline]").addEventListener("click", function () { set("declined"); });
    requestAnimationFrame(function () { bar.classList.add("cookie-bar--in"); fit(bar); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
