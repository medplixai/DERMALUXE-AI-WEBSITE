// Hair transplant consent booklet, A4, ten pages. Re-run:
//   node print/make-ht-consent.js   →  print/ht-consent-form.pdf
//
// Owner, 9 Nov 2026: a competitor's printed consent set (Looks Studio, Pune)
// "same forms mana DermaLuxe logo tho". The structure is theirs — consent,
// complications, PRP and anaesthesia consent, anaesthesia fitness and notes,
// pre-procedure checklist and operative plan, operative report, doctor's notes,
// post-procedure instructions — with three things changed on purpose:
//   · the clinic, the doctors' credit line and the court are Eluru's;
//   · "permission to take my photos and videos for any promotional use" is
//     gone. Clinical photographs are for the medical record and treatment
//     planning only — NMC 8.1(v) (6 Oct 2026) bans before/after advertising,
//     so a blanket promotional consent would be a promise the clinic cannot
//     keep;
//   · spelling fixed ("Recipeint", "PHYSICAIN", "mentioned", a duplicated
//     "Informed SOS").
// The anaesthetic regimen line is the original's, left for the surgeon to
// keep or strike — a form is not the place to change a drug dose.
const fs = require("fs"), path = require("path");
const puppeteer = require("../node_modules/puppeteer-core");
const ROOT = path.join(__dirname, "..");
const data = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(ROOT, f)).toString("base64");
const logo = data("assets/logo.png", "image/png");
const docs = require(path.join(ROOT, "api", "_docs.js"));
const B = docs.BRAND;
const credit = docs.DOCTORS ? Object.values(docs.DOCTORS).map((d) => `${d.name}, ${d.q || d.qual || "MD (DVL)"} · Reg. No. ${d.reg}`).join("  ·  ") : "";
const CLINIC = "DermaLuxe by Medicare";

const box = (w) => `<span class="bx" style="width:${w}"></span>`;
const line = (w) => `<span class="ln" style="width:${w}"></span>`;
const date = () => `<span class="dt"><i></i><i></i></span>`;
const o = (label) => `<span class="rad">${label}<span class="c"></span></span>`;

// Scalp zones 1–7, the way the surgeon marks them: a side profile and a top
// view, schematic, drawn here so the page needs no picture file.
const HEAD = `<div class="heads">
<svg viewBox="0 0 240 260" width="190" height="206"><g fill="none" stroke="#3b2a1a" stroke-width="2" stroke-linejoin="round">
<path d="M122 18 C176 18 212 54 210 104 C209 140 196 158 192 184 L192 242 M122 18 C72 18 42 50 42 96 C42 108 44 116 46 120 L34 134 L50 138 C50 146 54 154 54 160 C62 164 70 168 64 176 C66 186 82 192 102 190 C110 200 118 220 118 242"/>
<path d="M150 118 C162 112 170 124 162 138 C156 146 148 140 150 128" stroke-width="1.4"/>
<path d="M50 98 C58 70 88 46 124 44 C162 42 196 68 206 104" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M86 60 C94 84 102 100 108 118" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M124 44 C126 70 128 96 128 118" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M162 48 C160 74 158 98 156 116" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M108 118 C124 112 142 112 156 116" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<ellipse cx="186" cy="118" rx="18" ry="22" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M70 110 C100 132 140 160 196 150" stroke="#8b5e2b" stroke-dasharray="4 3"/></g>
<g font-family="Jost, sans-serif" font-size="13" font-weight="600" fill="#2b1a0e" text-anchor="middle">
<text x="68" y="90">1</text><text x="104" y="76">2</text><text x="144" y="72">3</text><text x="182" y="88">4</text><text x="132" y="104">5</text><text x="186" y="123">6</text><text x="150" y="176">7</text></g></svg>
<svg viewBox="0 0 240 260" width="190" height="206"><g fill="none" stroke="#3b2a1a" stroke-width="2">
<ellipse cx="120" cy="130" rx="86" ry="108"/>
<path d="M44 150 C30 160 28 186 40 196" stroke-width="1.4"/><path d="M196 150 C210 160 212 186 200 196" stroke-width="1.4"/>
<path d="M60 58 Q120 30 180 58" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M44 100 Q120 76 196 100" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M40 148 Q120 126 200 148" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<ellipse cx="120" cy="178" rx="30" ry="24" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M50 190 Q120 212 190 190" stroke="#8b5e2b" stroke-dasharray="4 3"/>
<path d="M120 58 L120 126" stroke="#8b5e2b" stroke-dasharray="4 3"/></g>
<g font-family="Jost, sans-serif" font-size="13" font-weight="600" fill="#2b1a0e" text-anchor="middle">
<text x="120" y="52">1</text><text x="90" y="92">2</text><text x="150" y="92">3</text><text x="120" y="116">4</text><text x="120" y="140">5</text><text x="120" y="182">6</text><text x="120" y="226">7</text><text x="60" y="176">7</text><text x="180" y="176">7</text></g></svg>
</div>`;
const AREAS = `<div class="areas">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<div><b>Area ${n}</b>${box("100%")}</div>`).join("")}</div>`;

const head = (title) => `<div class="hd"><div class="brand"><img src="${logo}" alt=""><div><b>${CLINIC}</b><span>Premium Skin &amp; Hair Clinic · Eluru</span></div></div><div class="ttl">${title}</div></div>`;
const foot = `<div class="ft"><div>${B.addr}</div><div><b>Call</b> 99491 34666 · <b>WhatsApp</b> 99591 34666 · ${B.email} · www.dermaluxe.ai</div><div class="cr">${credit}</div></div>`;
const page = (title, body, cls) => `<section class="pg">${head(title)}<div class="body ${cls || ""}">${body}</div>${foot}</section>`;
const bar = (t) => `<div class="bar">${t}</div>`;
const sigrow = (who) => `<div class="row"><span class="lbl">Name of the ${who}:</span>${line("58%")}</div><div class="row"><span class="lbl">${who}'s Signature:</span>${line("42%")}<span class="lbl r">Date:</span>${date()}</div>`;

