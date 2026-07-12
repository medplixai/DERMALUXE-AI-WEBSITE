/* DermaLuxe — AI Skin & Hair Analysis flow
   details + consent → photos → live scan → rich AI report
   (OTP step is currently disabled; /api endpoints remain ready for it) */
(function () {
  "use strict";
  var flow = document.getElementById("aiFlow");
  if (!flow) return;

  var state = { face: "", hair: "", patient: {} };
  var stageTimer = null;
  var lastRep = null;

  var STAGES = [
    "Initialising DermaLuxe AI… · AI సిద్ధమవుతోంది…",
    "Detecting facial landmarks… · ముఖ గుర్తులను గుర్తిస్తోంది…",
    "Analysing skin tone & pigmentation… · పిగ్మెంటేషన్ విశ్లేషణ…",
    "Measuring texture, pores & hydration… · ఆకృతి & తేమ కొలత…",
    "Evaluating hair density & scalp… · జుట్టు దట్టత్వం అంచనా…",
    "Estimating skin age… · స్కిన్ ఏజ్ అంచనా…",
    "Preparing your personalised report… · మీ నివేదిక సిద్ధమవుతోంది…"
  ];

  var METRICS = [
    ["hydration", "Hydration · తేమ"],
    ["texture", "Texture · ఆకృతి"],
    ["pigmentation", "Pigmentation · పిగ్మెంటేషన్"],
    ["acne", "Acne Clarity · మొటిమలు"],
    ["wrinkles", "Youthfulness · ముడతలు"],
    ["dark_circles", "Under-Eye · డార్క్ సర్కిల్స్"],
    ["pores", "Pores · రంధ్రాలు"],
    ["redness", "Calmness · ఎరుపుదనం"],
    ["hair_density", "Hair Density · జుట్టు దట్టత్వం"],
    ["scalp_health", "Scalp Health · తలచర్మం"]
  ];

  function $(id) { return document.getElementById(id); }
  function note(id, msg, ok) {
    var el = $(id);
    el.textContent = msg || "";
    el.className = "form__note" + (msg ? (ok ? " ok" : " err") : "");
  }
  function goStep(n) {
    flow.querySelectorAll(".ai-pane").forEach(function (p) { p.hidden = p.dataset.pane !== String(n); });
    flow.querySelectorAll(".ai-step").forEach(function (s) {
      s.classList.toggle("is-active", Number(s.dataset.step) <= n);
    });
    flow.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }
  function sendLead(extra) {
    try {
      var lead = Object.assign({ page: location.href }, state.patient, extra || {});
      api("/api/lead", lead).catch(function () {});
    } catch (e) {}
  }
  function startStages() {
    var i = 0;
    $("aiStage").textContent = STAGES[0];
    stageTimer = setInterval(function () {
      i = Math.min(i + 1, STAGES.length - 1);
      $("aiStage").textContent = STAGES[i];
      if (i === STAGES.length - 1) clearInterval(stageTimer);
    }, 2200);
  }
  function stopStages() { if (stageTimer) { clearInterval(stageTimer); stageTimer = null; } }

  /* ---- open flow ---- */
  $("aiStartBtn").addEventListener("click", function () {
    flow.hidden = false;
    goStep(1);
  });

  /* ---- step 1: details + consent ---- */
  $("aiContinue").addEventListener("click", function () {
    var name = $("aiName").value.trim();
    var phone = $("aiPhone").value.replace(/\D/g, "");
    var age = $("aiAge").value.trim();
    var gender = $("aiGender").value;
    var concern = $("aiConcern").value;

    if (!name || !phone || !age || !gender || !concern) {
      return note("aiNote1", "Please fill all details. · అన్ని వివరాలు నింపండి.");
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return note("aiNote1", "Enter a valid 10-digit mobile number. · సరైన మొబైల్ నంబర్ ఇవ్వండి.");
    }
    if (!$("aiConsent1").checked || !$("aiConsent2").checked) {
      return note("aiNote1", "Please accept both consent boxes to continue. · రెండు సమ్మతులు ఇవ్వండి.");
    }

    state.patient = { name: name, age: age, gender: gender, concern: concern, phone: phone, consent: true, consentTime: new Date().toISOString() };
    note("aiNote1", "");
    sendLead({ type: "ai_lead" });
    goStep(2);
  });

  /* ---- step 2: photos ---- */
  function wireUpload(inputId, previewId, labelId, key) {
    $(inputId).addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var img = new Image();
      var reader = new FileReader();
      reader.onload = function () {
        img.onload = function () {
          var max = 1280;
          var sc = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement("canvas");
          c.width = Math.round(img.width * sc);
          c.height = Math.round(img.height * sc);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          var dataUrl = c.toDataURL("image/jpeg", 0.85);
          state[key] = dataUrl;
          $(previewId).src = dataUrl;
          $(previewId).hidden = false;
          $(labelId).style.display = "none";
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  wireUpload("aiFaceInput", "aiFacePreview", "aiFaceLabel", "face");
  wireUpload("aiHairInput", "aiHairPreview", "aiHairLabel", "hair");

  $("aiAnalyze").addEventListener("click", function () {
    if (!state.face) return note("aiNote3", "Please upload a clear face photo. · ముఖం ఫోటో అప్‌లోడ్ చేయండి.");
    goStep(3);
    $("aiScanImg").src = state.face;
    $("aiAnalyzing").hidden = false;
    $("aiReport").hidden = true;
    startStages();
    api("/api/analyze", { patient: state.patient, faceImage: state.face, hairImage: state.hair || undefined })
      .then(function (r) {
        stopStages();
        $("aiAnalyzing").hidden = true;
        if (!r.ok || !r.data.report) {
          $("aiReport").hidden = false;
          $("aiReport").innerHTML = '<p class="form__note err" style="text-align:left">' +
            (r.data.error || "Analysis failed — please try again.") + "</p>" +
            '<button type="button" class="btn btn--ghost" onclick="location.hash=\'#ai-analysis\';location.reload()">Try again</button>';
          return;
        }
        renderReport(r.data.report);
      })
      .catch(function () {
        stopStages();
        $("aiAnalyzing").hidden = true;
        $("aiReport").hidden = false;
        $("aiReport").innerHTML = '<p class="form__note err" style="text-align:left">Network error — please try again.</p>';
      });
  });

  /* ---- step 3: render report ---- */
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }

  function history() {
    try { return JSON.parse(localStorage.getItem("dl_ai_history") || "[]"); } catch (e) { return []; }
  }
  function saveHistory(rep) {
    try {
      var h = history();
      h.push({ t: Date.now(), skin: rep.skin_score, hair: rep.hair_score });
      localStorage.setItem("dl_ai_history", JSON.stringify(h.slice(-12)));
    } catch (e) {}
  }
  function delta(cur, prevVal) {
    if (cur == null || prevVal == null) return "";
    var d = Math.round(cur - prevVal);
    if (!d) return ' <span class="ai-delta">= same as last scan</span>';
    return d > 0
      ? ' <span class="ai-delta ai-delta--up">▲ +' + d + ' vs last scan</span>'
      : ' <span class="ai-delta ai-delta--down">▼ ' + d + ' vs last scan</span>';
  }
  function scoreBar(label, score, dHtml) {
    if (score == null) return "";
    var pct = Math.max(0, Math.min(100, Number(score)));
    return '<div class="ai-score"><div class="ai-score__head"><span>' + label + '</span><b>' + pct + '/100</b></div>' +
      '<div class="ai-score__bar"><i style="width:' + pct + '%"></i></div>' + (dHtml || "") + "</div>";
  }
  function metricBars(m) {
    if (!m) return "";
    var out = "";
    METRICS.forEach(function (pair) {
      var v = m[pair[0]];
      if (v == null || isNaN(Number(v))) return;
      var pct = Math.max(0, Math.min(100, Number(v)));
      var cls = pct >= 70 ? "good" : pct >= 45 ? "mid" : "low";
      out += '<div class="ai-metric"><div class="ai-metric__head"><span>' + pair[1] + '</span><b>' + pct + '</b></div>' +
        '<div class="ai-metric__bar ai-metric__bar--' + cls + '"><i style="width:' + pct + '%"></i></div></div>';
    });
    return out ? '<h4>Detailed Metrics · వివరమైన కొలతలు</h4><div class="ai-metrics">' + out + "</div>" : "";
  }
  function findings(title, list) {
    if (!list || !list.length) return "";
    return '<h4>' + title + '</h4><ul class="ai-findings">' + list.map(function (f) {
      return '<li><span class="ai-sev ai-sev--' + esc(f.severity || "mild") + '">' + esc(f.severity || "") + "</span><b>" + esc(f.name) + "</b> — " + esc(f.note || "") + "</li>";
    }).join("") + "</ul>";
  }

  function renderReport(rep) {
    var prev = history().slice(-1)[0] || {};
    var chips = "";
    if (rep.skin_age != null) chips += '<span class="ai-chiplet">Skin Age · స్కిన్ ఏజ్ <b>' + esc(rep.skin_age) + "</b></span>";
    if (rep.skin_type) chips += '<span class="ai-chiplet">Skin Type · రకం <b>' + esc(rep.skin_type) + "</b></span>";

    var waText = encodeURIComponent(
      "Hi DermaLuxe! I completed the AI Skin & Hair Analysis on dermaluxe.ai.\n" +
      "Name: " + state.patient.name + "\nPhone: " + state.patient.phone +
      "\nAge/Gender: " + state.patient.age + " / " + state.patient.gender +
      "\nConcern: " + state.patient.concern +
      (rep.skin_score != null ? "\nSkin score: " + rep.skin_score : "") +
      (rep.hair_score != null ? "\nHair score: " + rep.hair_score : "") +
      (rep.skin_age != null ? "\nSkin age: " + rep.skin_age : "") +
      (rep.skin_type ? "\nSkin type: " + rep.skin_type : "") +
      "\nSuggested: " + (rep.suggested_treatments || []).join(", ") +
      "\nPlease book my consultation.");

    var html = '<div class="ai-report" id="aiReportCard">' +
      '<div class="ai-report__head">' +
        '<img class="ai-report__thumb" src="' + state.face + '" alt="" />' +
        '<div><h3>Your AI Report <span class="te">· మీ AI నివేదిక</span></h3>' +
        '<p class="ai-report__meta">' + esc(state.patient.name) + " · " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) + "</p>" +
        (chips ? '<div class="ai-chiplets">' + chips + "</div>" : "") + "</div></div>" +
      '<div class="ai-scores">' +
        scoreBar("Skin Health · చర్మం", rep.skin_score, delta(rep.skin_score, prev.skin)) +
        scoreBar("Hair Health · జుట్టు", rep.hair_score, delta(rep.hair_score, prev.hair)) + "</div>" +
      (rep.summary_en ? "<p class='ai-summary'>" + esc(rep.summary_en) + "</p>" : "") +
      (rep.summary_te ? "<p class='ai-summary te tsub'>" + esc(rep.summary_te) + "</p>" : "") +
      metricBars(rep.metrics) +
      findings("Skin Findings · చర్మ పరిశీలనలు", rep.skin_findings) +
      findings("Hair Findings · జుట్టు పరిశీలనలు", rep.hair_findings) +
      (rep.recommendations && rep.recommendations.length ? "<h4>Care Tips · సంరక్షణ సూచనలు</h4><ul class='ticklist'>" + rep.recommendations.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
      (rep.suggested_treatments && rep.suggested_treatments.length ? "<h4>Suggested Treatments at DermaLuxe</h4><div class='ai-treats'>" + rep.suggested_treatments.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>" : "") +
      '<p class="ai-disclaimer">' + esc(rep.disclaimer || "") + "</p>" +
      '<div class="ai-actions">' +
        '<a class="btn btn--gold btn--bi" target="_blank" rel="noopener" href="https://wa.me/919949134666?text=' + waText + '"><span>Book Consultation with this Report</span><span class="te">ఈ నివేదికతో బుక్ చేయండి</span></a>' +
        '<button type="button" class="btn btn--ghost" id="aiPrint">Download / Print Report</button>' +
        '<button type="button" class="btn btn--ghost" id="aiAgain">New Analysis</button>' +
      "</div></div>";

    $("aiReport").innerHTML = html;
    $("aiReport").hidden = false;
    lastRep = rep;
    saveHistory(rep);
    sendLead({
      type: "ai_report",
      skin_score: rep.skin_score, hair_score: rep.hair_score,
      skin_age: rep.skin_age, skin_type: rep.skin_type,
      treatments: rep.suggested_treatments || []
    });

    $("aiPrint").addEventListener("click", printReport);
    $("aiAgain").addEventListener("click", function () {
      location.hash = "#ai-analysis";
      location.reload();
    });
  }

  /* ---- printable report (opens a clean dedicated window; 1-2 pages) ---- */
  function printReport() {
    if (!lastRep) return;
    var w = window.open("", "_blank", "width=840,height=980");
    if (!w) { alert("Please allow pop-ups to download your report."); return; }
    w.document.write(buildPrintHTML(lastRep));
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 500);
  }

  function buildPrintHTML(rep) {
    var p = state.patient;
    var gold = "#a87f3c";
    function bar(label, val) {
      if (val == null || isNaN(Number(val))) return "";
      var pct = Math.max(0, Math.min(100, Number(val)));
      return '<div class="m"><div class="mh"><span>' + esc(label) + "</span><b>" + pct + "</b></div>" +
        '<div class="mb"><i style="width:' + pct + '%"></i></div></div>';
    }
    var metricsHtml = "";
    METRICS.forEach(function (pair) {
      if (rep.metrics) metricsHtml += bar(pair[1].split("·")[0].trim(), rep.metrics[pair[0]]);
    });
    function list(title, arr, fmt) {
      if (!arr || !arr.length) return "";
      return "<h3>" + title + "</h3><ul>" + arr.map(fmt).join("") + "</ul>";
    }
    var findingsF = function (f) {
      return "<li><b>" + esc(f.name) + "</b> <em class='sev'>(" + esc(f.severity || "") + ")</em> — " + esc(f.note || "") + "</li>";
    };
    var html =
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>DermaLuxe AI Report — " + esc(p.name) + "</title><style>" +
      "@page{size:A4;margin:14mm}" +
      "*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      "body{font-family:Georgia,'Times New Roman',serif;color:#1c1c1c;font-size:12.5px;line-height:1.55;padding:24px}" +
      ".hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid " + gold + ";padding-bottom:14px;margin-bottom:16px}" +
      ".brand{font-size:26px;letter-spacing:1px;color:" + gold + ";font-weight:700}" +
      ".brand small{display:block;font-size:11px;color:#555;letter-spacing:2px;font-weight:400;margin-top:2px;text-transform:uppercase}" +
      ".rtitle{font-size:13px;color:#555;text-align:right}.rtitle b{display:block;font-size:15px;color:#1c1c1c}" +
      ".pt{display:flex;gap:16px;align-items:center;background:#faf6ee;border:1px solid #e7dcc4;border-radius:8px;padding:12px 16px;margin-bottom:16px}" +
      ".pt img{width:64px;height:78px;object-fit:cover;border-radius:6px;border:1px solid #d9c9a6}" +
      ".pt table{font-size:12.5px;border-collapse:collapse}.pt td{padding:2px 18px 2px 0;color:#444}.pt td b{color:#111}" +
      ".chips{margin:0 0 14px}.chip{display:inline-block;border:1px solid " + gold + ";color:" + gold + ";border-radius:100px;padding:3px 12px;font-size:11.5px;margin-right:8px}" +
      ".scores{display:flex;gap:24px;margin-bottom:14px}.sc{flex:1}" +
      ".sc .mh,.m .mh{display:flex;justify-content:space-between;font-size:11.5px;color:#444;margin-bottom:3px}.mh b{color:" + gold + "}" +
      ".sc .mb,.m .mb{height:8px;background:#eee8da;border-radius:8px;overflow:hidden;border:1px solid #e3d9c2}" +
      ".sc .mb i,.m .mb i{display:block;height:100%;background:" + gold + "}" +
      ".mgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 26px;margin-bottom:6px}" +
      "h3{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:" + gold + ";margin:16px 0 7px;border-bottom:1px solid #eadfc8;padding-bottom:3px}" +
      "p.sum{margin-bottom:6px}ul{padding-left:18px}li{margin-bottom:4px}.sev{color:#8a6d3b;font-style:normal;font-size:11px}" +
      ".treats span{display:inline-block;background:#faf6ee;border:1px solid #e0d3b3;border-radius:100px;padding:3px 12px;font-size:11.5px;margin:0 6px 6px 0;color:#6b5322}" +
      ".disc{font-size:10.5px;color:#777;font-style:italic;margin-top:14px;border-top:1px solid #eee;padding-top:8px}" +
      ".ftr{margin-top:16px;border-top:2.5px solid " + gold + ";padding-top:10px;font-size:11px;color:#555;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}" +
      "</style></head><body>" +
      '<div class="hdr"><div class="brand">DermaLuxe<small>by Medicare · Premium Skin, Hair &amp; Aesthetics</small></div>' +
      '<div class="rtitle"><b>AI Skin &amp; Hair Analysis Report</b>' + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) + "</div></div>" +
      '<div class="pt">' + (state.face ? '<img src="' + state.face + '" alt="" />' : "") +
      "<table><tr><td>Name: <b>" + esc(p.name) + "</b></td><td>Age / Gender: <b>" + esc(p.age) + " / " + esc(p.gender) + "</b></td></tr>" +
      "<tr><td>Phone: <b>" + esc(p.phone) + "</b></td><td>Primary Concern: <b>" + esc(p.concern) + "</b></td></tr></table></div>" +
      '<div class="chips">' +
      (rep.skin_age != null ? '<span class="chip">Skin Age: ' + esc(rep.skin_age) + "</span>" : "") +
      (rep.skin_type ? '<span class="chip">Skin Type: ' + esc(rep.skin_type) + "</span>" : "") + "</div>" +
      '<div class="scores">' +
      (rep.skin_score != null ? '<div class="sc"><div class="mh"><span>Skin Health</span><b>' + rep.skin_score + '/100</b></div><div class="mb"><i style="width:' + rep.skin_score + '%"></i></div></div>' : "") +
      (rep.hair_score != null ? '<div class="sc"><div class="mh"><span>Hair Health</span><b>' + rep.hair_score + '/100</b></div><div class="mb"><i style="width:' + rep.hair_score + '%"></i></div></div>' : "") + "</div>" +
      (rep.summary_en ? '<p class="sum">' + esc(rep.summary_en) + "</p>" : "") +
      (rep.summary_te ? '<p class="sum">' + esc(rep.summary_te) + "</p>" : "") +
      (metricsHtml ? "<h3>Detailed Metrics</h3><div class='mgrid'>" + metricsHtml + "</div>" : "") +
      list("Skin Findings", rep.skin_findings, findingsF) +
      list("Hair Findings", rep.hair_findings, findingsF) +
      list("Care Recommendations", rep.recommendations, function (t) { return "<li>" + esc(t) + "</li>"; }) +
      (rep.suggested_treatments && rep.suggested_treatments.length ? "<h3>Suggested Treatments at DermaLuxe</h3><div class='treats'>" + rep.suggested_treatments.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>" : "") +
      '<p class="disc">' + esc(rep.disclaimer || "This AI pre-assessment is for informational purposes only and is not a medical diagnosis.") + "</p>" +
      '<div class="ftr"><span>DermaLuxeAI Private Limited · Rama Mahal, Ramachandra Rao Peta, Kasturi Vari Street, Eluru – 534002</span>' +
      "<span>+91 99491 34666 · www.dermaluxe.ai</span></div>" +
      "</body></html>";
    return html;
  }
})();
