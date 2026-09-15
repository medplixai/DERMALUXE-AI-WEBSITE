// Push: the app registers a token, the server stores it, the server sends.
const fs = require("fs");
const html = fs.readFileSync("staff.html", "utf8");
const push = fs.readFileSync("api/push.js", "utf8");
const _push = fs.readFileSync("api/_push.js", "utf8");
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`  ${ok ? "ok " : "✗  "} ${what}`); };

console.log("PUSH — the whole chain");
check(/PushNotifications/.test(html), "app asks the phone for a token");
check(/registration/.test(html) && /"save"|a: "save"|register/.test(html), "app sends the token to the server");
const pushActs = [...push.matchAll(/a === "([a-z]+)"/g)].map((m) => m[1]);
console.log("      /api/push actions: " + pushActs.join(", "));
check(pushActs.includes("save") || pushActs.includes("register"), "server has an action that stores a token");
check(/notifyCap/.test(_push), "server can send to everyone holding a capability");
check(/FIREBASE_SERVICE_ACCOUNT/.test(_push), "server signs with the Firebase service account");
check(fs.existsSync("app/android/app/google-services.json"), "the app has google-services.json");
const gs = JSON.parse(fs.readFileSync("app/android/app/google-services.json", "utf8"));
const cap = JSON.parse(fs.readFileSync("app/capacitor.config.json", "utf8"));
const pkgName = gs.client[0].client_info.android_client_info.package_name;
check(pkgName === cap.appId, `google-services package (${pkgName}) matches the app id (${cap.appId})`);
const gradle = fs.readFileSync("app/android/app/build.gradle", "utf8");
check(/google-services/.test(gradle) || /com\.google\.gms/.test(fs.readFileSync("app/android/build.gradle", "utf8")), "the google-services gradle plugin is applied");
check(/notification tap|addListener\("pushNotificationActionPerformed"|pushNotificationActionPerformed/.test(html), "tapping a notification opens the right tab");

console.log("\nDEEP LINKS");
check(/openFromHash/.test(html), "/staff.html#tab opens that tab");
const shortcuts = fs.existsSync("app/android/app/src/main/res/xml/shortcuts.xml");
console.log(`  ${shortcuts ? "ok " : "·  "} app icon long-press shortcuts: ${shortcuts ? "present" : "none"}`);
console.log(bad ? `\n${bad} broken link(s) in the chain` : "\nthe push chain is complete");
