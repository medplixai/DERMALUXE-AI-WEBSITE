// Hair transplant patient instructions, two one-page A4 handouts, each in
// English and in Telugu. Re-run:
//   node print/make-ht-instructions.js
//     →  print/ht-pre-surgery.pdf        ht-pre-surgery-te.pdf
//     →  print/ht-post-surgery.pdf       ht-post-surgery-te.pdf
//
// Owner, 9 Nov 2026: two handwritten sheets from the surgeon, wanted as
// separate point-wise PDFs under the DermaLuxe logo, then "telugu version
// kuda" the same evening. The wording is the surgeon's; the durations are
// set in bold because they are what the patient has to remember. Each sheet
// has the patient's name and date at the top so the copy in their hand is
// theirs, and a tick box per point for the nurse who reads it out.
//
// The Telugu edition is a translation of the same points, not a different
// sheet: the numbers, durations and the order are identical, so a nurse can
// read either one against the other.
const path = require("path");
const { line, date, page, render } = require("./ht-forms-lib.js");

const build = (te) => {
  const T = (en, tel) => (te ? tel : en);
  const pts = (items) => `<ol class="pts">${items.map((t) => `<li><span class="tk"></span><span>${t}</span></li>`).join("")}</ol>`;
  const top = (label) => `<div class="row"><span class="lbl">${T("Patient Name:", "పేషెంట్ పేరు:")}</span>${line("46%")}<span class="lbl r">${label}:</span>${date()}</div>`;
  const call = `<div class="framed call"><b>${T("Any doubt, bleeding, severe pain, fever or swelling — call us at once.", "ఏదైనా సందేహం, రక్తస్రావం, తీవ్రమైన నొప్పి, జ్వరం లేదా వాపు ఉంటే — వెంటనే కాల్ చేయండి.")}</b><br>${T("Call", "కాల్")} <b>99491 34666</b> · WhatsApp <b>99591 34666</b> · ${T("open 9 AM – 9 PM, Monday to Saturday", "ఉదయం 9 – రాత్రి 9, సోమవారం నుంచి శనివారం")}</div>`;
  const cls = "hand tight" + (te ? " te-sheet" : "");

  const PRE = page(T("Pre-Surgery Protocol", "సర్జరీకి ముందు సూచనలు"), `
  <div class="pill-ttl">${T("BEFORE YOUR HAIR TRANSPLANT", "మీ హెయిర్ ట్రాన్స్‌ప్లాంట్‌కు ముందు")}</div>
  ${top(T("Procedure Date", "ప్రొసీజర్ తేదీ"))}
  <p class="lead">${T("Please follow every point below. They keep the procedure safe and help the grafts take well.", "దయచేసి కింది ప్రతి సూచనా పాటించండి. ఇవి ప్రొసీజర్‌ను సురక్షితంగా, గ్రాఫ్ట్‌లు బాగా నిలిచేలా చేస్తాయి.")}</p>
  ${pts([
    T("Avoid <b>alcohol, smoking and multivitamins</b> for <b>72 hours</b> before the surgery.", "సర్జరీకి <b>72 గంటల</b> ముందు నుంచి <b>మద్యం, పొగ తాగడం, మల్టీవిటమిన్ మాత్రలు</b> మానేయండి."),
    T("If you are using <b>minoxidil</b>, stop it <b>7 days</b> before the surgery.", "<b>మినాక్సిడిల్</b> వాడుతుంటే సర్జరీకి <b>7 రోజుల</b> ముందు ఆపేయండి."),
    T("Inform the doctor about <b>all medications</b> you take. Do <b>not</b> stop any prescribed medicine without the doctor's approval.", "మీరు వాడే <b>అన్ని మందుల</b> గురించి డాక్టర్‌కు చెప్పండి. డాక్టర్ అనుమతి లేకుండా ఏ మందూ <b>ఆపవద్దు</b>."),
    T("Do <b>not</b> trim or shave your head.", "తల వెంట్రుకలు <b>కత్తిరించవద్దు, షేవ్ చేయవద్దు</b>."),
    T("Colour grey / white hairs <b>2 days</b> before the surgery.", "నెరిసిన / తెల్ల వెంట్రుకలకు సర్జరీకి <b>2 రోజుల</b> ముందు రంగు వేసుకోండి."),
    T("Arrange transport. Do <b>not</b> drive yourself on the day.", "రాకపోకలకు ఏర్పాటు చేసుకోండి. ఆ రోజు <b>మీరే వాహనం నడపవద్దు</b>."),
    T("Avoid the gym for <b>48 hours</b> before the surgery.", "సర్జరీకి <b>48 గంటల</b> ముందు నుంచి జిమ్ చేయవద్దు."),
    T("If the chest is used as a donor area, trim it <b>7 days</b> before.", "ఛాతీ నుంచి గ్రాఫ్ట్‌లు తీసుకోవాల్సి వస్తే, <b>7 రోజుల</b> ముందు ట్రిమ్ చేసుకోండి."),
    T("Wear a <b>button-down shirt</b> on the day — nothing that has to be pulled over the head.", "ఆ రోజు <b>ముందు బటన్లు ఉన్న షర్ట్</b> వేసుకోండి — తల మీదుగా తీయాల్సినవి వద్దు."),
    T("Have a proper, heavy <b>breakfast</b> on the day of the procedure.", "ప్రొసీజర్ రోజు ఉదయం కడుపు నిండా <b>అల్పాహారం</b> తీసుకోండి."),
    T("Submit your <b>investigation / test reports</b> at least <b>5 days</b> before the scheduled procedure date.", "మీ <b>పరీక్ష రిపోర్టులు</b> ప్రొసీజర్ తేదీకి కనీసం <b>5 రోజుల</b> ముందు అందజేయండి."),
    T("Get a minimum of <b>8 hours of sleep</b> the night before the procedure.", "ముందు రోజు రాత్రి కనీసం <b>8 గంటలు నిద్ర</b> పోండి."),
    T("Wash your hair thoroughly on the <b>morning of the surgery</b>. Do not apply hair gel, oil, wax or any other styling product.", "<b>సర్జరీ రోజు ఉదయం</b> తల బాగా స్నానం చేయండి. జెల్, నూనె, వ్యాక్స్ లాంటివి ఏవీ రాయవద్దు."),
    T("Reach the clinic at the <b>instructed time</b> and carry your relevant medical prescriptions and reports.", "<b>చెప్పిన సమయానికి</b> క్లినిక్‌కు రండి. మీ మెడికల్ ప్రిస్క్రిప్షన్లు, రిపోర్టులు తీసుకురండి."),
  ])}
  ${call}
  <div class="row sig"><span class="lbl">${T("Explained by:", "వివరించినవారు:")}</span>${line("30%")}<span class="lbl r">${T("Patient's Signature:", "పేషెంట్ సంతకం:")}</span>${line("30%")}</div>`, cls);

  const POST = page(T("Post-Surgery Discharge", "సర్జరీ తర్వాత సూచనలు"), `
  <div class="pill-ttl">${T("AFTER YOUR HAIR TRANSPLANT", "మీ హెయిర్ ట్రాన్స్‌ప్లాంట్ తర్వాత")}</div>
  ${top(T("Date of Surgery", "సర్జరీ తేదీ"))}
  <p class="lead">${T("The first <b>10 days</b> decide how well the grafts settle. Please follow every point below.", "మొదటి <b>10 రోజులు</b> గ్రాఫ్ట్‌లు నిలవడానికి చాలా ముఖ్యం. దయచేసి కింది ప్రతి సూచనా పాటించండి.")}</p>
  ${pts([
    T("Do <b>not</b> touch or rub the transplanted area for <b>10 days</b>.", "<b>10 రోజుల</b> వరకు ట్రాన్స్‌ప్లాంట్ చేసిన భాగాన్ని <b>తాకవద్దు, రుద్దవద్దు</b>."),
    T("Avoid heavy workout / exercise for <b>1 month</b>.", "<b>1 నెల</b> వరకు భారీ వ్యాయామం / కసరత్తులు వద్దు."),
    T("Avoid direct sunlight and dust exposure for <b>10 days</b>.", "<b>10 రోజుల</b> వరకు నేరుగా ఎండ, దుమ్ము తగలకుండా చూసుకోండి."),
    T("Avoid spicy, hard, excessively hot food and red meat for <b>15 days</b>.", "<b>15 రోజుల</b> వరకు కారం, గట్టి పదార్థాలు, మరీ వేడి ఆహారం, రెడ్ మీట్ వద్దు."),
    T("Use <b>only the clinic-provided surgical cap</b>, as instructed.", "<b>క్లినిక్ ఇచ్చిన సర్జికల్ క్యాప్ మాత్రమే</b>, చెప్పిన విధంగా వాడండి."),
    T("Spray <b>normal saline (NS)</b> on the grafts <b>every hour</b> for <b>10 days</b>.", "<b>10 రోజుల</b> పాటు <b>ప్రతి గంటకు</b> గ్రాఫ్ట్‌ల మీద <b>నార్మల్ సెలైన్ (NS)</b> స్ప్రే చేయండి."),
    T("For <b>10 days</b>, bathe only <b>below the neck</b>. Avoid direct water on the grafts.", "<b>10 రోజుల</b> వరకు <b>మెడ కింద మాత్రమే</b> స్నానం చేయండి. గ్రాఫ్ట్‌ల మీద నేరుగా నీళ్లు పడకూడదు."),
    T("Avoid smoking and alcohol for <b>10 days</b>.", "<b>10 రోజుల</b> వరకు పొగ తాగడం, మద్యం వద్దు."),
    T("Avoid helmets for <b>1 month</b>.", "<b>1 నెల</b> వరకు హెల్మెట్ వద్దు."),
    T("Avoid hair oil and hair cuts for <b>6 months</b>.", "<b>6 నెలల</b> వరకు తలకు నూనె, హెయిర్ కట్ వద్దు."),
    T("Attend <b>all scheduled follow-ups</b> and follow your doctor's instructions.", "చెప్పిన <b>అన్ని ఫాలో-అప్‌లకు</b> తప్పకుండా రండి. డాక్టర్ సూచనలు పాటించండి."),
  ])}
  <div class="row fu"><span class="lbl">${T("Next follow-up:", "తదుపరి ఫాలో-అప్:")}</span>${date()}<span class="lbl" style="margin-left:6mm">${T("Time:", "సమయం:")}</span>${line("18%")}<span class="lbl r">${T("Medicines given as per prescription", "ప్రిస్క్రిప్షన్ ప్రకారం మందులు ఇచ్చాం")}</span><span class="tk"></span></div>
  ${call}
  <div class="row sig"><span class="lbl">${T("Discharged by:", "డిశ్చార్జ్ చేసినవారు:")}</span>${line("30%")}<span class="lbl r">${T("Patient's Signature:", "పేషెంట్ సంతకం:")}</span>${line("30%")}</div>`, cls);

  return { PRE, POST };
};

