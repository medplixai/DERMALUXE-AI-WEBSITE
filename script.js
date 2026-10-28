/* DermaLuxe by MediCare — interactions */
(function () {
  "use strict";

  /* One idea of what a mobile number is, for every form on this page. There
     used to be two: the teleconsultation form stripped the punctuation and
     asked for ten digits starting 6-9, and the booking form — the one that
     makes the clinic ring somebody back — accepted a plus or a digit followed
     by six or more of digit, space, hyphen or bracket. That let "9949134",
     "1234567" and seven zeros through to a green thank-you and a WhatsApp
     draft carrying the broken number, with nothing on either screen saying
     so. Keep them reading from the same line. */
  function mobile(raw) {
    var d = String(raw || "").replace(/\D/g, "").replace(/^(?:0*91|0+)(?=[6-9]\d{9}$)/, "");
    return /^[6-9]\d{9}$/.test(d) ? d : "";
  }

  /* ---- Sticky nav shadow ---- */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Back to top ---- */
  const toTop = document.getElementById("toTop");
  if (toTop) {
    const onTopScroll = () => toTop.classList.toggle("is-show", window.scrollY > 700);
    onTopScroll();
    window.addEventListener("scroll", onTopScroll, { passive: true });
    toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /* ---- Mobile menu ---- */
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  const closeMenu = () => {
    links.classList.remove("open");
    toggle.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  };
  /* On Android the back gesture is the universal "close this thing". Opening
     the menu added no history step, so back left the page being read — and
     left the site altogether for somebody who arrived from a search. One
     entry is pushed when it opens and consumed when it closes, so back closes
     the menu and a second back does what it always did. */
  let menuPushed = false;
  const openMenu = () => {
    links.classList.add("open");
    toggle.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    if (!menuPushed) { menuPushed = true; try { history.pushState({ dlMenu: 1 }, ""); } catch (e) { menuPushed = false; } }
  };
  const dismissMenu = () => {
    const wasPushed = menuPushed;
    menuPushed = false;
    closeMenu();
    if (wasPushed) { try { history.back(); } catch (e) {} }
  };
  toggle.addEventListener("click", () => {
    links.classList.contains("open") ? dismissMenu() : openMenu();
  });
  links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
    // the link navigates or jumps; drop our history step without going back
    menuPushed = false;
    closeMenu();
  }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && links.classList.contains("open")) dismissMenu(); });
  window.addEventListener("popstate", () => {
    if (links.classList.contains("open")) { menuPushed = false; closeMenu(); }
  });

  /* ---- Scroll reveal ---- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const sibs = [...el.parentElement.querySelectorAll(":scope > .reveal")];
            const idx = Math.max(0, sibs.indexOf(el));
            el.style.transitionDelay = Math.min(idx, 6) * 80 + "ms";
            el.classList.add("in");
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---- Active nav link on scroll ---- */
  const sections = [...document.querySelectorAll("main section[id]")];
  const navAnchors = [...links.querySelectorAll('a[href^="#"]:not(.btn)')];
  const byId = {};
  navAnchors.forEach((a) => (byId[a.getAttribute("href").slice(1)] = a));
  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            navAnchors.forEach((a) => a.classList.remove("active"));
            const a = byId[entry.target.id];
            if (a) a.classList.add("active");
          }
        });
      },
      { threshold: 0.4, rootMargin: "-30% 0px -50% 0px" }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* ---- Service filter tabs: removed 27 Oct 2026 ----
     The home page used to carry all forty-three treatments behind filter
     tabs. It now shows eight and links to treatments.html for the rest, so
     there is nothing left to filter. The handler is gone rather than left
     guarded — a listener waiting for an element no page builds is a thing the
     next reader has to prove is dead. */

  /* ---- Year ---- */
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  /* ---- Booking form → lead capture ----
     Stage 1 (live): sends the lead as a structured WhatsApp message
     to the clinic number, so no enquiry is ever missed.
     Stage 2 (optional): set LEAD_WEBHOOK_URL to also POST the lead
     to clinic software / Google Sheets / CRM. */
  const CLINIC_WHATSAPP = "919959134666";
  const LEAD_WEBHOOK_URL = ""; // e.g. clinic software / Apps Script endpoint

  const saveLead = (lead) => {
    try {
      fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ page: location.href }, lead)),
      }).catch(() => {});
    } catch (e) {}
  };

  const form = document.getElementById("bookingForm");
  const note = document.getElementById("formNote");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      // The same page already knows what an Indian mobile number is — the
      // teleconsultation form twenty inches down strips the punctuation and
      // asks for ten digits starting 6-9. This form asked for "a + or a digit
      // and then six or more of digit, space, hyphen or bracket", which
      // accepts "9949134", "1234567", seven zeros, and 25 digits, because the
      // field has no maxlength either. A patient who drops three digits got
      // the green thank-you and a WhatsApp draft carrying the broken number,
      // and the clinic got an enquiry it cannot ring, with nothing on either
      // screen saying so. One rule, the stricter one, on both forms.
      const typed = form.phone.value.trim();
      const phone = mobile(typed);
      const email = form.email.value.trim();
      const service = form.service.value;
      const message = form.message.value.trim();
      note.className = "form__note";

      if (!name || !typed || !service) {
        note.textContent = "Please fill in your name, phone number and treatment. · పేరు, ఫోన్ నంబర్, చికిత్స నింపండి.";
        note.classList.add("err");
        return;
      }
      if (!phone) {
        note.textContent = "Enter a valid 10-digit mobile number. · సరైన మొబైల్ నంబర్ ఇవ్వండి.";
        note.classList.add("err");
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;

      const lead = {
        name: name, phone: phone, email: email,
        service: service, message: message,
        source: "dermaluxe.ai website", page: location.href,
        time: new Date().toISOString()
      };

      saveLead({ type: "booking", name: name, phone: phone, concern: service, message: message });

      // Optional webhook to clinic software / sheet (fire-and-forget)
      if (LEAD_WEBHOOK_URL) {
        try {
          fetch(LEAD_WEBHOOK_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(lead)
          });
        } catch (err) { /* non-blocking */ }
      }

      // WhatsApp lead message to the clinic
      const waText =
        "*New Consultation Request — dermaluxe.ai*%0A" +
        "----------------------------%0A" +
        "*Name:* " + encodeURIComponent(name) + "%0A" +
        "*Phone:* " + encodeURIComponent(phone) + "%0A" +
        (email ? "*Email:* " + encodeURIComponent(email) + "%0A" : "") +
        "*Treatment:* " + encodeURIComponent(service) + "%0A" +
        (message ? "*Message:* " + encodeURIComponent(message) + "%0A" : "") +
        "----------------------------%0A" +
        "Please confirm my appointment.";
      window.open("https://wa.me/" + CLINIC_WHATSAPP + "?text=" + waText, "_blank", "noopener");

      note.textContent = "Thank you, " + name.split(" ")[0] + "! WhatsApp opening — press Send to confirm your request. · వాట్సాప్ లో Send నొక్కండి.";
      note.classList.add("ok");
      form.reset();
      btn.disabled = false;
    });
  }

  /* ---- Teleconsultation form → WhatsApp lead ---- */
  const teleForm = document.getElementById("teleForm");
  const teleNote = document.getElementById("teleNote");
  if (teleForm) {
    teleForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("teleName").value.trim();
      const typedTele = document.getElementById("telePhone").value.trim();
      const phone = mobile(typedTele);
      const mode = document.getElementById("teleMode").value;
      const date = document.getElementById("teleDate").value;
      const slot = document.getElementById("teleSlot").value;
      const concern = document.getElementById("teleConcern").value;
      teleNote.className = "form__note";

      if (!name || !typedTele || !mode || !slot || !concern) {
        teleNote.textContent = "Please fill all details. · అన్ని వివరాలు నింపండి.";
        teleNote.classList.add("err");
        return;
      }
      if (!phone) {
        teleNote.textContent = "Enter a valid 10-digit mobile number. · సరైన మొబైల్ నంబర్ ఇవ్వండి.";
        teleNote.classList.add("err");
        return;
      }

      saveLead({ type: "teleconsult", name: name, phone: phone, mode: mode, date: date, slot: slot, concern: concern });

      const waText =
        "*Teleconsultation Request — dermaluxe.ai*%0A" +
        "----------------------------%0A" +
        "*Name:* " + encodeURIComponent(name) + "%0A" +
        "*Phone:* " + encodeURIComponent(phone) + "%0A" +
        "*Mode:* " + encodeURIComponent(mode) + "%0A" +
        (date ? "*Date:* " + encodeURIComponent(date) + "%0A" : "") +
        "*Slot:* " + encodeURIComponent(slot) + "%0A" +
        "*Concern:* " + encodeURIComponent(concern) + "%0A" +
        "----------------------------%0A" +
        "Please confirm my teleconsultation.";
      window.open("https://wa.me/" + CLINIC_WHATSAPP + "?text=" + waText, "_blank", "noopener");

      teleNote.textContent = "Thank you, " + name.split(" ")[0] + "! WhatsApp opening — press Send to confirm. · వాట్సాప్ లో Send నొక్కండి.";
      teleNote.classList.add("ok");
      teleForm.reset();
    });
  }
})();

