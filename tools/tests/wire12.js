const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("app/package.json", "utf8"));
const html = fs.readFileSync("staff.html", "utf8");
const plugins = Object.keys(pkg.dependencies).filter((d) => /capacitor/.test(d));
const NAME = {
  "@capacitor/camera": "Camera", "@capacitor/push-notifications": "PushNotifications",
  "@capacitor/haptics": "Haptics", "@capacitor/share": "Share", "@capacitor/app": "App",
  "@capacitor/browser": "Browser", "@capacitor/preferences": "Preferences",
  "@capacitor/status-bar": "StatusBar", "@capacitor/splash-screen": "SplashScreen",
  "@capacitor/network": "Network", "@capacitor/filesystem": "Filesystem",
  "@capacitor/keyboard": "Keyboard", "@capacitor/device": "Device",
  "@aparajita/capacitor-biometric-auth": "BiometricAuth",
  "@capacitor-community/privacy-screen": "PrivacyScreen",
};
console.log("plugins installed, and whether the app actually calls them\n");
let bad = 0;
for (const p of plugins.sort()) {
  if (/android|ios|^@capacitor\/core|^@capacitor\/cli/.test(p)) { console.log(`  --  ${p} (platform/tooling)`); continue; }
  const n = NAME[p];
  if (!n) { console.log(`  ?   ${p} — unknown plugin name, check by hand`); continue; }
  const used = html.includes(`plug("${n}")`) || html.includes(`Plugins.${n}`) || html.includes(`"${n}"`);
  if (!used) { bad++; console.log(`  ✗   ${p} — installed, ships in the APK, never called`); }
  else console.log(`  ok  ${p.padEnd(42)} → plug("${n}")`);
}
console.log("\nAndroid permissions asked for:");
const man = fs.readFileSync("app/android/app/src/main/AndroidManifest.xml", "utf8");
for (const m of man.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)) console.log("  · " + m[1]);
console.log("\nfeatures declared:");
for (const m of man.matchAll(/uses-feature android:name="([^"]+)"/g)) console.log("  · " + m[1]);
console.log(bad ? `\n${bad} unused plugin(s)` : "\nevery plugin is used");
