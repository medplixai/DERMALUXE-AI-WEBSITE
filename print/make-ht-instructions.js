// Hair transplant patient instructions, two separate one-page A4 handouts.
// Re-run:
//   node print/make-ht-instructions.js
//     →  print/ht-pre-surgery.pdf      (what to do before the procedure)
//     →  print/ht-post-surgery.pdf     (discharge instructions after it)
//
// Owner, 9 Nov 2026: two handwritten sheets from the surgeon, wanted as
// separate point-wise PDFs under the DermaLuxe logo. The wording is the
// surgeon's; the durations are set in bold because they are what the patient
// has to remember. Each sheet has the patient's name and date at the top so
// the copy in their hand is theirs, and a tick box per point for the nurse
// who reads it out at discharge.
const path = require("path");
const { line, date, page, render } = require("./ht-forms-lib.js");

const pts = (items) => `<ol class="pts">${items.map((t) => `<li><span class="tk"></span><span>${t}</span></li>`).join("")}</ol>`;
const top = (label) => `<div class="row"><span class="lbl">Patient Name:</span>${line("46%")}<span class="lbl r">${label}:</span>${date()}</div>`;
const call = `<div class="framed call"><b>Any doubt, bleeding, severe pain, fever or swelling — call us at once.</b><br>Call <b>99491 34666</b> · WhatsApp <b>99591 34666</b> · open 9 AM – 9 PM, Monday to Saturday</div>`;

const PRE = page("Pre-Surgery Protocol", `
  <div class="pill-ttl">BEFORE YOUR HAIR TRANSPLANT</div>
  ${top("Procedure Date")}
  <p class="lead">Please follow every point below. They keep the procedure safe and help the grafts take well.</p>
  ${pts([
    "Avoid <b>alcohol, smoking and multivitamins</b> for <b>72 hours</b> before the surgery.",
    "If you are using <b>minoxidil</b>, stop it <b>7 days</b> before the surgery.",
    "Inform the doctor about <b>all medications</b> you take. Do <b>not</b> stop any prescribed medicine without the doctor's approval.",
    "Do <b>not</b> trim or shave your head.",
    "Colour grey / white hairs <b>2 days</b> before the surgery.",
    "Arrange transport. Do <b>not</b> drive yourself on the day.",
    "Avoid the gym for <b>48 hours</b> before the surgery.",
    "If the chest is used as a donor area, trim it <b>7 days</b> before.",
    "Wear a <b>button-down shirt</b> on the day — nothing that has to be pulled over the head.",
    "Have a proper, heavy <b>breakfast</b> on the day of the procedure.",
    "Submit your <b>investigation / test reports</b> at least <b>5 days</b> before the scheduled procedure date.",
    "Get a minimum of <b>8 hours of sleep</b> the night before the procedure.",
    "Wash your hair thoroughly on the <b>morning of the surgery</b>. Do not apply hair gel, oil, wax or any other styling product.",
    "Reach the clinic at the <b>instructed time</b> and carry your relevant medical prescriptions and reports.",
  ])}
  ${call}
  <div class="row sig"><span class="lbl">Explained by:</span>${line("30%")}<span class="lbl r">Patient's Signature:</span>${line("30%")}</div>`, "hand tight");

const POST = page("Post-Surgery Discharge", `
  <div class="pill-ttl">AFTER YOUR HAIR TRANSPLANT</div>
  ${top("Date of Surgery")}
  <p class="lead">The first <b>10 days</b> decide how well the grafts settle. Please follow every point below.</p>
  ${pts([
    "Do <b>not</b> touch or rub the transplanted area for <b>10 days</b>.",
    "Avoid heavy workout / exercise for <b>1 month</b>.",
    "Avoid direct sunlight and dust exposure for <b>10 days</b>.",
    "Avoid spicy, hard, excessively hot food and red meat for <b>15 days</b>.",
    "Use <b>only the clinic-provided surgical cap</b>, as instructed.",
    "Spray <b>normal saline (NS)</b> on the grafts <b>every hour</b> for <b>10 days</b>.",
    "For <b>10 days</b>, bathe only <b>below the neck</b>. Avoid direct water on the grafts.",
    "Avoid smoking and alcohol for <b>10 days</b>.",
    "Avoid helmets for <b>1 month</b>.",
    "Avoid hair oil and hair cuts for <b>6 months</b>.",
    "Attend <b>all scheduled follow-ups</b> and follow your doctor's instructions.",
  ])}
  <div class="row fu"><span class="lbl">Next follow-up:</span>${date()}<span class="lbl" style="margin-left:6mm">Time:</span>${line("18%")}<span class="lbl r">Medicines given as per prescription</span><span class="tk"></span></div>
  ${call}
  <div class="row sig"><span class="lbl">Discharged by:</span>${line("30%")}<span class="lbl r">Patient's Signature:</span>${line("30%")}</div>`, "hand");

// The handouts set their own list style on top of the shared sheet: a gold
// numbered circle, a tick box, and body text a size larger than the forms,
// because a patient reads this at home, not across a reception desk.
const EXTRA = `
  .hand { font-size: 11pt; }
  .hand .lead { margin: 2mm 0 3mm; color: #3d2a16; }
  .pts { list-style: none; counter-reset: p; margin: 0; padding: 0; }
  .pts li { counter-increment: p; display: flex; align-items: flex-start; gap: 3mm; padding: 2.4mm 0; border-bottom: 1px solid #ebdfc6; line-height: 1.42; }
  .pts li::before { content: counter(p); flex: 0 0 7mm; height: 7mm; border-radius: 50%; background: var(--gold); color: #fff; font-weight: 700; font-size: 10pt; display: flex; align-items: center; justify-content: center; margin-top: .3mm; }
  .pts li span:last-child { flex: 1; }
  .tk { flex: 0 0 5.5mm; width: 5.5mm; height: 5.5mm; border: 1.2px solid var(--ink); border-radius: 1.2mm; display: inline-block; margin-top: 1mm; }
  .hand .call { margin: 4mm 0 2mm; text-align: center; font-size: 10pt; line-height: 1.5; }
  .hand .call b:first-child { color: var(--brown); }
  .hand .sig { margin-top: 6mm; }
  .hand .fu { margin-top: 4mm; }
  .tight { font-size: 10.4pt; } .tight .pts li { padding: 1.7mm 0; line-height: 1.36; } .tight .pill-ttl { margin: 2mm auto 3mm; } .tight .lead { margin: 1mm 0 2mm; } .tight .call { margin: 3mm 0 1mm; } .tight .sig { margin-top: 4mm; }`;

(async () => {
  await render([PRE], path.join(__dirname, "ht-pre-surgery.pdf"), EXTRA);
  await render([POST], path.join(__dirname, "ht-post-surgery.pdf"), EXTRA);
})();
