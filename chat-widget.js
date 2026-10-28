/* DermaLuxe website chat widget — talks to /api/chat (same clinic AI brain as
   WhatsApp). Session id lives in sessionStorage so a refresh keeps context;
   nothing else is stored client-side. */
(function () {
  var panel, log, form, input, sendBtn, chips, badge, opened = false, busy = false;
  var GREET = "Namaste! 🙏 DermaLuxe AI assistant ni.\n\nSkin, hair leda treatments gurinchi emaina adagandi — appointment kuda ikkade book cheyochu 😊";
  var STARTERS = ["📅 Appointment book cheyali", "💇 Hair fall treatment", "✨ Skin glow treatments"];

  function sid() {
    var k = "dl_chat_sid", v = "";
    try { v = sessionStorage.getItem(k) || ""; } catch (e) {}
    if (!v) {
      v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9]/g, "");
      try { sessionStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  function bubble(who, text) {
    var b = document.createElement("div");
    b.className = "dlchat__msg dlchat__msg--" + who;
    // WhatsApp-style *bold* and line breaks, inserted as text nodes only
    String(text).split("\n").forEach(function (line, i) {
      if (i) b.appendChild(document.createElement("br"));
      var parts = line.split(/\*([^*]+)\*/g);
      parts.forEach(function (p, j) {
        if (!p) return;
        if (j % 2) { var s = document.createElement("strong"); s.textContent = p; b.appendChild(s); }
        else b.appendChild(document.createTextNode(p));
      });
    });
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function showChips(list) {
    chips.textContent = "";
    (list || []).forEach(function (t) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "dlchat__chip";
      c.textContent = t;
      c.addEventListener("click", function () { chips.textContent = ""; send(t); });
      chips.appendChild(c);
    });
  }

  function send(text) {
    if (busy || !text) return;
    busy = true;
    sendBtn.disabled = true;
    bubble("me", text);
    input.value = "";
    chips.textContent = "";
    var typing = bubble("bot", "•••");
    typing.classList.add("is-typing");

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: sid(), message: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.remove();
        bubble("bot", (d && d.reply) || "Konchem sepu aagi malli try cheyandi 🙏");
        if (d && d.buttons && d.buttons.length) showChips(d.buttons);
      })
      .catch(function () {
        typing.remove();
        bubble("bot", "Connection problem 🙏 — WhatsApp lo matladandi: wa.me/919959134666");
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  function open() {
    panel.hidden = false;
    requestAnimationFrame(function () { panel.classList.add("on"); });
    if (badge) badge.hidden = true;
    if (!opened) {
      opened = true;
      bubble("bot", GREET);
      showChips(STARTERS);
    }
    setTimeout(function () { input.focus(); }, 250);
  }
  function close() {
    panel.classList.remove("on");
    setTimeout(function () { panel.hidden = true; }, 300);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("dlChatBtn");
    panel = document.getElementById("dlChatPanel");
    if (!btn || !panel) return;
    log = document.getElementById("dlChatLog");
    form = document.getElementById("dlChatForm");
    input = document.getElementById("dlChatInput");
    sendBtn = document.getElementById("dlChatSend");
    chips = document.getElementById("dlChatChips");
    badge = document.getElementById("dlChatBadge");

    /* Same as the menu: on Android, back means "close this". The panel has a
       working X, so this was recoverable — but back still threw the reader
       off the page they were on. */
    var pushed = false;
    var openPanel = function () {
      open();
      if (!pushed) { pushed = true; try { history.pushState({ dlChat: 1 }, ""); } catch (e) { pushed = false; } }
    };
    var closePanel = function () {
      var was = pushed; pushed = false; close();
      if (was) { try { history.back(); } catch (e) {} }
    };
    btn.addEventListener("click", function () { panel.hidden ? openPanel() : closePanel(); });
    window.addEventListener("popstate", function () { if (!panel.hidden) { pushed = false; close(); } });
    var x = document.getElementById("dlChatClose");
    if (x) x.addEventListener("click", closePanel);
    form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value.trim()); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) closePanel(); });

    // While somebody is typing in a form, the bubble is in the way and not
    // wanted. It is fixed 64px off the bottom, and on a phone the keyboard
    // takes the bottom half of the screen and pushes the field being filled
    // up towards it — so the corner of whichever field you are in can belong
    // to the bubble rather than the field. Tapping at the end of a half-typed
    // number to fix a digit is exactly how people correct one. It comes back
    // the moment the field is left.
    var hideWhileTyping = function (on) {
      if (panel && !panel.hidden) return;          // the panel is open; leave it be
      btn.style.opacity = on ? "0" : "";
      btn.style.pointerEvents = on ? "none" : "";
      btn.setAttribute("aria-hidden", on ? "true" : "false");
      if (on) btn.setAttribute("tabindex", "-1"); else btn.removeAttribute("tabindex");
    };
    var isField = function (t) {
      return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.closest(".dlchat");
    };
    document.addEventListener("focusin", function (e) { if (isField(e.target)) hideWhileTyping(true); });
    document.addEventListener("focusout", function (e) { if (isField(e.target)) setTimeout(function () {
      if (!isField(document.activeElement)) hideWhileTyping(false);
    }, 60); });
  });
})();
