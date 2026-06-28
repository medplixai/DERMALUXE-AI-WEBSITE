/* DermaLuxe by MediCare — interactions */
(function () {
  "use strict";

  /* ---- Sticky nav shadow ---- */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

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

  /* ---- Booking form ---- */
  const form = document.getElementById("bookingForm");
  const note = document.getElementById("formNote");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const phone = form.phone.value.trim();
      const service = form.service.value;
      note.className = "form__note";

      if (!name || !phone || !service) {
        note.textContent = "Please fill in your name, phone number and treatment.";
        note.classList.add("err");
        return;
      }
      if (!/^[+\d][\d\s\-()]{6,}$/.test(phone)) {
        note.textContent = "Please enter a valid phone number.";
        note.classList.add("err");
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Sending…";

      // Simulated submission (wire to your backend / WhatsApp / email service)
      setTimeout(() => {
        note.textContent = "Thank you, " + name.split(" ")[0] + "! Our care team will contact you shortly.";
        note.classList.add("ok");
        form.reset();
        btn.disabled = false;
        btn.textContent = original;
      }, 900);
    });
  }
})();