const P1 = page("Consent Form for Hair Treatment", `
  <div class="pill-ttl">CONSENT FORM FOR HAIR TREATMENT</div>
  <div class="row two"><span><b>Date:</b> ${date()}</span><span><b>Centre:</b> ${CLINIC}, Eluru</span></div>
  <div class="pill-ttl sm">PATIENT DETAILS</div>
  <div class="row"><span class="lbl">Name:</span>${box("82%")}</div>
  <div class="row"><span class="lbl">Address:</span>${box("82%")}</div>
  <div class="row"><span class="lbl">Contact No:</span>${box("82%")}</div>
  <div class="row"><span class="lbl">Email:</span>${box("82%")}</div>
  <div class="row"><span class="lbl">Age / Sex:</span>${box("30%")}<span class="lbl r">Patient ID:</span>${box("30%")}</div>
  <div class="pill-ttl sm">EMERGENCY CONTACT DETAILS</div>
  <div class="row"><span class="lbl">Name:</span>${box("82%")}</div>
  <div class="row"><span class="lbl">Relationship:</span>${box("82%")}</div>
  <div class="row"><span class="lbl">Contact No:</span>${box("82%")}</div>`);

const P2 = page("Consent Form for Hair Transplant", `<ol class="roman">
<li>I ${line("46%")}, do hereby consent and agree to having hair transplant / PRP treatment procedure / surgery performed upon me, and any other medical services which during the procedure become medically reasonable and necessary. This includes, but is not limited to, the administration of ANAESTHETICS and/or sedatives necessary to perform a hair transplant procedure.</li>
<li>I am aware that good results will depend, in part, upon my completing the necessary number of operations / sessions recommended by the doctor and completing the advised number of follow-ups on the advised dates. However, because many variables exist, I have not been promised a specific result. I also understand that the quality and amount of pre-existing hair are major factors in the ultimate result. I understand I will not have hair of the same thickness/density as I had prior to the onset of my hair loss.</li>
<li>Prior to my consenting to the hair transplant / PRP treatment procedure / surgery, I state I have read or have been given the opportunity to read and/or discussed with my physician the following literature, which has been provided to me:<br>› List of complications &nbsp; › Pre-operative and post-operative instructions &nbsp; › A fee schedule of current charges per session<br>An explanation of this procedure has been given to me; I have had the opportunity to ask any questions regarding this procedure. I understand that I will not obtain a full head of hair from the procedure. I understand that visibility of the site following my hair transplant procedure can last for a number of days.</li>
<li>The pros, cons and alternatives for my hair transplant / PRP treatment procedure / surgery have been explained to me. I have the option of doing nothing, wearing a hairpiece/wig, using prescription medication or having a transplant surgery. A combination of the above is also possible. I have been informed of all options.</li>
<li>The session(s) of grafts suggested by the doctor at ${CLINIC} for my hair transplant procedure is a minimum. I understand that more operations/sessions may be recommended later due to ongoing loss of my non-transplanted / restored hair / transplanted hair. I understand that all recommendations made during my consultation and treatment are estimates and may change later. If the doctor(s) or I feel any additional procedure is necessary, I understand there will be additional surgical fees.</li>
<li>I have been informed that hair transplant / PRP treatment procedure / surgery is generally a safe procedure; however, I am aware that complications may occur. The more common complications and a partial list of rare complications of this surgery have been explained to me and/or I have reviewed a list of them, provided, which I signed and dated. A copy of that list is attached. Unforeseen, rare complications, such as unanticipated reaction to medications and anaesthetics, uncommon infections, and unusual healing responses, are possible. Every unforeseen complication may not have been discussed with me in detail, but I do understand that such risks do exist.</li>
<li>I consent to and authorise hair transplant / PRP treatment procedure / surgery by the doctor/doctors and their assistants or associate doctors, and hair transplant technicians, to be performed upon me. I have been informed that the consulting and the operating physician may be different.</li>
<li>I have been well informed and I also understand that good results are expected, but the practices of medicine and surgery are not exact sciences. I understand knowledgeable practitioners sometimes disagree as to the best methods of treatment to achieve desired results.</li>
<li>It has been explained to me that the amount and location of future hair loss on the scalp, including the sides and back area, cannot be predicted. I do understand it is possible to lose my existing hair at any point in the future. I do understand this may affect the appearance of the grafted area. I also understand that the results of hair transplant / PRP treatment procedure / surgery may not be permanent. I also understand that in very rare cases, the implanted hair may not stay permanently. The results are usually very long lasting, but may rarely fall out in one to ten years.</li>
<li>There is possibility of some temporary hair loss in the scalp surrounding the area from where the donor grafts were removed, and in the transplanted area shedding of existing hair, called telogen effluvium, may occur after the surgery. If this hair is at the end of its normal life span, it may not return.</li>
<li>As with all surgical procedures, results cannot be guaranteed. It is possible that some or all of the transplanted hair may fail to grow. Every effort will be made to give the maximum yield.</li>
<li>I understand the success of the hair transplant / PRP treatment procedure / surgery is dependent upon my closely following all instructions and doing regular follow-ups as advised by the doctor. This includes, but is not limited to, pre-operative and post-operative activities and precautions, which have been explained to me. I have also received a written copy of these instructions.</li>
<li>This consent was read and signed while I was not under the influence of medications which cause drowsiness.</li>
<li>I certify this form has been read or it has been read to me, in the language that I am able to understand, the blank spaces have been filled in, and I understand its contents.</li>
</ol>`);