/* FAB greeting bubble — appears once per visit, dismissible */
(function () {
  var hint = document.getElementById("fabHint");
  if (!hint) return;
  var KEY = "dl_fab_hint";
  try { if (sessionStorage.getItem(KEY) === "1") return; } catch (e) {}
  var hide = function (remember) {
    hint.classList.remove("on");
    setTimeout(function () { hint.hidden = true; }, 450);
    if (remember) { try { sessionStorage.setItem(KEY, "1"); } catch (e) {} }
  };
  setTimeout(function () {
    hint.hidden = false;
    void hint.offsetWidth; // reflow so the slide-in transition runs (rAF stalls in background tabs)
    hint.classList.add("on");
  }, 3800);
  setTimeout(function () { if (!hint.hidden) hide(false); }, 16000);
  document.getElementById("fabHintX").addEventListener("click", function () { hide(true); });
})();

/* ---- Google reviews (homepage) ---- */
(function () {
  var grid = document.getElementById("reviewsGrid");
  if (!grid) return;
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var stars = function (n) { n = Math.max(0, Math.min(5, Math.round(n || 0))); return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); };
  var initial = function (name) { var m = String(name || "").trim().match(/[A-Za-z\u0C00-\u0C7F]/); return m ? m[0].toUpperCase() : "G"; };
  var MAX = 230;
  fetch("/api/reviews", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d) return;
      var write = document.getElementById("reviewsWrite");
      var all = document.getElementById("reviewsAll");
      if (d.writeUrl && write) write.href = d.writeUrl;
      if (d.mapsUrl && all) all.href = d.mapsUrl;
      if (d.rating && d.count) {
        document.getElementById("reviewsNum").textContent = d.rating.toFixed(1);
        document.getElementById("reviewsStars").textContent = stars(d.rating);
        document.getElementById("reviewsCount").innerHTML = "Based on <b>" + d.count + "</b> Google review" + (d.count === 1 ? "" : "s");
        document.getElementById("reviewsScore").hidden = false;
        if (all) all.hidden = false;
      }
      var list = (d.reviews || []);
      if (!list.length) return;
      grid.innerHTML = list.map(function (rv) {
        var text = rv.text || "";
        var cut = text.length > MAX;
        var body = esc(cut ? text.slice(0, MAX).replace(/\s+\S*$/, "") + "…" : text);
        if (cut) body += ' <a href="' + esc(d.mapsUrl || "#") + '" target="_blank" rel="noopener">Read on Google</a>';
        return '<article class="review reveal in">' +
          '<div class="review__head"><span class="review__avatar" aria-hidden="true">' + esc(initial(rv.author)) + '</span>' +
          '<div class="review__who"><strong>' + esc(rv.author) + '</strong><span class="review__meta"><span class="stars" aria-label="' + rv.rating + ' out of 5">' + stars(rv.rating) + '</span>' + esc(rv.when || "") + '</span></div>' +
          '<span class="review__g" aria-label="Google review">G</span></div>' +
          '<p class="review__text">' + body + '</p></article>';
      }).join("");
    })
    .catch(function () {});
})();
