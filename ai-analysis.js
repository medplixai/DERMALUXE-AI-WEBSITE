/* DermaLuxe — AI Skin & Hair Analysis flow
   details+consent → OTP → photos → Claude AI report */
(function () {
  "use strict";
  var flow = document.getElementById("aiFlow");
  if (!flow) return;

  var state = { phone: "", token: "", face: "", hair: "", demo: false, patient: {} };

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
  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.orig = btn.innerHTML; btn.innerHTML = "<span>" + (label || "Please wait…") + "</span>"; }
    else if (btn.dataset.orig) { btn.innerHTML = btn.dataset.orig; }
  }
  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  /* ---- open flow ---- */
  $("aiStartBtn").addEventListener("click", function () {
    flow.hidden = false;
    goStep(1);
  });

  /* ---- step 1: details + consent → send OTP ---- */
  $("aiSendOtp").addEventListener("click", function () {
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

    state.phone = phone;
    state.patient = { name: name, age: age, gender: gender, concern: concern, phone: phone, consent: true, consentTime: new Date().toISOString() };

    var btn = $("aiSendOtp");
    busy(btn, true, "Sending OTP…");
    note("aiNote1", "");
    api("/api/send-otp", { phone: phone }).then(function (r) {
      busy(btn, false);
      if (!r.ok) return note("aiNote1", r.data.error || "Could not send OTP. Try again.");
      state.demo = !!r.data.demo;
      $("aiPhoneEcho").textContent = "+91 " + phone;
      goStep(2);
      note("aiNote2", state.demo ? "Demo mode (SMS not configured yet) — use OTP 123456." : "OTP sent to your mobile. · OTP పంపబడింది.", true);
    }).catch(function () { busy(btn, false); note("aiNote1", "Network error — please try again."); });
  });

  /* ---- step 2: verify OTP ---- */
  $("aiEditPhone").addEventListener("click", function () { goStep(1); });
  $("aiResend").addEventListener("click", function () {
    api("/api/send-otp", { phone: state.phone }).then(function (r) {
      note("aiNote2", r.ok ? "OTP re-sent. · మళ్ళీ పంపబడింది." : (r.data.error || "Failed"), r.ok);
    });
  });
  $("aiVerifyOtp").addEventListener("click", function () {
    var code = $("aiOtp").value.replace(/\D/g, "");
    if (code.length < 4) return note("aiNote2", "Enter the OTP. · OTP ఇవ్వండి.");
    var btn = $("aiVerifyOtp");
    busy(btn, true, "Verifying…");
    api("/api/verify-otp", { phone: state.phone, code: code }).then(function (r) {
      busy(btn, false);
      if (!r.ok || !r.data.token) return note("aiNote2", r.data.error || "Incorrect OTP.");
      state.token = r.data.token;
      goStep(3);
    }).catch(function () { busy(btn, false); note("aiNote2", "Network error — please try again."); });
  });

  /* ---- step 3: photos ---- */
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
    goStep(4);
    $("aiAnalyzing").hidden = false;
    $("aiReport").hidden = true;
    api("/api/analyze", { token: state.token, patient: state.patient, faceImage: state.face, hairImage: state.hair || undefined })
      .then(function (r) {
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
        $("aiAnalyzing").hidden = true;
        $("aiReport").hidden = false;
        $("aiReport").innerHTML = '<p class="form__note err" style="text-align:left">Network error — please try again.</p>';
      });
  });

  /* ---- step 4: render report ---- */
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function scoreBar(label, score) {
    if (score == null) return "";
    var pct = Math.max(0, Math.min(100, Number(score)));
    return '<div class="ai-score"><div class="ai-score__head"><span>' + label + '</span><b>' + pct + '/100</b></div>' +
      '<div class="ai-score__bar"><i style="width:' + pct + '%"></i></div></div>';
  }
  function findings(title, list) {
    if (!list || !list.length) return "";
    return '<h4>' + title + '</h4><ul class="ai-findings">' + list.map(function (f) {
      return '<li><span class="ai-sev ai-sev--' + esc(f.severity || "mild") + '">' + esc(f.severity || "") + "</span><b>" + esc(f.name) + "</b> — " + esc(f.note || "") + "</li>";
    }).join("") + "</ul>";
  }
  function renderReport(rep) {
    var waText = encodeURIComponent(
      "Hi DermaLuxe! I completed the AI Skin & Hair Analysis on dermaluxe.ai.\n" +
      "Name: " + state.patient.name + "\nConcern: " + state.patient.concern +
      (rep.skin_score != null ? "\nSkin score: " + rep.skin_score : "") +
      (rep.hair_score != null ? "\nHair score: " + rep.hair_score : "") +
      "\nSuggested: " + (rep.suggested_treatments || []).join(", ") +
      "\nPlease book my consultation.");
    var html = '<div class="ai-report">' +
      '<h3>Your AI Report <span class="te">· మీ AI నివేదిక</span></h3>' +
      '<div class="ai-scores">' + scoreBar("Skin Health · చర్మం", rep.skin_score) + scoreBar("Hair Health · జుట్టు", rep.hair_score) + "</div>" +
      (rep.summary_en ? "<p class='ai-summary'>" + esc(rep.summary_en) + "</p>" : "") +
      (rep.summary_te ? "<p class='ai-summary te tsub'>" + esc(rep.summary_te) + "</p>" : "") +
      findings("Skin Findings · చర్మ పరిశీలనలు", rep.skin_findings) +
      findings("Hair Findings · జుట్టు పరిశీలనలు", rep.hair_findings) +
      (rep.recommendations && rep.recommendations.length ? "<h4>Care Tips · సంరక్షణ సూచనలు</h4><ul class='ticklist'>" + rep.recommendations.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
      (rep.suggested_treatments && rep.suggested_treatments.length ? "<h4>Suggested Treatments at DermaLuxe</h4><div class='ai-treats'>" + rep.suggested_treatments.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>" : "") +
      '<p class="ai-disclaimer">' + esc(rep.disclaimer || "") + "</p>" +
      '<a class="btn btn--gold btn--bi btn--full" target="_blank" rel="noopener" href="https://wa.me/919949134666?text=' + waText + '"><span>Book Consultation with this Report</span><span class="te">ఈ నివేదికతో కన్సల్టేషన్ బుక్ చేయండి</span></a>' +
      "</div>";
    $("aiReport").innerHTML = html;
    $("aiReport").hidden = false;
  }
})();