const P3 = page("Consent Form for Hair Transplant", `<ol class="roman" start="15">
<li>I have disclosed all information regarding past and present medical conditions, current medications, and known drug allergies. This information is necessary so that the proper medical treatment is given at all times during the hair transplant / PRP treatment procedure/surgery. Some post-operative / post-procedure discomfort may be experienced. ${CLINIC} offers procedures to obtain the best results for the patient.<br><b>I acknowledge I am responsible for payment of these services with no fee reimbursement regardless of procedure results. I understand the fee paid is for the procedure and not for an expected result.</b><br>I permit clinical photographs of the treated area to be taken for my medical record and for planning and reviewing my treatment. They will not be used for advertising, social media or any promotion.</li>
<li>I understand that, as the science of medicine related to surgery is very vast, it is not possible for the doctor to inform me about all the aspects of hair transplant surgery, which include the pros &amp; cons, side effects, complications or any other aspects of the hair transplant surgery which might not have been discussed with me. I am therefore entirely responsible to verify any or all the information given by the ${CLINIC} doctor / staff, or gather any other information regarding hair transplant, all by myself, from any other doctor / institution / organisation or any other source that I may want to, before partially or fully relying on the information regarding my hair transplant procedure.<br>I also understand that the ${CLINIC} doctors / staff have tried their best to give me all possible information regarding my hair transplant procedure.<br>I authorise ${CLINIC} to use my signature for the digital consent forms for records purpose. In case of any dispute between ${CLINIC} and me, it shall be subject to the jurisdiction of the courts at Eluru, Andhra Pradesh.</li>
</ol>
${bar("POSSIBLE COMPLICATIONS")}
<div class="cols"><ul>
<li>Nausea and vomiting from pain medication</li><li>Bruising</li><li>Infection (less than 1%)</li><li>A temporary headache</li><li>Reaction to medications (less than 1%)</li><li>Poor growth of grafts</li><li>Occasional small ingrown hairs – causing a cyst (less than 10%)</li><li>Scarring of the donor area – wide scars are possible (less than 5%)</li></ul><ul>
<li>Bleeding (less than 5%)</li><li>Excessive swelling</li><li>Fainting (less than 1%) or syncope episodes</li><li>Temporary numbness of the scalp</li><li>Scarring around the grafts</li><li>Swelling on the forehead or face</li></ul></div>
<p class="note">Patients who smoke have a higher rate of delayed wound healing and lower graft yield. Smoking is not recommended for 2–3 weeks prior to and following the procedure.</p>
${bar("RARE COMPLICATIONS PERTAINING TO HAIR TRANSPLANT (partial list only)")}
<div class="cols"><ul><li>Keloid formation</li><li>Persistent scalp pain</li><li>Permanent numbness of the scalp</li><li>Loss of transplanted hair</li></ul><ul><li>Complete failure of growth of transplanted hairs</li><li>Total loss of donor hair</li><li>Noticeable scarring of donor area</li><li>An allergic reaction or medication-related problem</li></ul></div>
<p>I have read and understand all of the possible complications listed above. I accept the risks of these possible complications and consequences associated with this surgery.</p>
<div class="row"><span class="lbl">Date:</span>${date()}<span class="lbl r">Time:</span>${box("22%")}</div>
<div class="row"><span class="lbl">Patient's Name:</span>${line("40%")}<span class="lbl r">Patient's Signature:</span>${box("24%")}</div>
<div class="row"><span class="lbl">Witness Name &amp; Sign:</span>${line("72%")}</div>
<div class="row"><span class="lbl">Other legally responsible person's name &amp; sign:</span>${line("50%")}</div>
<div class="row"><span class="lbl">Address:</span>${line("84%")}</div>
<div class="row"><span class="lbl">City</span>${box("20%")}<span class="lbl r">State</span>${box("20%")}<span class="lbl r">PIN</span>${box("14%")}<span class="lbl r">Ph</span>${box("18%")}</div>`, "dense");

