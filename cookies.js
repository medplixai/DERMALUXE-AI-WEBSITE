/* DermaLuxe — lightweight cookie consent banner (self-contained, no dependencies) */
(function () {
  "use strict";
  var KEY = "dl_cookie_consent";
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  function build() {
    var bar = document.createElement("div");
    bar.className = "cookie-bar";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie consent");
    bar.innerHTML =
      '<p class="cookie-bar__text">We use cookies to enhance your browsing experience, analyse site traffic and assist our marketing. ' +
      'By clicking <strong>Accept</strong>, you consent to our use of cookies. ' +
      '<a href="cookies.html">Cookie Policy</a></p>' +
      '<div class="cookie-bar__actions">' +
      '<button type="button" class="cookie-btn cookie-btn--ghost" data-decline>Decline</button>' +
      '<button type="button" class="cookie-btn cookie-btn--gold" data-accept>Accept</button>' +
      "</div>";
    document.body.appendChild(bar);

    function set(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      bar.classList.add("cookie-bar--hide");
      setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 400);
    }
    bar.querySelector("[data-accept]").addEventListener("click", function () { set("accepted"); });
    bar.querySelector("[data-decline]").addEventListener("click", function () { set("declined"); });
    requestAnimationFrame(function () { bar.classList.add("cookie-bar--in"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
