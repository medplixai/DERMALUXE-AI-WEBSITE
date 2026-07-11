/* DermaLuxe by MediCare — interactions */
(function () {
  "use strict";

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
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  });
  links.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

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

  /* ---- Service filter tabs ---- */
  const svcTabs = document.getElementById("svcTabs");
  const svcGrid = document.getElementById("svcGrid");
  if (svcTabs && svcGrid) {
    const cards = [...svcGrid.querySelectorAll(".svc")];
    svcTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".svc-tab");
      if (!tab) return;
      svcTabs.querySelectorAll(".svc-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const filter = tab.dataset.filter;
      cards.forEach((card) => {
        const show = filter === "all" || card.dataset.cat === filter;
        card.classList.toggle("is-hidden", !show);
      });
    });
  }

  /* ---- Year ---- */
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  /* ---- Booking form → lead capture ----
     Stage 1 (live): sends the lead as a structured WhatsApp message
     to the clinic number, so no enquiry is ever missed.
     Stage 2 (optional): set LEAD_WEBHOOK_URL to also POST the lead
     to clinic software / Google Sheets / CRM. */
  const CLINIC_WHATSAPP = "919949134666";
  const LEAD_WEBHOOK_URL = ""; // e.g. clinic software / Apps Script endpoint

  const form = document.getElementById("bookingForm");
  const note = document.getElementById("formNote");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const phone = form.phone.value.trim();
      const email = form.email.value.trim();
      const service = form.service.value;
      const message = form.message.value.trim();
      note.className = "form__note";

      if (!name || !phone || !service) {
        note.textContent = "Please fill in your name, phone number and treatment. · పేరు, ఫోన్ నంబర్, చికిత్స నింపండి.";
        note.classList.add("err");
        return;
      }
      if (!/^[+\d][\d\s\-()]{6,}$/.test(phone)) {
        note.textContent = "Please enter a valid phone number. · సరైన ఫోన్ నంబర్ ఇవ్వండి.";
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
      const phone = document.getElementById("telePhone").value.replace(/\D/g, "");
      const mode = document.getElementById("teleMode").value;
      const date = document.getElementById("teleDate").value;
      const slot = document.getElementById("teleSlot").value;
      const concern = document.getElementById("teleConcern").value;
      teleNote.className = "form__note";

      if (!name || !phone || !mode || !slot || !concern) {
        teleNote.textContent = "Please fill all details. · అన్ని వివరాలు నింపండి.";
        teleNote.classList.add("err");
        return;
      }
      if (!/^[6-9]\d{9}$/.test(phone)) {
        teleNote.textContent = "Enter a valid 10-digit mobile number. · సరైన మొబైల్ నంబర్ ఇవ్వండి.";
        teleNote.classList.add("err");
        return;
      }

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
