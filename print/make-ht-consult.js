// Hair consultation form, A4, three pages. Re-run:
//   node print/make-ht-consult.js   →  print/ht-consultation-form.pdf
//
// Owner, 9 Nov 2026: the competitor's two-page consultation sheet, under the
// DermaLuxe name. Page 1 is the intake the receptionist hands over on the
// first visit; pages 2 and 3 are the treatment plan and cost — the original
// had only a clinic copy, so a patient copy is added, identical, because the
// person paying ₹59,999 should walk out holding the plan they agreed to.
// "How did you hear about us" lists where this clinic's patients actually
// come from (Instagram and WhatsApp, not LinkedIn), and PRP/GFC is a
// treatment option because the clinic offers it.
const path = require("path");
const { box, line, date, o, HEAD, page, bar, render, CLINIC } = require("./ht-forms-lib.js");

const INTAKE = page("Consultation Form", `
  <div class="row"><span class="lbl">Date:</span>${date()}<span class="lbl r">Patient ID:</span>${box("30%")}</div>
  <div class="row"><span class="lbl">Name:</span>${line("84%")}</div>
  <div class="row"><span class="lbl">Age:</span>${line("12%")}<span class="lbl r">Sex:</span>${line("12%")}<span class="lbl r">Mob. No:</span>${line("22%")}<span class="lbl r">WhatsApp No:</span>${line("22%")}</div>
  <div class="row"><span class="lbl">Address:</span>${line("82%")}</div>
  <div class="row"><span class="lbl">Email:</span>${line("40%")}<span class="lbl r">Occupation:</span>${line("34%")}</div>
  <h4 class="c">Which treatment are you looking for?</h4>
  <div class="row gap wrap">${o("Hair Transplant")}${o("Beard Transplant")}${o("Eyebrow Reconstruction")}${o("Hair Loss")}${o("PRP / GFC")}${o("Other")}</div>
  <hr>
  <div class="row gap"><span class="lbl">Are you on any kind of medication?</span>${o("Yes")}${o("No")}</div>
  <div class="row"><span class="lbl">If yes, please specify your medications:</span>${line("54%")}</div>
  <div class="row gap"><span class="lbl">Any known allergies?</span>${o("Yes")}${o("No")}<span class="lbl">If yes:</span>${line("40%")}</div>
  <div class="row gap"><span class="lbl">Are you diabetic?</span>${o("Yes")}${o("No")}<span class="lbl" style="margin-left:10mm">Hypertensive?</span>${o("Yes")}${o("No")}</div>
  <div class="row gap"><span class="lbl">Do you smoke?</span>${o("Yes")}${o("No")}<span class="lbl" style="margin-left:6mm">Drink?</span>${o("Yes")}${o("No")}<span class="lbl" style="margin-left:6mm">Tobacco?</span>${o("Yes")}${o("No")}</div>
  <div class="row gap"><span class="lbl">Family history of hair loss?</span>${o("Yes")}${o("No")}<span class="lbl">Since how long are you losing hair?</span>${line("22%")}</div>
  <hr>
  <div class="row gap"><span class="lbl">Have you consulted before for any kind of hair treatment?</span>${o("Yes")}${o("No")}</div>
  <div class="row"><span class="lbl">If yes, specify the clinic name &amp; treatment taken:</span>${line("50%")}</div>
  <hr>
  <p><b>How did you hear about ${CLINIC}?</b></p>
  <div class="row gap wrap">${o("Google")}${o("Instagram")}${o("Facebook")}${o("WhatsApp")}${o("Friend / Relative")}${o("Hoarding / Poster")}${o("Others")}</div>
  <div class="row"><span class="lbl">Other, specify:</span>${line("60%")}</div>
  <div class="spacer"></div>
  <p class="note">The information given above is true to the best of my knowledge. I understand that the doctor's advice depends on it.</p>
  <div class="row"><span class="lbl">Patient's Signature:</span>${line("36%")}<span class="lbl r">Received by:</span>${line("28%")}</div>`);

const PLAN = (copy) => page("Treatment Plan and Cost", `
  <h3 class="c">TREATMENT PLAN</h3>
  <div class="pill-ttl sm" style="margin-top:0">${copy}</div>
  <div class="row"><span class="lbl">Patient Name:</span>${line("50%")}<span class="lbl r">Date:</span>${date()}</div>
  <div class="row"><span class="lbl">Grade of Baldness:</span>${box("34%")}</div>
  <div class="row gap"><span class="lbl">Donor Area Density:</span>${o("LOW")}${o("MEDIUM")}${o("HIGH")}</div>
  <div class="row"><span class="lbl">Area 1</span>${box("13%")}<span class="lbl r">Area 2</span>${box("13%")}<span class="lbl r">Area 3</span>${box("13%")}<span class="lbl r">Area 4</span>${box("13%")}</div>
  <div class="row"><span class="lbl">Area 5</span>${box("13%")}<span class="lbl" style="margin-left:5mm">Area 6</span>${box("13%")}<span class="lbl" style="margin-left:5mm">Area 7</span>${box("13%")}</div>
  <div class="row"><span class="lbl">Total No. of Grafts:</span>${box("30%")}<span class="lbl r">No. of Sessions required:</span>${box("16%")}</div>
  <div class="row"><span class="lbl">Technique:</span>${o("FUE")}${o("DHI")}${o("Bio-FUE (PRP/GFC)")}</div>
  <div class="row top"><span class="lbl">Package Offered:</span><span class="bx tall" style="width:80%"></span></div>
  <div class="row"><span class="lbl">Package Cost:</span>${box("26%")}<span class="lbl r">Extra grafts (if any) @ ₹</span>${box("12%")}<span class="lbl">per graft</span></div>
  <div class="row"><span class="lbl">Advance Paid:</span>${box("22%")}<span class="lbl r">Balance:</span>${box("22%")}<span class="lbl r">Procedure Date:</span>${date()}</div>
  <p><b>Baldness areas to be covered:</b></p>
  ${HEAD}
  <p class="note">The graft count, the number of sessions and the package are the doctor's estimate after examining the scalp. Results differ from person to person; no result is promised.</p>
  <div class="row"><span class="lbl">Consultant's Name:</span>${line("46%")}<span class="lbl r">Signature:</span>${line("26%")}</div>
  <div class="row"><span class="lbl">Patient's Name:</span>${line("46%")}<span class="lbl r">Signature:</span>${line("26%")}</div>`);

render([INTAKE, PLAN("CLINIC COPY"), PLAN("PATIENT COPY")], path.join(__dirname, "ht-consultation-form.pdf"));
