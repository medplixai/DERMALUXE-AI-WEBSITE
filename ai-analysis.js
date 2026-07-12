/* DermaLuxe — AI Skin & Hair Analysis flow
   details + consent → photos → live scan → rich AI report
   (OTP step is currently disabled; /api endpoints remain ready for it) */
(function () {
  "use strict";
  var flow = document.getElementById("aiFlow");
  if (!flow) return;

  var state = { face: "", hair: "", patient: {} };
  var stageTimer = null;

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
    saveHistory(rep);

    $("aiPrint").addEventListener("click", function () {
      document.body.classList.add("print-report");
      var cleanup = function () { document.body.classList.remove("print-report"); window.removeEventListener("afterprint", cleanup); };
      window.addEventListener("afterprint", cleanup);
      window.print();
      setTimeout(cleanup, 2000);
    });
    $("aiAgain").addEventListener("click", function () {
      location.hash = "#ai-analysis";
      location.reload();
    });
  }
})();
