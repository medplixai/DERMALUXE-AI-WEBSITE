/* DermaLuxe — Google Analytics 4 (gtag.js) with Consent Mode
   Analytics storage stays denied until the visitor accepts the cookie banner. */
(function () {
  var GA_ID = "G-LX852SW6VF";

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  var stored = "";
  try { stored = localStorage.getItem("dl_cookie_consent") || ""; } catch (e) {}

  gtag("consent", "default", {
    analytics_storage: stored === "accepted" ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  });

  gtag("js", new Date());
  gtag("config", GA_ID, { anonymize_ip: true });

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);

  // Called by the cookie banner when the visitor accepts
  window.dlGrantAnalytics = function () {
    gtag("consent", "update", { analytics_storage: "granted" });
  };
})();