// The handouts set their own list style on top of the shared sheet: a gold
// numbered circle, a tick box, and body text a size larger than the forms,
// because a patient reads this at home, not across a reception desk. The
// Telugu sheet drops all letter-spacing (Chrome breaks conjuncts with it)
// and takes a taller line.
const EXTRA = `
  .hand { font-size: 11pt; }
  .hand .lead { margin: 2mm 0 3mm; color: #3d2a16; }
  .pts { list-style: none; counter-reset: p; margin: 0; padding: 0; }
  .pts li { counter-increment: p; display: flex; align-items: flex-start; gap: 3mm; padding: 2.4mm 0; border-bottom: 1px solid #ebdfc6; line-height: 1.42; }
  .pts li::before { content: counter(p); flex: 0 0 7mm; height: 7mm; border-radius: 50%; background: var(--gold); color: #fff; font-weight: 700; font-size: 10pt; display: flex; align-items: center; justify-content: center; margin-top: .3mm; font-family: Jost, Arial, sans-serif; }
  .pts li span:last-child { flex: 1; }
  .tk { flex: 0 0 5.5mm; width: 5.5mm; height: 5.5mm; border: 1.2px solid var(--ink); border-radius: 1.2mm; display: inline-block; margin-top: 1mm; }
  .hand .call { margin: 4mm 0 2mm; text-align: center; font-size: 10pt; line-height: 1.5; }
  .hand .call b:first-child { color: var(--brown); }
  .hand .sig { margin-top: 6mm; }
  .hand .fu { margin-top: 4mm; }
  .tight { font-size: 10.4pt; } .tight .pts li { padding: 1.7mm 0; line-height: 1.36; } .tight .pill-ttl { margin: 2mm auto 3mm; } .tight .lead { margin: 1mm 0 2mm; } .tight .call { margin: 3mm 0 1mm; } .tight .sig { margin-top: 4mm; }
  .te-sheet, .te-sheet .lbl, .te-sheet .pill-ttl, .te-sheet .call { font-family: "Noto Sans Telugu", Jost, sans-serif; letter-spacing: 0; }
  .te-sheet { font-size: 10pt; }
  .te-sheet .pts li { line-height: 1.6; padding: 1.5mm 0; }
  .te-sheet .pill-ttl { font-size: 11pt; padding: 2mm 8mm; }
  .te-sheet .lead { line-height: 1.55; }
  .te-sheet .call { font-size: 9.6pt; line-height: 1.7; }
  .te-sheet .fu .lbl, .te-sheet .sig .lbl { font-size: 9.6pt; }
  .te-sheet .ttl { font-family: "Noto Sans Telugu", Jost, sans-serif; letter-spacing: 0; text-transform: none; font-size: 10pt; }`;

(async () => {
  const en = build(false), te = build(true);
  await render([en.PRE], path.join(__dirname, "ht-pre-surgery.pdf"), EXTRA);
  await render([en.POST], path.join(__dirname, "ht-post-surgery.pdf"), EXTRA);
  await render([te.PRE], path.join(__dirname, "ht-pre-surgery-te.pdf"), EXTRA);
  await render([te.POST], path.join(__dirname, "ht-post-surgery-te.pdf"), EXTRA);
})();