const P4 = page("Consent Form for Hair Transplant", `
  <h3 class="c">Complications pertaining to PRP Treatment</h3>
  <div class="framed">PRP is a component of my own blood. Blood contains platelets, which contain growth factors.<br>I will have approximately 10–20 ml of my own blood drawn. My blood will be mixed with an anticoagulant and placed in a centrifuge to concentrate the platelets.<br>The blood used is my own. All blood-drawing materials and needles, all the centrifuge processing containers and calcium chloride containers, and mixing/activating syringes are single use and are disposed of in our medical waste containers after each patient. Each PRP procedure uses its own sterile materials and supplies.<br>I have been informed that the RISKS and COMPLICATIONS of Platelet Rich Plasma are, and are not limited to:
  <div class="three"><span>1. Pain on the injection</span><span>2. Light-headedness</span><span>3. Rare risk of infection</span></div></div>
  <h4>FOR PATIENTS WHO HAVE HAD PRIOR TRANSPLANTS WITH ANOTHER PHYSICIAN:</h4>
  <p>I acknowledge that prior to contacting ${CLINIC}, I received transplants or scalp reductions from another physician. I further acknowledge ${CLINIC}, its physicians and employees bear no responsibility for my present condition. I have been informed that my condition cannot be completely restored to its original state prior to any transplant surgery.</p>
  <h4>Consent for ANAESTHESIA services</h4>
  <ol>
  <li>All forms of ANAESTHESIA involve some risk and no guarantees or promises can be made concerning the results of my procedure or treatment. Although rare and unexpected severe complications with ANAESTHESIA can occur and include the remote possibility of infection, bleeding, drug reaction, blood clots, loss of sensation, loss of limb function, paralysis, stroke, brain damage, heart attack, or death.</li>
  <li>I understand the type of ANAESTHESIA service (listed below) will be used for my procedure and that the ANAESTHETIC technique to be used will be determined by many factors including my physical condition, the physician's preference, as well as my own desire.</li>
  </ol>
  <p><b>ANAESTHESIA to be used:</b> LOCAL ANAESTHESIA<br><b>Expected results:</b> Temporary loss of feeling of a specific area.<br><b>Technique:</b><br>For donor area &amp; recipient area: 100 cc of NS with 15 cc of 2% Lignocaine with 10 cc of 0.5% Bupivacaine with 0.5 cc Adrenaline<br><b>Risks:</b> Include but are not limited to, infection, convulsions, weakness, persistent numbness, residual pain, injury to blood vessels, anaphylactic reactions or nerve injury.</p>
  <p>I hereby consent to the ANAESTHESIA service described above and authorise its administration by doctors and/or his/her associates at ${CLINIC}. I also consent to an alternative type of ANAESTHESIA if necessary and deemed appropriate. I certify and acknowledge that I have read this form or had it read to me and I understand the risks, alternatives and expected results of the ANAESTHESIA service and that I had ample time to ask questions and consider my decision.</p>
  <div class="row"><span class="lbl">Patient Name:</span>${line("30%")}<span class="lbl r">Patient Signature:</span>${line("24%")}<span class="lbl r">Date:</span>${date()}</div>
  <div class="row"><span class="lbl">Witness Name:</span>${line("30%")}<span class="lbl r">Witness Signature:</span>${line("30%")}</div>`);

