/* Mood Tracker web app. Everything is saved on this device first (works offline).
   Sync, push reminders and the monthly email plug in through `Sync` below. */
(function () {
  "use strict";
  var VERSION = "1.2.2";

  // ---------- The scale (edit wording here) ----------
  var SCALE = [
    "Recurring suicidal thoughts, no way out, no movement, everything is bleak and it will always be like this.",
    "Feelings of hopelessness and guilt, thoughts of suicide, little movement, impossible to do anything.",
    "Slow thinking, no appetite, need to be alone, sleep excessive or difficult, everything a struggle.",
    "Feelings of panic and anxiety, concentration difficult and memory poor, some comfort in routine.",
    "Slight withdrawal from social situations, concentration less than usual, slight agitation.",
    "Mood in balance, no symptoms of depression or mania.",
    "Self-esteem good, optimistic, sociable, and articulate, good decisions, need less sleep and get work done.",
    "Very productive, everything to excess (phone calls, writing, smoking, tea), charming and talkative.",
    "Inflated self-esteem, rapid thoughts and speech, counter-productive simultaneous tasks.",
    "Lost touch with reality, incoherent, no sleep, paranoid and vindictive, reckless behaviour.",
    "Total loss of judgement, exorbitant spending, religious delusions and hallucinations."
  ];
  var PHASES = [
    { name: "Mania", lo: 9, hi: 10, c: "--red" },
    { name: "Hypomania", lo: 7, hi: 8, c: "--orange" },
    { name: "Balanced Mood", lo: 4, hi: 6, c: "--green" },
    { name: "Mild to Moderate Depression", lo: 2, hi: 3, c: "--blue" },
    { name: "Severe Depression", lo: 0, hi: 1, c: "--indigo" }
  ];
  function phaseOf(v) { for (var i = 0; i < PHASES.length; i++) if (v >= PHASES[i].lo && v <= PHASES[i].hi) return PHASES[i]; return PHASES[2]; }
  function col(v) { return "var(" + phaseOf(v).c + ")"; }

  // ---------- Storage ----------
  var KEY = "mood.entries.v1", SKEY = "mood.settings.v1";
  function load(k, fallback) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  var entries = load(KEY, {});      // { "2026-11-20": { rating, note, updatedAt, deleted? } }
  var settings = Object.assign({ daily: false, time: "20:00", monthly: false, email: "" }, load(SKEY, {}));

  function saveEntries() { store(KEY, entries); Sync.push(); }
  function persistOnly() { store(KEY, entries); store(SKEY, settings); }
  function saveSettings() { settings.updatedAt = new Date().toISOString(); store(SKEY, settings); Sync.pushSettings(); }

  // Hooks filled in once Supabase is set up.
  var Sync = { push: function () {}, pushSettings: function () {}, status: "On this device only" };

  // ---------- Dates ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseKey(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function monthTitle(y, m) { return new Date(y, m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function monthDays(y, m) {
    var out = [];
    Object.keys(entries).sort().forEach(function (k) {
      var e = entries[k]; if (!e || e.deleted) return;
      var d = parseKey(k);
      if (d.getFullYear() === y && d.getMonth() === m) out.push({ k: k, d: d, r: e.rating, n: e.note || "" });
    });
    return out;
  }

  // ---------- Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var toastTimer;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, Math.max(1800, msg.length * 70)); }

  // ---------- Shared rendering (Month tab + report) ----------
  function stats(ds, y, m) {
    var r = ds.map(function (x) { return x.r; }), n = r.length;
    var avg = n ? r.reduce(function (a, b) { return a + b; }, 0) / n : 0;
    var sd = n ? Math.sqrt(r.reduce(function (a, b) { return a + (b - avg) * (b - avg); }, 0) / n) : 0;
    var swing = 0; for (var i = 1; i < n; i++) swing = Math.max(swing, Math.abs(r[i] - r[i - 1]));
    return { n: n, dim: daysIn(y, m), avg: avg, lo: n ? Math.min.apply(null, r) : 0, hi: n ? Math.max.apply(null, r) : 0,
      bal: r.filter(function (x) { return x >= 4 && x <= 6; }).length, high: r.filter(function (x) { return x >= 7; }).length,
      low: r.filter(function (x) { return x <= 3; }).length, sd: sd, swing: swing };
  }

  function chartSVG(ds, y, m) {
    var W = 340, H = 210, L = 24, R = 8, T = 8, B = 22, n = daysIn(y, m);
    function x(day) { return L + (day - 0.5) / n * (W - L - R); }
    function yy(v) { return T + (10 - v) / 10 * (H - T - B); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Mood graph for ' + monthTitle(y, m) + '">';
    s += '<rect x="' + L + '" y="' + yy(6.5) + '" width="' + (W - L - R) + '" height="' + (yy(3.5) - yy(6.5)) + '" fill="var(--green)" fill-opacity="0.13"/>';
    [0, 2, 4, 6, 8, 10].forEach(function (v) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy(v) + '" y2="' + yy(v) + '" stroke="var(--sep)" stroke-width="0.6"/>';
      s += '<text x="' + (L - 6) + '" y="' + (yy(v) + 3.5) + '" text-anchor="end" font-size="10" fill="var(--label2)">' + v + '</text>';
    });
    [1, 8, 15, 22, 29].forEach(function (d) {
      if (d > n) return;
      s += '<line x1="' + x(d) + '" x2="' + x(d) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--sep)" stroke-width="0.6" stroke-dasharray="2 3"/>';
      s += '<text x="' + x(d) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--label2)">' + d + '</text>';
    });
    var pts = ds.map(function (p) { return [x(p.d.getDate()), yy(p.r)]; });
    if (pts.length > 1) {
      var d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, k = 0.16;
        var lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
        var c1y = Math.min(Math.max(p1[1] + (p2[1] - p0[1]) * k, lo), hi);
        var c2y = Math.min(Math.max(p2[1] - (p3[1] - p1[1]) * k, lo), hi);
        d += " C" + (p1[0] + (p2[0] - p0[0]) * k).toFixed(1) + "," + c1y.toFixed(1) + " " + (p2[0] - (p3[0] - p1[0]) * k).toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
      }
      s += '<path d="' + d + '" fill="none" stroke="var(--gray)" stroke-opacity="0.6" stroke-width="2"/>';
    }
    ds.forEach(function (p, i) { s += '<circle cx="' + pts[i][0].toFixed(1) + '" cy="' + pts[i][1].toFixed(1) + '" r="4.6" fill="' + col(p.r) + '"/>'; });
    return s + "</svg>";
  }

  function tilesHTML(st) {
    var t = [["Average", st.avg.toFixed(1), ""], ["Days rated", st.n + " of " + st.dim, ""],
      ["Balanced days", st.bal, "rated 4 to 6"], ["Range", st.lo + " to " + st.hi, "lowest to highest"],
      ["High days", st.high, "rated 7 or more"], ["Low days", st.low, "rated 3 or less"],
      ["Variability", st.sd.toFixed(1), "lower means steadier"], ["Biggest change", st.swing, "between rated days"]];
    return '<div class="tiles">' + t.map(function (a) {
      return '<div class="tile"><span class="k">' + a[0] + '</span><span class="v">' + a[1] + '</span>' + (a[2] ? '<span class="d">' + a[2] + '</span>' : "") + "</div>";
    }).join("") + "</div>";
  }

  function phasesHTML(ds) {
    var h = '<div class="card"><h3 class="headline">Time in each phase</h3>';
    PHASES.forEach(function (p) {
      var c = ds.filter(function (x) { return x.r >= p.lo && x.r <= p.hi; }).length;
      var f = ds.length ? c / ds.length * 100 : 0;
      h += '<div class="phase-row"><div class="row-between"><span><span class="dot" style="background:var(' + p.c + ')"></span>' + p.name + '</span><span class="muted" style="font-variant-numeric:tabular-nums">' + c + (c === 1 ? " day" : " days") + '</span></div><div class="bar"><span style="width:' + (c ? Math.max(f, 2) : 0) + "%;background:var(" + p.c + ')"></span></div></div>';
    });
    return h + "</div>";
  }

  function dayHTML(p, asButton) {
    var tag = asButton ? 'button type="button" data-day="' + p.k + '"' : "div";
    return "<" + tag + ' class="day"><span class="badge" style="background:' + col(p.r) + '">' + p.r + '</span><span><div class="when">' +
      p.d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + '</div><div class="ph" style="color:' + col(p.r) + '">' + phaseOf(p.r).name + "</div>" +
      (p.n ? '<div class="nt">' + esc(p.n) + "</div>" : "") + "</span></" + (asButton ? "button" : "div") + ">";
  }

  // ---------- Tabs ----------
  var tabs = document.querySelectorAll(".tabbar button");
  function showTab(name) {
    tabs.forEach(function (o) { o.setAttribute("aria-selected", o.dataset.tab === name ? "true" : "false"); });
    ["today", "month", "settings"].forEach(function (n) { $("view-" + n).hidden = n !== name; });
    document.body.classList.toggle("grouped", name === "settings");
    if (name === "month") renderMonth();
    window.scrollTo(0, 0);
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { showTab(t.dataset.tab); }); });

  // ---------- Today ----------
  var day = today(), selected = null, savedRating = null, savedNote = "";
  var grid = $("rating-grid"), noteEl = $("note"), saveBtn = $("save"), dayInput = $("day");
  SCALE.forEach(function (_, v) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "rate"; b.textContent = v;
    b.setAttribute("aria-label", v + ", " + phaseOf(v).name);
    b.addEventListener("click", function () { selected = v; renderToday(); if (navigator.vibrate) navigator.vibrate(8); });
    grid.appendChild(b);
  });

  function setDay(d) {
    day = d;
    var e = entries[keyOf(d)];
    if (e && !e.deleted) { selected = e.rating; noteEl.value = e.note || ""; savedRating = e.rating; savedNote = e.note || ""; }
    else { selected = null; noteEl.value = ""; savedRating = null; savedNote = ""; }
    dayInput.value = keyOf(d);
    dayInput.max = keyOf(today());
    var isToday = keyOf(d) === keyOf(today());
    $("today-title").textContent = isToday ? "Today" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    renderToday();
  }

  function renderToday() {
    Array.prototype.forEach.call(grid.children, function (b, v) {
      var on = v === selected;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.style.background = on ? col(v) : "color-mix(in srgb, " + col(v) + " 15%, transparent)";
      b.style.color = on ? "#fff" : col(v);
    });
    var slot = $("level-slot");
    if (selected === null) slot.innerHTML = "";
    else {
      var c = col(selected);
      slot.innerHTML = '<div class="level" style="background:color-mix(in srgb, ' + c + ' 12%, transparent)"><span class="num" style="color:' + c + '">' + selected +
        '</span><div><div class="phase" style="color:' + c + '">' + phaseOf(selected).name + "</div><p>" + SCALE[selected] + "</p></div></div>";
    }
    var changed = selected !== savedRating || noteEl.value !== savedNote;
    saveBtn.disabled = selected === null || !changed;
    var label = savedRating === null ? "Save" : (changed ? "Update" : "Saved");
    saveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>' + label;
    $("delete-day").hidden = savedRating === null;
  }

  noteEl.addEventListener("input", renderToday);
  dayInput.addEventListener("change", function () { if (dayInput.value) setDay(parseKey(dayInput.value)); });
  saveBtn.addEventListener("click", function () {
    if (selected === null) return;
    entries[keyOf(day)] = { rating: selected, note: noteEl.value.trim(), updatedAt: new Date().toISOString() };
    noteEl.value = noteEl.value.trim();
    saveEntries();
    savedRating = selected; savedNote = noteEl.value;
    renderToday(); toast("Saved");
  });
  var deleteArmed = false;
  $("delete-day").addEventListener("click", function () {
    var btn = $("delete-day");
    if (!deleteArmed) { deleteArmed = true; btn.textContent = "Tap again to delete"; setTimeout(function () { deleteArmed = false; btn.textContent = "Delete this day"; }, 3000); return; }
    deleteArmed = false; btn.textContent = "Delete this day";
    entries[keyOf(day)] = { deleted: true, updatedAt: new Date().toISOString() };
    saveEntries(); setDay(day); toast("Deleted");
  });

  // ---------- Month ----------
  var vy = today().getFullYear(), vm = today().getMonth();
  function isCurrent(y, m) { var t = today(); return y === t.getFullYear() && m === t.getMonth(); }
  function shift(y, m, by) { var d = new Date(y, m + by, 1); return [d.getFullYear(), d.getMonth()]; }

  function renderMonth() {
    var ds = monthDays(vy, vm), st = stats(ds, vy, vm);
    $("month-label").textContent = monthTitle(vy, vm);
    $("next-month").disabled = isCurrent(vy, vm);
    $("open-report").disabled = ds.length === 0;
    var h = "";
    var last = shift(today().getFullYear(), today().getMonth(), -1);
    if (isCurrent(vy, vm) && today().getDate() <= 7 && monthDays(last[0], last[1]).length) {
      h += '<div class="banner"><div style="flex:1"><div class="t">' + new Date(last[0], last[1], 1).toLocaleDateString("en-GB", { month: "long" }) +
        '\'s report is ready</div><div class="muted" style="font-size:15px">Graph, statistics and every day\'s note.</div></div><button class="btn-prom" style="width:auto;padding:10px 18px" type="button" id="open-last">Open</button></div>';
    }
    if (!ds.length) {
      h += '<div class="empty"><strong>No days rated yet</strong><span>Days you rate in ' + monthTitle(vy, vm) + " will show up here.</span></div>";
    } else {
      h += '<div class="card"><h3 class="headline">Mood over the month</h3><div class="chart">' + chartSVG(ds, vy, vm) + "</div></div>";
      h += tilesHTML(st) + phasesHTML(ds);
      h += '<div class="card"><h3 class="headline">Days</h3><div>' + ds.slice().reverse().map(function (p) { return dayHTML(p, true); }).join("") + "</div></div>";
    }
    $("month-body").innerHTML = h;
    var ol = $("open-last"); if (ol) ol.addEventListener("click", function () { openReport(last[0], last[1]); });
  }
  $("month-body").addEventListener("click", function (e) {
    var b = e.target.closest("[data-day]"); if (!b) return;
    setDay(parseKey(b.dataset.day)); showTab("today");
  });
  $("prev-month").addEventListener("click", function () { var s = shift(vy, vm, -1); vy = s[0]; vm = s[1]; renderMonth(); });
  $("next-month").addEventListener("click", function () { if (isCurrent(vy, vm)) return; var s = shift(vy, vm, 1); vy = s[0]; vm = s[1]; renderMonth(); });

  // ---------- Report ----------
  var reportMonth = null;
  function reportHTML(y, m) {
    var ds = monthDays(y, m), st = stats(ds, y, m), now = new Date();
    return '<div style="display:grid;gap:4px"><h1>Mood report</h1><div class="sub">' + monthTitle(y, m) + '</div><div class="meta">' + st.n + " of " + st.dim + " days rated, average " + st.avg.toFixed(1) + "</div></div>" +
      '<div class="card"><h3 class="headline">Mood over the month</h3><div class="chart">' + chartSVG(ds, y, m) + '</div><div class="caption">The green band is the balanced range (4 to 6).</div></div>' +
      tilesHTML(st) + phasesHTML(ds) +
      '<div class="card"><h3 class="headline">Daily log</h3><div>' + ds.map(function (p) { return dayHTML(p, false); }).join("") + "</div></div>" +
      '<div class="foot">Created ' + now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) + " at " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " with Mood Tracker</div>" +
      '<button class="btn-prom" type="button" id="print-report">Save as PDF</button>';
  }
  function openReport(y, m) {
    reportMonth = [y, m];
    $("sheet-title").textContent = monthTitle(y, m);
    $("paper").innerHTML = reportHTML(y, m);
    $("print-report").addEventListener("click", function () { window.print(); });
    $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeReport() { $("sheet").hidden = true; document.body.style.overflow = ""; }
  $("open-report").addEventListener("click", function () { openReport(vy, vm); });
  $("sheet-done").addEventListener("click", closeReport);
  $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet")) closeReport(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("sheet").hidden) closeReport(); });
  $("sheet-share").addEventListener("click", function () {
    var y = reportMonth[0], m = reportMonth[1], ds = monthDays(y, m), st = stats(ds, y, m);
    var text = "Mood report " + monthTitle(y, m) + "\n" + st.n + " of " + st.dim + " days rated, average " + st.avg.toFixed(1) +
      "\nBalanced days (4 to 6): " + st.bal + ", high days (7+): " + st.high + ", low days (3 or less): " + st.low + "\n\n" +
      ds.map(function (p) { return p.d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + ": " + p.r + " (" + phaseOf(p.r).name + ")" + (p.n ? " - " + p.n : ""); }).join("\n");
    if (navigator.share) navigator.share({ title: "Mood report " + monthTitle(y, m), text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Report copied"); }, function () { toast("Use Save as PDF instead"); });
  });

  // ---------- Settings ----------
  function syncTimeCell() { $("time-cell").hidden = !settings.daily; }
  function renderSettings() {
    $("s-daily").checked = settings.daily;
    $("s-time").value = settings.time;
    $("s-monthly").checked = settings.monthly;
    $("s-email").value = settings.email;
    syncTimeCell();
  }
  renderSettings();
  $("s-daily").addEventListener("change", function (e) { settings.daily = e.target.checked; syncTimeCell(); saveSettings(); });
  $("s-time").addEventListener("change", function (e) { settings.time = e.target.value || "20:00"; saveSettings(); });
  $("s-monthly").addEventListener("change", function (e) { settings.monthly = e.target.checked; saveSettings(); });
  $("s-email").addEventListener("change", function (e) { settings.email = e.target.value.trim(); saveSettings(); });
  $("version").textContent = "Version " + VERSION;

  $("scale-list").innerHTML = SCALE.map(function (d, v) { return [v, d]; }).reverse().map(function (s) {
    return '<div class="scale-item"><span class="badge" style="background:' + col(s[0]) + '">' + s[0] + '</span><div><div class="ph" style="color:' + col(s[0]) + '">' + phaseOf(s[0]).name + "</div><p>" + s[1] + "</p></div></div>";
  }).join("");
  $("open-scale").addEventListener("click", function () { $("settings-main").hidden = true; $("settings-scale").hidden = false; window.scrollTo(0, 0); });
  $("close-scale").addEventListener("click", function () { $("settings-main").hidden = false; $("settings-scale").hidden = true; });

  $("export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify({ app: "mood-tracker", version: 1, exportedAt: new Date().toISOString(), entries: entries }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mood-backup-" + keyOf(today()) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });
  $("import").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var data = JSON.parse(txt), added = 0;
      Object.keys(data.entries || {}).forEach(function (k) {
        var inc = data.entries[k], cur = entries[k];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !inc) return;
        if (!cur || (inc.updatedAt || "") > (cur.updatedAt || "")) { entries[k] = inc; added++; }
      });
      saveEntries(); setDay(day); toast(added + " days imported");
    }).catch(function () { toast("That file isn't a Mood backup"); });
    e.target.value = "";
  });

  // ---------- Start ----------
  setDay(today());
  // Roll over to the new day if the app stays open past midnight.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && savedRating === null && selected === null && keyOf(day) !== keyOf(today())) setDay(today());
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") reg.update().catch(function () {}); });
  }).catch(function () {});

  window.MoodApp = {
    entries: entries, settings: settings, Sync: Sync, toast: toast, persist: persistOnly,
    refresh: function () { if (selected === savedRating && noteEl.value === savedNote) setDay(day); if (!$("view-month").hidden) renderMonth(); renderSettings(); }
  };
})();
