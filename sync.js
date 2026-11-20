/* Login and sync with Supabase. Entries are merged day by day: the most recent change wins. */
(function () {
  "use strict";
  var App = window.MoodApp, cfg = window.MOOD_CONFIG || {};
  function $(id) { return document.getElementById(id); }
  if (!App || !window.supabase || !cfg.supabaseUrl) return;

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  var SYNCED = "mood.synced.v1";
  var synced = {};
  try { synced = JSON.parse(localStorage.getItem(SYNCED) || "{}"); } catch (_) {}
  function saveSynced() { try { localStorage.setItem(SYNCED, JSON.stringify(synced)); } catch (_) {} }
  var user = null, busy = false, again = false;

  function setStatus(t) { $("sync-status").textContent = t; }
  function time(s) { var n = Date.parse(s || ""); return isNaN(n) ? 0 : n; }

  function showAccount() {
    $("signed-out").hidden = !!user;
    $("signed-in").hidden = !user;
    if (user) $("a-who").textContent = user.email || "";
    $("sync-foot").textContent = user
      ? "Your entries sync between your devices whenever you're online. They're always saved on this device too."
      : "Sign in to keep your iPhone and Mac in sync. Your entries are always saved on this device too, and work offline.";
  }

  async function syncAll() {
    if (!user) return;
    if (busy) { again = true; return; }
    if (!navigator.onLine) { setStatus("Offline, will sync later"); return; }
    busy = true; setStatus("Syncing…");
    try {
      var entries = App.entries, changed = false;

      // 1. Pull everything (a few hundred rows at most) and merge.
      var res = await sb.from("entries").select("day, rating, note, deleted, updated_at");
      if (res.error) throw res.error;
      res.data.forEach(function (row) {
        var local = entries[row.day];
        if (!local || time(row.updated_at) > time(local.updatedAt)) {
          entries[row.day] = row.deleted
            ? { deleted: true, updatedAt: row.updated_at }
            : { rating: row.rating, note: row.note || "", updatedAt: row.updated_at };
          changed = true;
        }
        if (time(entries[row.day].updatedAt) === time(row.updated_at)) synced[row.day] = entries[row.day].updatedAt;
      });

      // 2. Push anything changed on this device.
      var rows = Object.keys(entries).filter(function (k) {
        return /^\d{4}-\d{2}-\d{2}$/.test(k) && entries[k] && synced[k] !== entries[k].updatedAt;
      }).map(function (k) {
        var e = entries[k], ts = time(e.updatedAt) ? new Date(time(e.updatedAt)).toISOString() : new Date().toISOString();
        e.updatedAt = ts;
        return { user_id: user.id, day: k, rating: e.deleted ? null : e.rating, note: e.deleted ? "" : (e.note || ""), deleted: !!e.deleted, updated_at: ts };
      });
      if (rows.length) {
        var up = await sb.from("entries").upsert(rows, { onConflict: "user_id,day" });
        if (up.error) throw up.error;
        rows.forEach(function (r) { synced[r.day] = r.updated_at; });
      }

      // 3. Settings (reminder time, report email).
      var s = App.settings;
      var sr = await sb.from("settings").select("*").maybeSingle();
      if (sr.error) throw sr.error;
      if (sr.data && time(sr.data.updated_at) > time(s.updatedAt)) {
        s.daily = sr.data.daily; s.time = sr.data.reminder_time; s.monthly = sr.data.monthly; s.email = sr.data.email; s.updatedAt = sr.data.updated_at;
        changed = true;
      } else if (!sr.data || time(s.updatedAt) > time(sr.data.updated_at)) {
        var su = await sb.from("settings").upsert({
          user_id: user.id, daily: !!s.daily, reminder_time: s.time || "20:00", monthly: !!s.monthly, email: s.email || "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          updated_at: s.updatedAt || new Date().toISOString()
        });
        if (su.error) throw su.error;
      }

      saveSynced(); App.persist();
      if (changed) App.refresh();
      setStatus("Up to date");
    } catch (err) {
      console.warn("Sync failed", err);
      setStatus("Couldn't sync: " + ((err && (err.message || err.code)) || "unknown error"));
    } finally {
      busy = false;
      if (again) { again = false; syncAll(); }
    }
  }

  var timer;
  function soon() { clearTimeout(timer); timer = setTimeout(syncAll, 800); }
  App.Sync.push = soon;
  App.Sync.pushSettings = soon;
  App.Sync.now = syncAll;
  App.Sync.client = sb;
  App.Sync.user = function () { return user; };

  // ----- Account buttons -----
  function creds() { return { email: $("a-email").value.trim(), password: $("a-password").value }; }
  $("a-signin").addEventListener("click", async function () {
    var c = creds(); if (!c.email || !c.password) { App.toast("Enter your email and password"); return; }
    var r = await sb.auth.signInWithPassword(c);
    if (r.error) { App.toast(r.error.message.indexOf("confirm") >= 0 ? "Confirm your email first" : "Wrong email or password"); return; }
    $("a-password").value = "";
  });
  $("a-signup").addEventListener("click", async function () {
    var c = creds(); if (!c.email || c.password.length < 8) { App.toast("Use a password of 8+ characters"); return; }
    var r = await sb.auth.signUp({ email: c.email, password: c.password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (r.error) { App.toast(r.error.message); return; }
    $("a-password").value = "";
    if (!r.data.session) App.toast("Check your email to confirm");
  });
  $("a-forgot").addEventListener("click", async function () {
    var email = $("a-email").value.trim();
    if (!email) { App.toast("Enter your email first"); return; }
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    App.toast(r.error ? "Couldn't send the email, try again" : "Check your email for a reset link");
  });
  function askNewPassword() {
    $("newpw-cell").hidden = false;
    var tab = document.querySelector('.tabbar [data-tab="settings"]'); if (tab) tab.click();
    setTimeout(function () { $("a-newpw").focus(); }, 300);
  }
  $("a-changepw").addEventListener("click", askNewPassword);
  $("a-savepw").addEventListener("click", async function () {
    var pw = $("a-newpw").value;
    if (pw.length < 8) { App.toast("Use 8 or more characters"); return; }
    var r = await sb.auth.updateUser({ password: pw });
    if (r.error) { App.toast(r.error.message); return; }
    $("a-newpw").value = ""; $("newpw-cell").hidden = true;
    App.toast("Password changed");
  });
  $("a-signout").addEventListener("click", async function () { await sb.auth.signOut(); App.toast("Signed out"); });
  $("a-syncnow").addEventListener("click", syncAll);

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") setTimeout(function () { askNewPassword(); App.toast("Choose a new password"); }, 0);
    var was = user && user.id;
    user = session ? session.user : null;
    if (user && was && was !== user.id) { synced = {}; saveSynced(); }
    showAccount();
    if (user && !was) syncAll();
    if (!user) setStatus("On this device only");
  });

  window.addEventListener("online", syncAll);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") syncAll(); });
  showAccount();
})();