const P5 = page("Consent Form for Hair Transplant", `${bar("ANAESTHESIA FITNESS FORM")}
  <div class="row"><span class="lbl">Name</span>${box("80%")}</div>
  <div class="row"><span class="lbl">Age</span>${box("28%")}<span class="lbl r">Sex</span>${box("28%")}</div>
  <div class="row"><span class="lbl">Medical History</span>${box("76%")}</div>
  <div class="row gap">${o("Diabetes")}${o("Hypertension")}${o("Asthma")}${o("Allergy")}</div>
  <hr><div class="row gap"><span class="lbl"><b>Addiction:</b></span>${o("Tobacco")}${o("Smoking")}${o("Alcohol")}</div>
  <div class="row gap"><span class="lbl"></span>${o("Bleeding tendency")}${o("Pre-existing medication")}</div>
  <hr><h4>Surgical History</h4><div class="row">${box("100%")}</div>
  <p><b>All the information given by me is true and nothing has been hidden from the doctor.</b></p>
  <div class="row"><span class="lbl">Patient's Sign:</span>${box("28%")}<span class="lbl r">Date:</span>${date()}<span class="lbl r">Time:</span>${box("16%")}</div>
  <hr><h4>On Examination:</h4>
  <div class="row"><span class="lbl">GC:</span>${box("18%")}<span class="lbl r">Pallor:</span>${box("18%")}<span class="lbl r">Icterus:</span>${box("18%")}</div>
  <div class="row"><span class="lbl">Clubbing:</span>${box("18%")}<span class="lbl r">Cyanosis:</span>${box("18%")}<span class="lbl r">Lymphadenopathy:</span>${box("14%")}</div>
  <div class="row"><span class="lbl">P:</span>${box("16%")}<span class="lbl r">BP:</span>${box("16%")}<span class="lbl r">CVS:</span>${box("16%")}<span class="lbl r">RS:</span>${box("16%")}</div>
  <hr><h4>Investigations</h4>
  <div class="row"><span class="lbl">Hb:</span>${box("12%")}<span class="lbl r">PC:</span>${box("12%")}<span class="lbl r">BT/CT:</span>${box("12%")}<span class="lbl r">BSL:</span>${box("12%")}<span class="lbl r">ECG:</span>${box("12%")}</div>
  <div class="row"><span class="lbl">Others:</span>${box("60%")}</div>
  <hr><div class="row"><span class="lbl">Impression:</span>${box("80%")}</div>
  <div class="row"><span class="lbl">Name of the ANAESTHETIST</span>${line("46%")}<span class="lbl r">Date:</span>${date()}</div>
  <div class="row"><span class="lbl">Sign of the ANAESTHETIST</span>${line("46%")}<span class="lbl r">Time:</span>${box("16%")}</div>`);

const P6 = page("Consent Form for Hair Transplant", `${bar("ANAESTHESIA NOTES")}
  <div class="row"><span class="lbl">Name:</span>${line("70%")}</div>
  <div class="row"><span class="lbl">Age:</span>${line("20%")}<span class="lbl r">Sex:</span>${line("20%")}</div>
  <p>Written informed consent taken.<br><b>LA given:</b> For donor area &amp; recipient area: 100 cc of NS with 15 cc of 2% Lignocaine with 10 cc of 0.5% Bupivacaine with 0.5 cc Adrenaline</p>
  <h4>Intra-Op:</h4><div class="row"><span class="lbl">P:</span>${box("20%")}<span class="lbl r">BP:</span>${box("20%")}<span class="lbl r">SpO₂:</span>${box("20%")}</div>
  <h4>Post-Op:</h4><div class="row"><span class="lbl">P:</span>${box("20%")}<span class="lbl r">BP:</span>${box("20%")}<span class="lbl r">SpO₂:</span>${box("20%")}</div>
  <div class="row"><span class="lbl">CVS:</span>${box("20%")}<span class="lbl r">RS:</span>${box("20%")}<span class="lbl r">CNS:</span>${box("20%")}</div>
  <div class="row"><span class="lbl">ECG:</span>${box("20%")}</div>
  <h4>Post-Operative Orders</h4><p>W/F TPR/BP every 15 minutes<br>Informed SOS</p>
  <div class="row"><span class="lbl">Name of ANAESTHETIST:</span>${line("60%")}</div>
  <div class="row"><span class="lbl">Date:</span>${date()}<span class="lbl r">Time:</span>${box("22%")}</div>
  <div class="row"><span class="lbl">Start Time:</span>${box("22%")}<span class="lbl r">End Time:</span>${box("22%")}</div>
  <div class="row"><span class="lbl">ANAESTHETIST Signature:</span>${line("60%")}</div>`);

