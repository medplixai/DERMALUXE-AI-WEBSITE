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

    btn.addEventListener("click", function () { panel.hidden ? open() : close(); });
    var x = document.getElementById("dlChatClose");
    if (x) x.addEventListener("click", close);
    form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value.trim()); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) close(); });
  });
})();
