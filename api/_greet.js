// The first name to greet a person by. Never the WhatsApp label the desk sees
// on a lead whose name was not typed ("Ravi K (WhatsApp peru)") — since 18
// Nov good chats are listed before the patient has said their name
// (_chatlead.js), and a follow-up must not call them by a label.
function greetName(n) {
  const s = String(n || "").trim();
  if (!s || /\((WhatsApp peru|peru cheppaledu)\)/i.test(s)) return "";
  return s.split(/\s+/)[0];
}

module.exports = { greetName };