const P7 = page("Consent Form for Hair Transplant", `${bar("PRE-PROCEDURE CHECKLIST")}
  <ol class="roman tight">
  <li>Pre-operative investigations checked</li><li>ANAESTHETIC solution is made as per guidelines</li>
  <li>All the instruments have been properly sterilised and a sterile punch is being used for this case</li>
  <li>Pre-ANAESTHESIA check-up is done by the anaesthetist and the anaesthetist has filled in the anaesthesia notes</li>
  <li>Pre-procedure photographs have been taken and verified by the operating doctor</li>
  <li>The anaesthesia solution has been prepared in front of the operating doctor &amp; also verified by him/her</li></ol>
  <p class="note">› The operative report should be filled by the individual operating doctor before the patient leaves the premises and should be signed both by the doctor as well as the patient.<br>› Only the pre-decided medications have to be prescribed.<br>› The ANAESTHESIA solution should be injected only by the operating doctor.</p>
  ${bar("OPERATIVE PLAN DISCUSSED WITH PATIENT")}
  <div class="row"><span class="lbl">Diagnosis : GRADE</span>${box("30%")}</div>
  <div class="row gap"><span class="lbl">Donor Area Density :</span>${o("LOW")}${o("MEDIUM")}${o("HIGH")}</div>
  <div class="row"><span class="lbl">Surgeon :</span>${box("30%")}<span class="lbl r">Assistant :</span>${box("30%")}</div>
  <p><b>ANAESTHESIA used :</b> LOCAL ANAESTHESIA</p>
  <div class="row"><span class="lbl">Number of grafts to be transplanted:</span>${box("36%")}</div>
  <p><b>Area to be transplanted :</b> mention FD/OD for each area (FD = Full Density, OD = Optimised Density)</p>
  ${AREAS}${HEAD}
  <p>I have understood the treatment plan explained to me by the doctor and agree to proceed with the above-mentioned treatment plan.</p>
  <div class="row"><span class="lbl">Name of the Doctor discussing the plan:</span>${line("56%")}</div>
  <div class="row"><span class="lbl">Doctor's Signature:</span>${line("44%")}<span class="lbl r">Date:</span>${date()}</div>
  <div class="row"><span class="lbl">Name of the Patient:</span>${line("56%")}</div>
  <div class="row"><span class="lbl">Patient's Signature:</span>${line("44%")}<span class="lbl r">Date:</span>${date()}</div>`, "dense");

const P8 = page("Consent Form for Hair Transplant", `${bar("OPERATIVE REPORT")}
  <div class="row"><span class="lbl">Patient Name :</span>${box("76%")}</div>
  <div class="row"><span class="lbl">Age :</span>${box("20%")}<span class="lbl r">Gender :</span>${box("20%")}</div>
  <div class="row"><span class="lbl">Address :</span>${box("80%")}</div>
  <div class="row"><span class="lbl">Vitals :</span>${box("20%")}<span class="lbl r">Pulse :</span>${box("20%")}<span class="lbl r">B.P :</span>${box("20%")}</div>
  <div class="row gap"><span class="lbl">Donor Area Density :</span>${o("LOW")}${o("MEDIUM")}${o("HIGH")}</div>
  <div class="row"><span class="lbl">Date :</span>${date()}</div>
  <div class="row"><span class="lbl">Surgeon:</span>${box("24%")}<span class="lbl r">Assistant:</span>${box("24%")}</div>
  <div class="row gap"><span class="lbl">ANAESTHESIA notes filled by ANAESTHETIST :</span>${o("Yes")}${o("No")}</div>
  <div class="row"><span class="lbl">Name of the ANAESTHETIST</span>${line("50%")}</div>
  <div class="row"><span class="lbl">Sign of the ANAESTHETIST</span>${line("50%")}</div>
  <p><b>ANAESTHESIA USED : LOCAL ANAESTHESIA</b><br>For donor area &amp; recipient area : 100 cc of NS with 15 cc of 2% Lignocaine with 10 cc of 0.5% Bupivacaine with 0.5 cc Adrenaline</p>
  <div class="row"><span class="lbl">Number of grafts transplanted:</span>${box("30%")}<span class="lbl r">Technique:</span>${box("30%")}</div>
  <div class="row"><span class="lbl">Start time:</span>${box("20%")}<span class="lbl r">End time:</span>${box("20%")}<span class="lbl r">Complications:</span>${box("24%")}</div>
  <div class="spacer"></div>
  ${sigrow("Doctor")}${sigrow("Patient")}`);

const P9 = page("Consent Form for Hair Transplant", `${bar("DOCTOR'S NOTES")}
  <h4>Pre-operative Notes:</h4>
  <p class="note">› Inj. TT 0.5 cc given IM<br>› XST done: Non-sensitive<br>› Pre-procedure photographs taken<br>› Investigations checked<br>› Pre-ANAESTHETIC check-up done by ANAESTHETIST</p>
  <h4>Procedure Notes:</h4>
  <p>Under all aseptic precautions, painting and draping done. ${line("18%")} cc of local anaesthesia given on the donor area with insulin syringe. ${line("18%")} grafts harvested by motorised FUE technique — all grafts intact — counting one as per size of grafts.</p>
  <div class="row"><span class="lbl">Number of Grafts Harvested :</span>${box("40%")}</div>
  <div class="row"><span class="lbl"><b>Size of Grafts:</b></span><span class="lbl">1 UNIT :</span>${box("12%")}<span class="lbl r">2 UNITS :</span>${box("12%")}<span class="lbl r">3 UNITS :</span>${box("12%")}<span class="lbl r">4 UNITS :</span>${box("12%")}</div>
  <p>Betadine dressing applied to donor area. Recipient area painted, implantation started.<br>After giving ${line("12%")} cc LA for recipient area as mentioned above — area numbers transplanted as follows:</p>
  <p><b>Area transplanted :</b></p>
  ${AREAS}${HEAD}
  <p>After implantation, implanted area cleaned of all clots (No swelling, no complications, procedure uneventful).</p>
  <div class="row"><span class="lbl">Name of the Doctor:</span>${line("40%")}<span class="lbl r">Signature:</span>${line("26%")}</div>
  <div class="row"><span class="lbl">Name of the Patient:</span>${line("34%")}<span class="lbl r">Signature:</span>${line("20%")}<span class="lbl r">Date:</span>${date()}</div>`);

