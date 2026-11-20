/* Push reminders and the test buttons. The server lives in supabase/functions/mood. */
(function () {
  "use strict";
  var App = window.MoodApp, cfg = window.MOOD_CONFIG || {};
  if (!App || !App.Sync || !App.Sync.client) return;
  var sb = App.Sync.client, FN = cfg.supabaseUrl + "/functions/v1/mood";
  function $(id) { return document.getElementById(id); }

  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  async function call(action, body) {
    var s = (await sb.auth.getSession()).data.session;
    var res = await fetch(FN + "?action=" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey, Authorization: "Bearer " + (s ? s.access_token : cfg.supabaseKey) },
      body: JSON.stringify(body || {})
    });
    var data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok && !data.error) data.error = "Server error " + res.status + (res.status === 404 ? " (the mood function isn't deployed yet)" : "");
    return data;
  }

  function keyBytes(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function subscribe() {
    var user = App.Sync.user();
    if (!user) throw new Error("Sign in first");
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      var k = await call("vapid");
      if (!k.publicKey) throw new Error(k.error || "The server didn't send a key");
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.publicKey) });
    }
    var j = sub.toJSON();
    var r = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: user.id, subscription: j }, { onConflict: "endpoint" });
    if (r.error) throw r.error;
  }

  async function enable() {
    if (!supported) throw new Error(isIOS && !standalone ? "Open Mood from your Home Screen first" : "This browser can't show notifications");
    var p = await Notification.requestPermission();
    if (p !== "granted") throw new Error("Notifications are turned off for Mood. You can allow them in Settings → Notifications.");
    await subscribe();
  }

  function note() {
    var t;
    if (!App.Sync.user()) t = "Sign in to get reminders.";
    else if (isIOS && !standalone) t = "On iPhone, reminders only work in the app you open from your Home Screen.";
    else if (!supported) t = "This browser can't show notifications.";
    else t = "A gentle nudge at this time on days you haven't rated yet.";
    $("push-note").textContent = t;
    var signedIn = !!App.Sync.user();
    $("test-push").hidden = !signedIn;
    $("test-report").hidden = !signedIn;
  }

  $("s-daily").addEventListener("change", function (e) {
    if (!e.target.checked) return;
    enable().then(function () { App.toast("Reminders are on"); }, function (err) { App.toast(err.message || String(err)); });
  });

  $("test-push").addEventListener("click", async function () {
    try {
      await enable();
      var r = await call("test-push");
      App.toast(r.ok ? "Test sent. It should arrive in a few seconds." : (r.error || "Couldn't send"));
    } catch (err) { App.toast(err.message || String(err)); }
  });

  $("test-report").addEventListener("click", async function () {
    var btn = $("test-report");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      if (App.Sync.now) await App.Sync.now();
      var now = new Date();
      var r = await call("test-report", { year: now.getFullYear(), month: now.getMonth() + 1 });
      App.toast(r.ok ? "Report sent to " + r.email : (r.error || "Couldn't send the report"));
    } catch (err) { App.toast(err.message || String(err)); }
    btn.disabled = false; btn.textContent = "Email me a test report now";
  });

  sb.auth.onAuthStateChange(function (_e, session) {
    setTimeout(function () {
      note();
      // Keep this device's subscription registered while reminders are on.
      if (session && App.settings.daily && supported && Notification.permission === "granted") subscribe().catch(function () {});
    }, 0);
  });
  note();
})();
