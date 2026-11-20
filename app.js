/* Mood Tracker web app. Everything is saved on this device first (works offline).
   Sync, push reminders and the monthly email plug in through `Sync` below. */
(function () {
  "use strict";
  var VERSION = "1.12.0";

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
    { name: "Mania", lo: 9, hi: 10, c: "--ph-mania" },
    { name: "Hypomania", lo: 7, hi: 8, c: "--ph-hypo" },
    { name: "Balanced Mood", lo: 4, hi: 6, c: "--ph-bal" },
    { name: "Mild to Moderate Depression", lo: 2, hi: 3, c: "--ph-mild" },
    { name: "Severe Depression", lo: 0, hi: 1, c: "--ph-severe" }
  ];
  function phaseOf(v) { for (var i = 0; i < PHASES.length; i++) if (v >= PHASES[i].lo && v <= PHASES[i].hi) return PHASES[i]; return PHASES[2]; }
  function col(v) { return "var(" + phaseOf(v).c + ")"; }        // fill
  function ink(v) { return "var(" + phaseOf(v).c + "-ink)"; }    // text on the page
  function on(v) { return "var(" + phaseOf(v).c + "-on)"; }      // text on the fill

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

  // Squared grid (one row per rating), a circle per day and a thin line through the centres.
  function chartSVG(ds, y, m) {
    var L = 24, T = 8, B = 22, cell = 20, cols = 15, n = daysIn(y, m), W = L + cols * cell + 8, H = T + 10 * cell + B;
    function x(day) { return L + (day - 0.5) / n * cols * cell; }
    function yy(v) { return T + (10 - v) * cell; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Mood graph for ' + monthTitle(y, m) + '">';
    s += '<rect x="' + L + '" y="' + T + '" width="' + cols * cell + '" height="' + 10 * cell + '" fill="var(--bg)"/>';
    for (var c = 0; c <= cols; c++) s += '<line x1="' + (L + c * cell) + '" x2="' + (L + c * cell) + '" y1="' + T + '" y2="' + yy(0) + '" stroke="var(--sep)" stroke-width="0.6"/>';
    for (var v = 0; v <= 10; v++) {
      s += '<line x1="' + L + '" x2="' + (L + cols * cell) + '" y1="' + yy(v) + '" y2="' + yy(v) + '" stroke="var(--sep)" stroke-width="0.6"/>';
      if (v % 2 === 0) s += '<text x="' + (L - 6) + '" y="' + (yy(v) + 3.5) + '" text-anchor="end" font-size="10" fill="var(--label2)">' + v + '</text>';
    }
    [1, 8, 15, 22, 29].forEach(function (d) {
      if (d <= n) s += '<text x="' + x(d) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--label2)">' + d + '</text>';
    });
    var byDay = {};
    ds.forEach(function (p) { byDay[p.d.getDate()] = p.r; });
    ds.forEach(function (p) { s += '<circle cx="' + x(p.d.getDate()).toFixed(1) + '" cy="' + yy(p.r) + '" r="6.5" fill="' + col(p.r) + '"/>'; });
    for (var d = 1; d < n; d++) {
      if (byDay[d] == null) continue;
      var to = byDay[d + 1] != null ? d + 1 : (byDay[d + 2] != null ? d + 2 : 0);
      if (to) s += '<line x1="' + x(d).toFixed(1) + '" y1="' + yy(byDay[d]) + '" x2="' + x(to).toFixed(1) + '" y2="' + yy(byDay[to]) + '" stroke="var(--label)" stroke-width="1.1" stroke-linecap="round"' + (to === d + 2 ? ' stroke-dasharray="2.5 3"' : "") + "/>";
    }
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
    return "<" + tag + ' class="day"><span class="badge" style="background:' + col(p.r) + ';color:' + on(p.r) + '">' + p.r + '</span><span><div class="when">' +
      p.d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + '</div><div class="ph" style="color:' + ink(p.r) + '">' + phaseOf(p.r).name + "</div>" +
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
  var day = today(), selected = null, tapped = false, savedRating = null, savedNote = "";
  var grid = $("rating-grid"), noteEl = $("note"), saveBtn = $("save"), dayInput = $("day");
  var rateBtns = [];
  SCALE.forEach(function (_, v) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "rate"; b.textContent = v;
    b.style.setProperty("--c", col(v)); b.style.setProperty("--on", on(v));
    b.setAttribute("aria-label", v + ", " + phaseOf(v).name);
    b.addEventListener("click", function () { selected = selected === v ? null : v; tapped = true; renderToday(); if (navigator.vibrate) navigator.vibrate(8); });
    rateBtns.push(b);
  });
  // Rating: dots on a line in rows, with the phase names underneath each row.
  var ROWS = [[0, 3], [4, 6], [7, 10]]; // low, balanced, high
  var SHORT = { "Severe Depression": "Severe", "Mild to Moderate Depression": "Mild", "Balanced Mood": "Balanced", "Hypomania": "Hypo", "Mania": "Mania" };
  grid.classList.add("rows-" + ROWS.length);
  ROWS.forEach(function (r) {
    var n = r[1] - r[0] + 1, row = document.createElement("div"); row.className = "rate-line"; row.style.setProperty("--n", n);
    var bar = document.createElement("div"); bar.className = "rate-bar";
    for (var v = r[0]; v <= r[1]; v++) bar.appendChild(rateBtns[v]);
    var groups = document.createElement("div"); groups.className = "rate-groups";
    PHASES.slice().reverse().forEach(function (p) {
      var lo = Math.max(p.lo, r[0]), hi = Math.min(p.hi, r[1]); if (lo > hi) return;
      var x = document.createElement("span"); x.style.gridColumn = "span " + (hi - lo + 1); x.style.setProperty("--c", col(p.lo)); x.style.color = ink(p.lo);
      x.textContent = SHORT[p.name]; groups.appendChild(x);
    });
    row.appendChild(bar); row.appendChild(groups); grid.appendChild(row);
  });

  // Note: grows as you type, with a character count.
  function growNote() { noteEl.style.height = "auto"; noteEl.style.height = Math.max(noteEl.scrollHeight, 44) + "px"; $("note-count").textContent = noteEl.value.length ? String(noteEl.value.length) : ""; }
  noteEl.addEventListener("input", growNote);

  function setDay(d) {
    day = d; tapped = false;
    var e = entries[keyOf(d)];
    if (e && !e.deleted) { selected = e.rating; noteEl.value = e.note || ""; savedRating = e.rating; savedNote = e.note || ""; }
    else { selected = null; noteEl.value = ""; savedRating = null; savedNote = ""; }
    growNote();
    dayInput.value = keyOf(d);
    dayInput.max = keyOf(today());
    var diff = Math.round((today() - d) / 864e5);
    $("today-title").textContent = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-GB", { weekday: "long" });
    $("today-date").textContent = d.toLocaleDateString("en-GB", diff > 1 && d.getFullYear() !== today().getFullYear() ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "long" });
    renderToday();
  }

  function renderToday() {
    grid.classList.toggle("picked", tapped && selected !== null);
    var after = $("after-pick"), wasClosed = after.classList.contains("closed");
    after.classList.toggle("closed", selected === null);
    after.inert = selected === null;
    if (wasClosed && selected !== null) growNote();
    if (after.classList.contains("instant")) requestAnimationFrame(function () { requestAnimationFrame(function () { after.classList.remove("instant"); }); });
    rateBtns.forEach(function (b, v) {
      b.setAttribute("aria-pressed", v === selected ? "true" : "false");
    });
    var slot = $("level-slot");
    if (selected !== null) {
      var dir = selected > 6 ? "up" : selected < 4 ? "down" : "level";
      var arrow = { up: "M7 17L17 7M8.5 7H17v8.5", level: "M5 12h14M13 6l6 6-6 6", down: "M7 7l10 10M17 8.5V17H8.5" }[dir];
      slot.innerHTML = '<div class="level" style="--c:' + col(selected) + ';--on:' + on(selected) + '">' +
        '<div class="level-top"><span class="level-big">' + selected + '</span><button type="button" class="ring more" aria-label="More about this mood">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + arrow + '"/></svg></button></div>' +
        '<div class="phase">' + phaseOf(selected).name + '</div><p>' + SCALE[selected] + '</p></div>';
    }
    renderStreak();
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

  // ---------- More about a mood (Bipolar UK Mood Scale; tips from Bipolar UK, NHS and Mind) ----------
  var SRC = {
    buk: ["Bipolar UK: Mood Scale", "https://www.bipolaruk.org/get-support/track-your-mood/mood-scale/"],
    nhs: ["NHS: Bipolar disorder", "https://www.nhs.uk/mental-health/conditions/bipolar-disorder/"],
    mind: ["Mind: Bipolar self-care", "https://www.mind.org.uk/information-support/types-of-mental-health-problems/bipolar-disorder/self-care/"],
    moods: ["Mind: Bipolar moods", "https://www.mind.org.uk/information-support/types-of-mental-health-problems/bipolar-disorder/bipolar-moods-symptoms/"]
  };
  var INFO = {
    "Mania": {
      about: "9 and 10 are the top of the scale. Mania usually lasts a week or more and can make everyday life hard to manage. It can include losing touch with reality.",
      watch: ["Little or no sleep", "Racing thoughts and fast speech", "Risky or impulsive choices, like big spending"],
      help: ["Let your doctor or care team know. Severe mania often needs medical treatment.", "Follow the plan you made while you were well.", "Let the people close to you help. They can also help you piece together what happened afterwards.", "Avoid alcohol and recreational drugs."],
      src: ["buk", "moods", "nhs", "mind"]
    },
    "Hypomania": {
      about: "7 and 8 are on the high side of the scale. Hypomania is a milder form of mania that lasts 4 days or more. It can feel good, but it's worth watching.",
      watch: ["Needing less sleep", "Racing thoughts", "Feeling very sociable or talkative", "Impulsive spending"],
      help: ["Keep to your routine for meals, sleep and medication. It can help you feel calmer.", "Exercise can help use up extra energy.", "Cut back on caffeine and alcohol, and avoid recreational drugs.", "Tell someone you trust, so they can help you notice if it keeps rising."],
      src: ["buk", "nhs", "mind", "moods"]
    },
    "Balanced Mood": {
      about: "4 to 6 is the middle of the scale, the range people without a mood disorder usually sit in. It's a good time to look after your routine and plan ahead.",
      watch: ["Changes in sleep", "Changes in appetite or eating", "Changes in how you behave or spend time"],
      help: ["Keep a steady routine for meals, sleep, relaxation and taking medication at the same time each day.", "Learn your triggers, like stress, lack of sleep, busy periods or big life events.", "Share your early warning signs with family and friends.", "While you're well, make a plan for how you'd like to be supported if you become unwell.", "Go easy on caffeine and alcohol, and avoid very long hours where you can."],
      src: ["buk", "mind", "nhs"]
    },
    "Mild to Moderate Depression": {
      about: "2 and 3 are on the low side of the scale. Everything can feel slower and harder, and that's part of the low mood, not a failing.",
      watch: ["Sleeping a lot more or less", "Losing your appetite", "Wanting to be alone"],
      help: ["Keep to a simple routine. It can help with motivation when your mood is low.", "Try gentle exercise, like a walk, yoga or swimming.", "Get enough sleep and eat regular, healthy meals.", "Keep taking medication as prescribed, and don't stop without your doctor's advice.", "Tell the people close to you what helps. Talking therapy, such as CBT, can also help."],
      src: ["buk", "mind", "nhs"]
    },
    "Severe Depression": {
      about: "0 and 1 are the bottom of the scale. Severe depression is serious and may need extra treatment, so this is a time to involve your doctor or care team.",
      watch: ["Hardly moving or doing anything", "Feeling hopeless or guilty", "Finding it very hard to look after yourself"],
      help: ["Contact your doctor or care team and let them know how you're doing.", "Follow the plan you made while you were well.", "Let someone close to you know. They can help you get support.", "Keep taking medication as prescribed."],
      src: ["buk", "moods", "nhs", "mind"]
    }
  };
  function list(a) { return "<ul>" + a.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>"; }
  function openInfo(v) {
    var p = phaseOf(v), d = INFO[p.name];
    $("info-title").textContent = p.name;
    $("info-body").innerHTML =
      '<div class="info-hero" style="--c:' + col(v) + ';--on:' + on(v) + '"><span class="info-range">' + p.lo + "–" + p.hi + '</span><div class="phase">' + p.name + "</div><p>" + esc(d.about) + "</p></div>" +
      '<section class="info-card"><h3>Signs to notice</h3>' + list(d.watch) + "</section>" +
      '<section class="info-card"><h3>Things that can help</h3>' + list(d.help) + "</section>" +
      '<section class="info-card info-src"><h3>Sources</h3>' + d.src.map(function (k) { return '<a href="' + SRC[k][1] + '" target="_blank" rel="noopener">' + SRC[k][0] + "</a>"; }).join("") +
      '<p class="caption">General information, not advice from your own doctor. Your scale is the Bipolar UK Mood Scale.</p></section>';
    $("info").hidden = false; document.body.style.overflow = "hidden";
    $("info-body").scrollTop = 0;
  }
  function closeInfo() { $("info").hidden = true; document.body.style.overflow = ""; }
  $("info-done").addEventListener("click", closeInfo);
  $("info").addEventListener("click", function (e) { if (e.target === $("info")) closeInfo(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("info").hidden) closeInfo(); });
  $("level-slot").addEventListener("click", function (e) { if (e.target.closest(".more") && selected !== null) openInfo(selected); });

  // ---------- 4+ days in a row at 3 or lower, or 7 or higher ----------
  function streak() {
    var d = today(), e = entries[keyOf(d)];
    if (!e || e.deleted) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    var dir = 0, n = 0, last = null;
    for (;;) {
      e = entries[keyOf(d)];
      if (!e || e.deleted) break;
      var s = e.rating >= 7 ? 1 : e.rating <= 3 ? -1 : 0;
      if (!s || (dir && s !== dir)) break;
      dir = s; n++; if (last === null) last = e.rating;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    return n >= 4 ? { dir: dir, n: n, last: last } : null;
  }
  function renderStreak() {
    var st = streak(), slot = $("streak-slot");
    if (!st) { slot.innerHTML = ""; return; }
    slot.innerHTML = '<button type="button" class="streak" style="--c:' + col(st.last) + ';--on:' + on(st.last) + '">' +
      '<span class="streak-n">' + st.n + '</span><span class="streak-t">' + "days in a row at " + (st.dir > 0 ? "7 or higher" : "3 or lower") + "</span>" +
      '<span class="streak-more">Tips</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
    slot.firstChild.addEventListener("click", function () { openInfo(st.last); });
  }

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
  // The PDF library is only loaded once a report is opened, so the PDF is ready by the time a button is tapped.
  var pdfLib = null, pdfFonts = null;
  function fontB64(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }).then(function (buf) {
      var b = new Uint8Array(buf), str = "";
      for (var i = 0; i < b.length; i += 0x8000) str += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return btoa(str);
    });
  }
  function loadPDF() {
    if (!pdfLib) pdfLib = new Promise(function (ok, fail) {
      var n = 0;
      ["vendor/jspdf.umd.min.js", "report-pdf.js"].forEach(function (src) {
        var s = document.createElement("script"); s.src = src;
        s.onload = function () { if (++n === 2) ok(); };
        s.onerror = function () { pdfLib = null; fail(new Error("Could not load " + src)); };
        document.head.appendChild(s);
      });
    });
    // DM Sans for the PDF; if it can't load, the PDF falls back to Helvetica.
    if (!pdfFonts) Promise.all([fontB64("fonts/DMSans-Regular.ttf"), fontB64("fonts/DMSans-Bold.ttf")])
      .then(function (f) { pdfFonts = { regular: f[0], bold: f[1] }; }, function () {});
    return pdfLib;
  }
  function reportFile(y, m) {
    var t = today();
    var doc = window.buildReportPDF(window.jspdf.jsPDF, {
      year: y, month: m + 1, fonts: pdfFonts, today: { year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() },
      days: monthDays(y, m).map(function (p) { return { day: p.d.getDate(), rating: p.r, note: p.n }; })
    });
    var name = "Mood report " + monthTitle(y, m) + ".pdf";
    return new File([doc.output("blob")], name, { type: "application/pdf" });
  }
  function download(file) {
    var url = URL.createObjectURL(file), a = document.createElement("a");
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  // On iPhone the share sheet is the way to save a file ("Save to Files"); elsewhere the PDF downloads.
  function savePDF(y, m, preferShare) {
    if (!window.buildReportPDF || !window.jspdf) { toast("Getting the PDF ready, try again in a moment"); loadPDF().catch(function () { toast("Couldn't load the PDF maker. Check your connection."); }); return; }
    var file;
    try { file = reportFile(y, m); } catch (e) { toast("Couldn't make the PDF: " + e.message); return; }
    var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if ((preferShare || touch) && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: file.name.replace(/\.pdf$/, "") }).catch(function (e) { if (e && e.name !== "AbortError") download(file); });
    } else download(file);
  }
  function openReport(y, m) {
    reportMonth = [y, m];
    loadPDF().catch(function () {});
    $("sheet-title").textContent = monthTitle(y, m);
    $("paper").innerHTML = reportHTML(y, m);
    $("print-report").addEventListener("click", function () { savePDF(y, m, false); });
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
    if (window.buildReportPDF && window.jspdf && navigator.canShare) {
      try { var f = reportFile(y, m); if (navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: f.name.replace(/\.pdf$/, "") }).catch(function () {}); return; } } catch (_) {}
    }
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
    return '<div class="scale-item"><span class="badge" style="background:' + col(s[0]) + ';color:' + on(s[0]) + '">' + s[0] + '</span><div><div class="ph" style="color:' + ink(s[0]) + '">' + phaseOf(s[0]).name + "</div><p>" + s[1] + "</p></div></div>";
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
  (function () { var sp = $("splash"); if (!sp) return; sp.classList.remove("show"); setTimeout(function () { sp.remove(); }, 350); })();
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