const P10 = page("Consent Form for Hair Transplant", `${bar("POST-PROCEDURE INSTRUCTIONS")}
  <ol class="alpha">
  <li><b>General precautions:</b><ol><li>Do not scratch, comb, massage, oil or shampoo the hair for the first 12 days.</li><li>Avoid excessive sweating.</li><li>Take post-procedure medications as prescribed by the doctor.</li></ol></li>
  <li><b>Care of implanted area:</b><ol><li>Clean the implanted area from the 2nd day with normal saline.</li><li>Do this twice to thrice a day. In case of itching in the implanted area, you can use normal saline.</li></ol></li>
  <li><b>Care of donor area:</b><ol><li>Remove the bandage from the donor area on the very next day of the procedure.</li><li>Start cleaning the donor area 12 hours after bandage removal.</li><li>Take a cup of clean water – add 5–6 caps of betadine to that water – soak a gauze piece in it and use it to clean the donor area thoroughly, only press, DO NOT RUB, until clot removal on day 12.</li></ol></li>
  <li><b>After 12 days / clot removal:</b><ol><li>SHAMPOOING: Start shampooing from the 12th day with a baby shampoo, 2–3 times a week for the next 2 weeks. After that shampoo regularly.</li><li>DYE / COLOUR: After 6 weeks of hair transplant.</li><li>TRIMMING / SWIMMING: After 6 weeks of hair transplant.</li></ol></li>
  </ol>
  ${bar("FOLLOW-UP VISITS")}
  <p><b>FOLLOW-UPS: Complete your follow-ups as prescribed by your doctor.</b></p>
  <div class="row"><span class="lbl">Day 1</span>${box("16%")}<span class="lbl r">Day 12</span>${box("16%")}<span class="lbl r">1 month</span>${box("16%")}<span class="lbl r">3 months</span>${box("16%")}</div>
  <div class="row"><span class="lbl">6 months</span>${box("16%")}<span class="lbl r">9 months</span>${box("16%")}<span class="lbl r">12 months</span>${box("16%")}</div>
  <p>For any bleeding that does not stop, severe pain, swelling with fever, or any worry after the procedure, call <b>99491 34666</b> or WhatsApp <b>99591 34666</b> at any time.</p>
  <p>I understand that I have to follow these instructions, and the results of my transplant largely depend upon me following these instructions.</p>
  ${sigrow("Doctor")}${sigrow("Patient")}`);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  :root { --gold:#b8893d; --brown:#4a2a12; --ink:#2b1a0e; --rule:#cdb48a; }
  html, body { margin:0; }
  body { font-family: Jost, Arial, sans-serif; color: var(--ink); font-size: 10.2pt; line-height: 1.38; }
  .pg { width: 210mm; height: 297mm; box-sizing: border-box; padding: 11mm 13mm 9mm; page-break-after: always; display: flex; flex-direction: column; position: relative; }
  .pg:last-child { page-break-after: auto; }
  .pg::before { content:""; position:absolute; inset:6mm; border:1.5px solid var(--gold); border-radius:4mm; pointer-events:none; }
  .hd { display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid var(--gold); padding-bottom: 3mm; margin-bottom: 4mm; }
  .brand { display:flex; align-items:center; gap: 3mm; }
  .brand img { height: 15mm; border-radius: 2mm; background:#1a0f07; padding: 1.2mm 2.6mm; box-sizing: content-box; }
  .brand b { display:block; font-size: 13pt; color: var(--brown); letter-spacing:.02em; }
  .brand span { font-size: 7.6pt; letter-spacing: .12em; white-space: nowrap; text-transform: uppercase; color: var(--gold); }
  .ttl { border: 1.5px solid var(--brown); border-radius: 3mm; padding: 2mm 5mm; font-weight: 700; font-size: 9.6pt; white-space: nowrap; letter-spacing: .04em; text-transform: uppercase; color: var(--brown); }
  .body { flex: 1 1 auto; }
  .ft { margin-top: auto; border-top: 1px solid var(--rule); padding-top: 2mm; font-size: 7.6pt; color: #5b4128; text-align: center; line-height: 1.4; }
  .ft .cr { color:#7a6650; }
  .bar { background: var(--brown); color: #fbe7b0; text-align: center; font-weight: 700; letter-spacing: .08em; padding: 1.6mm; border-radius: 1.5mm; margin: 3mm 0; font-size: 10pt; }
  .pill-ttl { margin: 4mm auto; width: max-content; background: var(--brown); color: #fbe7b0; font-weight: 700; letter-spacing: .06em; padding: 2.4mm 9mm; border-radius: 100px; font-size: 12pt; }
  .pill-ttl.sm { font-size: 10.5pt; padding: 2mm 8mm; margin-top: 7mm; }
  .row { display: flex; align-items: center; gap: 2mm; margin: 3.2mm 0; flex-wrap: nowrap; }
  .row.two { justify-content: space-between; font-size: 11pt; }
  .row.gap { gap: 7mm; }
  .lbl { white-space: nowrap; min-width: 0; font-weight: 500; }
  .lbl.r { margin-left: auto; }
  .bx { display:inline-block; height: 7mm; border: 1.2px solid var(--ink); border-radius: 2mm; vertical-align: middle; flex: 0 0 auto; }
  .ln { display:inline-block; border-bottom: 1.2px solid var(--ink); height: 5mm; vertical-align: bottom; flex: 0 0 auto; }
  .dt { display:inline-flex; width: 30mm; height: 7mm; border: 1.2px solid var(--ink); border-radius: 2mm; flex: 0 0 auto; }
  .dt i { flex:1; border-right: 1.2px solid var(--ink); } .dt::after { content:""; flex:1.6; }
  .rad { display:inline-flex; align-items:center; gap: 2mm; white-space: nowrap; }
  .rad .c { width: 5.5mm; height: 5.5mm; border: 1.2px solid var(--ink); border-radius: 50%; display:inline-block; }
  hr { border:0; border-top: 1px solid var(--rule); margin: 3mm 0; }
  h3, h4 { margin: 3mm 0 1.5mm; color: var(--brown); } h3 { font-size: 12pt; } h4 { font-size: 10.5pt; } .c { text-align:center; }
  p { margin: 1.8mm 0; } .note { font-size: 9.4pt; color:#3d2a16; }
  ol.roman { list-style: upper-roman; padding-left: 9mm; margin: 0; font-size: 9pt; line-height: 1.36; text-align: justify; }
  ol.roman li { margin-bottom: 1.4mm; padding-left: 1mm; }
  ol.roman.tight { font-size: 9.8pt; } ol.roman.tight li { margin-bottom: .8mm; }
  ol.alpha { list-style: upper-alpha; padding-left: 8mm; margin: 0; } ol.alpha > li { margin-bottom: 2.4mm; } ol.alpha ol { list-style: decimal; padding-left: 7mm; margin-top: .8mm; }
  ol { padding-left: 7mm; } ol li { margin-bottom: 1.2mm; }
  .cols { display:flex; gap: 8mm; } .cols ul { flex:1; margin: 0; padding-left: 0; list-style: none; font-size: 9.4pt; }
  .cols li::before { content: "› "; color: var(--gold); font-weight: 700; } .cols li { margin-bottom: .9mm; }
  .framed { border: 1.5px solid var(--brown); border-radius: 4mm; padding: 4mm 6mm; margin: 2mm 6mm 4mm; font-size: 9.6pt; }
  .three { display:flex; justify-content: space-around; margin-top: 3mm; font-weight: 600; }
  .areas { display:grid; grid-template-columns: repeat(7, 1fr); gap: 3mm; margin: 2mm 0; text-align:center; font-size: 9.4pt; }
  .areas b { display:block; margin-bottom: 1mm; font-weight: 600; } .areas .bx { width: 100%; height: 6.5mm; box-sizing: border-box; }
  .heads { display:flex; justify-content:center; gap: 14mm; margin: 2mm 0 1mm; }
  .spacer { height: 10mm; }
  .dense { font-size: 9.4pt; } .dense .row { margin: 2.2mm 0; } .dense ol.roman { font-size: 8.6pt; } .dense .cols ul { font-size: 8.8pt; } .dense .bar { margin: 2mm 0; padding: 1.2mm; } .dense .bx, .dense .dt { height: 6.2mm; }
  .dense .heads svg { width: 160px; height: 174px; } .dense .heads { margin: 1mm 0 0; }
</style></head><body>${P1}${P2}${P3}${P4}${P5}${P6}${P7}${P8}${P9}${P10}</body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const pg = await browser.newPage();
  await pg.setContent(html, { waitUntil: "networkidle0", timeout: 90000 });
  await pg.evaluate(() => document.fonts.ready);
  // A page whose content runs past the sheet prints onto a blank eleventh
  // page; say which one before anybody prints a hundred copies.
  const over = await pg.evaluate(() => [...document.querySelectorAll(".pg")].map((p, i) => { const room = p.clientHeight, used = p.scrollHeight; return used > room + 1 ? `page ${i + 1} overflows by ${Math.round(used - room)}px` : null; }).filter(Boolean));
  await pg.pdf({ path: path.join(__dirname, "ht-consent-form.pdf"), preferCSSPageSize: true, printBackground: true });
  console.log("ht-consent-form.pdf", over.length ? "⚠ " + over.join("; ") : "10 pages, all fit");
  await browser.close();
})();
