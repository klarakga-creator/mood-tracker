// @ts-nocheck: the copied-in report-pdf.js is plain JavaScript.
// Mood Tracker server: daily push reminders and the monthly email report.
// Runs every 15 minutes (see supabase-reminders.sql) and answers the app's test buttons.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { jsPDF } from "npm:jspdf@4.2.1";

// ---- report-pdf.js (copied in; Supabase cannot import it from the website) ----
/* Monthly mood report as a PDF (A4, two or three pages).
   The same file runs in the app (browser) and is copied into the email server
   (supabase/functions/mood/index.ts) between the "report-pdf.js" markers.
   Usage: buildReportPDF(jsPDF, { year, month, days: [{ day, rating, note }], today? }) returns a jsPDF document.
   month is 1-12, day is the day of the month, today is { year, month, day } to blank out days still to come. */
(function (root) {
  "use strict";

  // c: fill colour, t: text colour on white, on: text colour on top of the fill
  var PHASES = [
    { name: "Mania", lo: 9, hi: 10, c: "#B44E4B", t: "#9E3F3C", on: "#FFFFFF" },
    { name: "Hypomania", lo: 7, hi: 8, c: "#D47F50", t: "#B5612F", on: "#FFFFFF" },
    { name: "Balanced Mood", lo: 4, hi: 6, c: "#3E635C", t: "#3E635C", on: "#FFFFFF", band: ["Balanced Mood"] },
    { name: "Mild to Moderate Depression", lo: 2, hi: 3, c: "#D8A5C0", t: "#A8628A", on: "#2E2B28", band: ["Mild to Moderate", "Depression"] },
    { name: "Severe Depression", lo: 0, hi: 1, c: "#848BBA", t: "#5E66A0", on: "#FFFFFF" }
  ];
  function phaseOf(v) { for (var i = 0; i < PHASES.length; i++) if (v >= PHASES[i].lo && v <= PHASES[i].hi) return PHASES[i]; return PHASES[2]; }

  var INK = "#2E2B28", INK2 = "#3A3A3C", MUTED = "#6E6E73", FAINT = "#8E8E93", FAINTER = "#AEAEB2", LINE = "#E5E5EA";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  // Colour mixed with white, so tints need no transparency.
  function tint(hex, a) { var c = rgb(hex); return c.map(function (v) { return Math.round(255 - (255 - v) * a); }); }
  // The built-in PDF font covers Western European text; drop anything else (such as emoji).
  var EXTRA = "“”‘’–—…•€™·";
  function clean(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFC");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], c = s.charCodeAt(i);
      if (ch === "\n" || ch === "\r" || ch === "\t") out += " ";
      else if ((c >= 32 && c < 127) || (c >= 160 && c < 256) || EXTRA.indexOf(ch) >= 0) out += ch;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function buildReportPDF(jsPDF, data) {
    var Y = data.year, M = data.month, dim = new Date(Date.UTC(Y, M, 0)).getUTCDate();
    var title = MONTHS[M - 1] + " " + Y;
    var lastDay = dim;
    if (data.today && data.today.year === Y && data.today.month === M) lastDay = data.today.day;
    var byDay = {};
    (data.days || []).forEach(function (d) { if (d.day >= 1 && d.day <= dim && d.rating != null) byDay[d.day] = { day: d.day, rating: +d.rating, note: clean(d.note) }; });
    var days = [];
    for (var d = 1; d <= dim; d++) if (byDay[d]) days.push(byDay[d]);
    var rs = days.map(function (x) { return x.rating; }), n = rs.length;
    var avg = n ? rs.reduce(function (a, b) { return a + b; }, 0) / n : 0;
    var sd = n ? Math.sqrt(rs.reduce(function (a, b) { return a + (b - avg) * (b - avg); }, 0) / n) : 0;
    function count(f) { return rs.filter(f).length; }
    function inPhase(p) { return count(function (v) { return v >= p.lo && v <= p.hi; }); }
    function weekday(day) { return new Date(Date.UTC(Y, M - 1, day)).getUTCDay(); }

    var doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    doc.setProperties({ title: "Mood report " + title, creator: "Mood Tracker" });
    var L = 15, R = 195, W = R - L;

    // Optional custom fonts: data.fonts = { regular, bold, display? } as base64 TTF. Big bold text uses display when given.
    var FAM = "helvetica", DISP = null;
    if (data.fonts && data.fonts.regular && data.fonts.bold) {
      doc.addFileToVFS("body-r.ttf", data.fonts.regular); doc.addFont("body-r.ttf", "Body", "normal");
      doc.addFileToVFS("body-b.ttf", data.fonts.bold); doc.addFont("body-b.ttf", "Body", "bold");
      FAM = "Body";
      if (data.fonts.display) { doc.addFileToVFS("disp.ttf", data.fonts.display); doc.addFont("disp.ttf", "Display", "bold"); DISP = "Display"; }
    }
    function font(size, weight, color) { doc.setFont(DISP && weight === "bold" && size >= 13 ? DISP : FAM, weight || "normal"); doc.setFontSize(size); if (color) doc.setTextColor.apply(doc, typeof color === "string" ? rgb(color) : color); }
    function fill(c) { doc.setFillColor.apply(doc, typeof c === "string" ? rgb(c) : c); }
    function stroke(c, w) { doc.setDrawColor.apply(doc, typeof c === "string" ? rgb(c) : c); doc.setLineWidth(w || 0.2); }
    function dash(p) { doc.setLineDashPattern(p || [], 0); }
    function tw(s) { return doc.getTextWidth(s); }
    // Draws runs of [text, weight, color] on one line, starting at x.
    function runs(parts, x, y, size) {
      parts.forEach(function (p) { font(size, p[1], p[2]); doc.text(p[0], x, y); x += tw(p[0]); });
      return x;
    }
    function runsWidth(parts, size) { var w = 0; parts.forEach(function (p) { font(size, p[1], p[2]); w += tw(p[0]); }); return w; }
    function badge(x, y, r, rating, size) {
      if (rating == null) {
        fill("#FFFFFF"); stroke("#C7C7CC", 0.25); dash([0.6, 0.6]); doc.circle(x, y, r, "FD"); dash();
        font(size, "bold", FAINTER); doc.text("-", x, y + size * 0.125, { align: "center" });
        return;
      }
      fill(phaseOf(rating).c); doc.circle(x, y, r, "F");
      font(size, "bold", phaseOf(rating).on); doc.text(String(rating), x, y + size * 0.125, { align: "center" });
    }

    // ================= Page 1: the graph =================
    font(9, "bold", FAINT); doc.setCharSpace(0.6); doc.text("MOOD REPORT", L, 26); doc.setCharSpace(0);
    font(30, "bold", INK); doc.text(title, L, 38);

    // Three key numbers, top right
    var stats3 = [[n ? avg.toFixed(1) : "-", "", "average mood"],
      [n ? Math.min.apply(null, rs) + "\u2013" + Math.max.apply(null, rs) : "-", "", "lowest to highest"]];
    var sx3 = R;
    stats3.slice().reverse().forEach(function (st, i) {
      font(20, "bold"); var w1 = tw(st[0]); font(11, "normal"); var w2 = st[1] ? tw(st[1]) : 0;
      font(8.5, "normal"); var w = Math.max(w1 + w2, tw(st[2])), x = sx3 - w;
      font(20, "bold", INK); doc.text(st[0], x, 33.5);
      if (st[1]) { font(11, "normal", FAINT); doc.text(st[1], x + w1, 33.5); }
      font(8.5, "normal", FAINT); doc.text(st[2], x, 38.5);
      if (i < stats3.length - 1) { stroke(LINE, 0.3); doc.line(x - 6, 27, x - 6, 39.5); }
      sx3 = x - 12;
    });
    stroke(LINE, 0.3); doc.line(L, 45, R, 45);

    // Chart card: squared grid, one row per rating, big circles joined by a thin line
    var bx = L, by = 51, bh = 134;
    fill("#ECE7E0"); doc.roundedRect(bx, by, W, bh, 5, 5, "F");
    font(13, "bold", INK); doc.text("Mood over the month", bx + 6, by + 10);
    font(8.5, "normal", MUTED); doc.text("Each circle is one day's rating. The bars on the right show the five phases of the scale, and the dotted line is your average.", bx + 6, by + 16, { maxWidth: W - 12 });
    var px0 = L + 12, py0 = by + 24, py1 = by + bh - 13, cell = (py1 - py0) / 10;
    var cols = Math.floor((R - 37 - px0) / cell), px1 = px0 + cols * cell;
    function X(day) { return px0 + (day - 0.5) / dim * (px1 - px0); }
    function Yv(v) { return py0 + (10 - v) / 10 * (py1 - py0); }
    fill("#F6F3EE"); doc.rect(px0, py0, px1 - px0, py1 - py0, "F");
    stroke("#D6CFC5", 0.25);
    for (var gi = 0; gi <= cols; gi++) doc.line(px0 + gi * cell, py0, px0 + gi * cell, py1);
    for (var v = 0; v <= 10; v++) {
      doc.line(px0, Yv(v), px1, Yv(v));
      if (v % 2 === 0) { font(7.5, "normal", FAINT); doc.text(String(v), px0 - 3, Yv(v) + 1.1, { align: "right" }); }
    }
    PHASES.forEach(function (p) {
      var top = Yv(Math.min(10, p.hi + 0.5)), bot = Yv(Math.max(0, p.lo - 0.5));
      fill(p.c); doc.roundedRect(px1 + 2.5, top + 1, 0.9, bot - top - 2, 0.45, 0.45, "F");
      var lines = p.band || [p.name];
      font(7.5, "bold", p.t);
      lines.forEach(function (t, i) { doc.text(t, px1 + 5, (top + bot) / 2 + 1 - (lines.length - 1) * 1.6 + i * 3.2); });
    });
    for (d = 1; d <= dim; d++) {
      var lab = d === 1 || d % 5 === 0;
      font(7, "normal", lab ? FAINT : "#C7C7CC"); doc.text(lab ? String(d) : "\u00B7", X(d), py1 + 6, { align: "center" });
    }
    if (!n) {
      font(11, "normal", FAINT); doc.text("No days rated this month", (px0 + px1) / 2, (py0 + py1) / 2, { align: "center" });
    } else {
      var rad = Math.min(cell * 0.3, 2.6);
      days.forEach(function (p) { fill(phaseOf(p.rating).c); doc.circle(X(p.day), Yv(p.rating), rad, "F"); });
      stroke("#8A8A8A", 0.4); dash([0.1, 1.3]); doc.setLineCap("round"); doc.line(px0, Yv(avg), px1, Yv(avg)); dash();
      // Thin straight line through the centres, dashed over single missing days
      stroke(INK, 0.3); doc.setLineJoin("round");
      for (d = 1; d < dim; d++) {
        if (byDay[d] && byDay[d + 1]) doc.line(X(d), Yv(byDay[d].rating), X(d + 1), Yv(byDay[d + 1].rating));
        else if (byDay[d] && !byDay[d + 1] && byDay[d + 2]) { dash([0.8, 0.9]); doc.line(X(d), Yv(byDay[d].rating), X(d + 2), Yv(byDay[d + 2].rating)); dash(); }
      }

      // Callouts on the highest and lowest day
      function short(s) { return s.length > 48 ? s.slice(0, 46).replace(/\s+\S*$/, "") + "…" : s; }
      function callout(p, label, up) {
        var x = Math.min(Math.max(X(p.day), px0 + 26), px1 - 26), cy = Yv(p.rating), g = up ? -1 : 1;
        var hasNote = !!p.note, h = hasNote ? 7 : 3.5;
        var tTop = up ? cy - rad - 6 - h : cy + rad + 6;
        stroke("#B4B4B8", 0.25); doc.line(X(p.day), cy + g * (rad + 0.8), X(p.day), up ? tTop + h + 0.8 : tTop - 0.8);
        font(7.5, "bold", INK2); doc.text(label, x, tTop + 2.6, { align: "center" });
        if (hasNote) { font(7.5, "normal", MUTED); doc.text("“" + short(p.note) + "”", x, tTop + 6.4, { align: "center" }); }
      }
      var hiD = days.reduce(function (a, b) { return b.rating > a.rating ? b : a; });
      var loD = days.reduce(function (a, b) { return b.rating < a.rating ? b : a; });
      var dm = function (p) { return p.day + " " + MON3[M - 1]; };
      if (hiD.rating !== loD.rating) {
        callout(hiD, "Highest: " + hiD.rating + " on " + dm(hiD), hiD.rating <= 8);
        callout(loD, "Lowest: " + loD.rating + " on " + dm(loD), loD.rating < 2);
      }
    }

    // Four tiles
    var tiles = [["Balanced days", String(count(function (v) { return v >= 4 && v <= 6; })), "rated 4 to 6"],
      ["High days", String(count(function (v) { return v >= 7; })), "rated 7 or more"],
      ["Low days", String(count(function (v) { return v <= 3; })), "rated 3 or less"],
      ["Variability", n ? sd.toFixed(1) : "-", "lower means steadier"]];
    var tg = 3, twd = (W - tg * 3) / 4, ty = 192;
    tiles.forEach(function (t, i) {
      var x = L + i * (twd + tg);
      fill("#F1EDE7"); doc.roundedRect(x, ty, twd, 21, 4, 4, "F");
      font(8.5, "normal", MUTED); doc.text(t[0], x + 4, ty + 6);
      font(18, "bold", INK); doc.text(t[1], x + 4, ty + 14);
      font(7.5, "normal", FAINT); doc.text(t[2], x + 4, ty + 18.5);
    });

    // Time in each phase
    font(13, "bold", INK); doc.text("Time in each phase", L, 228);
    var order = PHASES.slice().reverse(), sy = 232, sh = 7;
    if (!n) { fill("#E5E5EA"); doc.roundedRect(L, sy, W, sh, 2, 2, "F"); }
    else {
      var used = order.filter(function (p) { return inPhase(p) > 0; }), sx = L;
      used.forEach(function (p, i) {
        var w = inPhase(p) / n * W; fill(p.c);
        if (used.length === 1) doc.roundedRect(sx, sy, w, sh, 2, 2, "F");
        else if (i === 0) { doc.roundedRect(sx, sy, w, sh, 2, 2, "F"); doc.rect(sx + w / 2, sy, w / 2 + 0.05, sh, "F"); }
        else if (i === used.length - 1) { doc.roundedRect(sx, sy, w, sh, 2, 2, "F"); doc.rect(sx - 0.05, sy, w / 2, sh, "F"); }
        else doc.rect(sx - 0.05, sy, w + 0.1, sh, "F");
        sx += w;
      });
    }
    var items = order.map(function (p) { return [p, [[p.name + " ", "normal", INK2], [String(inPhase(p)), "bold", INK]]]; });
    var lsize = 8.5, total = items.reduce(function (a, it) { return a + 4 + runsWidth(it[1], lsize); }, 0);
    if (total > W - 8) { lsize = 7.5; total = items.reduce(function (a, it) { return a + 4 + runsWidth(it[1], lsize); }, 0); }
    var gap = (W - total) / (items.length - 1), lx = L;
    items.forEach(function (it) {
      fill(it[0].c); doc.circle(lx + 1.3, 244.3, 1.3, "F");
      lx = runs(it[1], lx + 4, 245.3, lsize) + gap;
    });

    // ================= Page 2: calendar =================
    doc.addPage();
    function pageHead(h, right) {
      font(9, "bold", FAINT); doc.setCharSpace(0.6); doc.text(("Mood report · " + title).toUpperCase(), L, 26); doc.setCharSpace(0);
      font(22, "bold", INK); doc.text(h, L, 36);
      font(9, "normal", MUTED); doc.text(right, R, 36, { align: "right" });
      stroke(LINE, 0.3); doc.line(L, 42, R, 42);
    }
    pageHead("Daily log", "The month as a calendar");
    var lead = (weekday(1) + 6) % 7, rows = Math.ceil((lead + dim) / 7);
    var cg = 1.6, cw = (W - cg * 6) / 7, ch = rows > 5 ? 32 : 39, gy = 53;
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (t, i) {
      font(7.5, "bold", FAINT); doc.setCharSpace(0.4); doc.text(t.toUpperCase(), L + i * (cw + cg) + 1.5, gy - 3); doc.setCharSpace(0);
    });
    // Each day is a block with its rating in large type. The day of the month sits in a
    // small circle in the top right corner, with the block cut away around it.
    var cut = [], nsize = 7.4, lh = nsize * 0.3528 * 1.3, dr = 3.5;
    // Arc as Bezier curves from angle a to b (radians, y pointing down).
    function arcTo(cx, cy, R, a, b) {
      var steps = Math.ceil(Math.abs(b - a) / (Math.PI / 2)), st = (b - a) / steps;
      for (var q = 0; q < steps; q++) {
        var a0 = a + q * st, a1 = a0 + st, k = 4 / 3 * Math.tan(st / 4);
        doc.curveTo(cx + R * Math.cos(a0) - k * R * Math.sin(a0), cy + R * Math.sin(a0) + k * R * Math.cos(a0),
          cx + R * Math.cos(a1) + k * R * Math.sin(a1), cy + R * Math.sin(a1) - k * R * Math.cos(a1),
          cx + R * Math.cos(a1), cy + R * Math.sin(a1));
      }
    }
    // A rounded block whose top right corner bends smoothly around the day circle, leaving a gap.
    function notchedBlock(x, y, w, h, paint) {
      var rr = 3, cx = x + w - dr, cy = y + dr * 0.85, Rc = dr + 1, f = 2, P = Math.PI;
      var f1x = cx - Math.sqrt(Math.pow(Rc + f, 2) - Math.pow(y + f - cy, 2)), f1y = y + f;
      var f2x = x + w - f, f2y = cy + Math.sqrt(Math.pow(Rc + f, 2) - Math.pow(f2x - cx, 2));
      var t1 = Math.atan2(cy - f1y, cx - f1x), t2 = Math.atan2(cy - f2y, cx - f2x);
      var cA = Math.atan2(f1y - cy, f1x - cx), cB = Math.atan2(f2y - cy, f2x - cx);
      if (cA < cB) cA += 2 * P;
      if (t2 < 0) t2 += 2 * P;
      doc.moveTo(x + rr, y);
      doc.lineTo(f1x, y);
      arcTo(f1x, f1y, f, -P / 2, t1);
      arcTo(cx, cy, Rc, cA, cB);
      arcTo(f2x, f2y, f, t2, 2 * P);
      doc.lineTo(x + w, y + h - rr);
      arcTo(x + w - rr, y + h - rr, rr, 0, P / 2);
      doc.lineTo(x + rr, y + h);
      arcTo(x + rr, y + h - rr, rr, P / 2, P);
      doc.lineTo(x, y + rr);
      arcTo(x + rr, y + rr, rr, P, 1.5 * P);
      doc.close();
      if (paint === "F") doc.fill(); else doc.stroke();
    }
    function dayCircle(x, y, day, color) {
      var cx = x + w0 - dr, cy = y + dr * 0.85;
      fill("#ECE7E0"); doc.circle(cx, cy, dr, "F");
      font(8, "bold", color); doc.text(String(day), cx, cy + 1, { align: "center" });
    }
    var w0 = cw;
    for (d = 1; d <= dim; d++) {
      var idx = lead + d - 1, x = L + (idx % 7) * (cw + cg), y = gy + Math.floor(idx / 7) * (ch + cg);
      var e = byDay[d];
      if (d > lastDay) {
        stroke("#E3DED6", 0.25); notchedBlock(x, y, cw, ch, "S");
        dayCircle(x, y, d, "#C9C3BA");
        continue;
      }
      if (!e) {
        stroke("#CFC8BE", 0.25); dash([0.8, 0.8]); notchedBlock(x, y, cw, ch, "S"); dash();
        dayCircle(x, y, d, FAINTER);
        font(22, "bold", "#CFC8BE"); doc.text("\u2013", x + 2.6, y + 10.5);
        font(nsize, "normal", FAINTER); doc.text("Not rated", x + 2.6, y + 16);
        continue;
      }
      var p = phaseOf(e.rating);
      fill(p.c); notchedBlock(x, y, cw, ch, "F");
      dayCircle(x, y, d, INK);
      font(24, "bold", p.on); doc.text(String(e.rating), x + 2.6, y + 10.8);
      if (e.note) {
        font(nsize, "normal", p.on);
        var lines = doc.splitTextToSize(e.note, cw - 5), max = Math.floor((ch - 17) / lh);
        if (lines.length > max) {
          lines = lines.slice(0, max);
          var last = lines[max - 1];
          while (last.length && tw(last + "\u2026") > cw - 5) last = last.slice(0, -1);
          lines[max - 1] = last.replace(/\s+$/, "") + "\u2026";
          cut.push(e);
        }
        doc.text(lines, x + 2.6, y + 16.5, { lineHeightFactor: 1.3 });
      }
    }
    var ky = gy + rows * (ch + cg) + 4, kx = L;
    order.forEach(function (p) {
      fill(p.c); doc.roundedRect(kx, ky - 2.6, 3, 3, 0.8, 0.8, "F");
      font(8, "normal", MUTED); doc.text(p.name, kx + 4.3, ky); kx += 4.3 + tw(p.name) + 6;
    });
    if (cut.length) { font(8, "normal", FAINT); doc.text("Notes marked … continue on the next page.", L, ky + 6); }

    // ================= Page 3 (only when needed): long notes in full =================
    if (cut.length) {
      doc.addPage();
      pageHead("Notes in full", "Notes too long for the calendar");
      var yy = 52;
      cut.forEach(function (e) {
        font(9, "normal", INK2);
        var lines = doc.splitTextToSize(e.note, W - 34), h = Math.max(lines.length * 4.4, 5) + 4;
        if (yy + h > 275) { doc.addPage(); pageHead("Notes in full", "Continued"); yy = 52; }
        badge(L + 2.6, yy + 0.6, 2.5, e.rating, 8);
        font(9, "bold", INK); doc.text(WD[weekday(e.day)] + " " + e.day + " " + MON3[M - 1], L + 7.5, yy + 1.8);
        font(9, "normal", INK2); doc.text(lines, L + 34, yy + 1.8, { lineHeightFactor: 1.38 });
        yy += h;
        stroke(LINE, 0.2); doc.line(L, yy - 2, R, yy - 2);
        yy += 2;
      });
      }

    var count2 = doc.getNumberOfPages();
    for (var pg = 1; pg <= count2; pg++) {
      doc.setPage(pg);
      font(8, "normal", FAINTER);
      doc.text("Mood Tracker · report for " + title, L, 288);
      doc.text("Page " + pg + " of " + count2, R, 288, { align: "right" });
    }
    return doc;
  }

  if (typeof module === "object" && module.exports) module.exports = buildReportPDF;
  root.buildReportPDF = buildReportPDF;
})(typeof globalThis !== "undefined" ? globalThis : this);
// ---- end report-pdf.js ----

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_URL = "https://klarakga-creator.github.io/mood-tracker/";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- Secrets kept in the database (only this server can read them) ----------
async function secret(name: string, make: () => string): Promise<string> {
  const read = async () => (await db.from("app_secrets").select("value").eq("name", name).maybeSingle()).data?.value;
  const found = await read();
  if (found) return found;
  await db.from("app_secrets").upsert({ name, value: make() }, { onConflict: "name", ignoreDuplicates: true });
  return (await read())!;
}
let vapidReady: { publicKey: string; privateKey: string } | null = null;
async function vapid() {
  if (vapidReady) return vapidReady;
  const keys = JSON.parse(await secret("vapid", () => JSON.stringify(webpush.generateVAPIDKeys())));
  webpush.setVapidDetails(APP_URL, keys.publicKey, keys.privateKey);
  vapidReady = keys;
  return keys;
}

// ---------- Push ----------
async function pushTo(userId: string, payload: { title: string; body: string }) {
  await vapid();
  const { data: subs } = await db.from("push_subscriptions").select("endpoint, subscription").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return sent;
}

// ---------- Dates ----------
function localNow(tz: string) {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, y: +p.year, m: +p.month, d: +p.day, minutes: +p.hour * 60 + +p.minute };
}

// ---------- Monthly report email ----------
const PHASES = [
  { name: "Mania", lo: 9, hi: 10, c: "#FF3B30" },
  { name: "Hypomania", lo: 7, hi: 8, c: "#FF9500" },
  { name: "Balanced Mood", lo: 4, hi: 6, c: "#34C759" },
  { name: "Mild to Moderate Depression", lo: 2, hi: 3, c: "#007AFF" },
  { name: "Severe Depression", lo: 0, hi: 1, c: "#5856D6" },
];
const phaseOf = (v: number) => PHASES.find((p) => v >= p.lo && v <= p.hi) ?? PHASES[2];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function reportHTML(y: number, m: number, days: { day: string; rating: number; note: string }[]) {
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const r = days.map((d) => d.rating), n = r.length;
  const avg = n ? r.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(r.reduce((a, b) => a + (b - avg) ** 2, 0) / n) : 0;
  let swing = 0; for (let i = 1; i < n; i++) swing = Math.max(swing, Math.abs(r[i] - r[i - 1]));
  const count = (f: (x: number) => boolean) => r.filter(f).length;
  const byDay = new Map(days.map((d) => [+d.day.slice(8, 10), d]));
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const muted = "#6E6E73";

  // Bar chart: one column per day, height = rating, coloured by phase. Green tint marks the balanced range.
  const H = 14;
  let cols = "";
  for (let d = 1; d <= dim; d++) {
    const e = byDay.get(d);
    const h = e ? Math.max(e.rating * H, 4) : 0;
    const bar = e ? `<div style="height:${h}px;background:${phaseOf(e.rating).c};border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</div>` : "";
    cols += `<td valign="bottom" style="padding:0 1px;height:${10 * H}px;width:${Math.floor(100 / dim)}%">${bar}</td>`;
  }
  let labels = "";
  for (let d = 1; d <= dim; d++) labels += `<td align="center" style="font-size:9px;color:${muted};padding-top:4px">${d === 1 || d % 7 === 1 ? d : ""}</td>`;
  const chart = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:linear-gradient(to top,#fff 0,#fff ${3.5 * H}px,#E8F7EC ${3.5 * H}px,#E8F7EC ${6.5 * H}px,#fff ${6.5 * H}px);border-bottom:1px solid #D1D1D6"><tr>${cols}</tr></table>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${labels}</tr></table>`;

  const tile = (k: string, v: string, d = "") =>
    `<td width="50%" style="padding:5px"><div style="background:#fff;border-radius:14px;padding:12px 14px"><div style="font-size:12px;color:${muted}">${k}</div><div style="font-size:22px;font-weight:600">${v}</div>${d ? `<div style="font-size:11px;color:${muted}">${d}</div>` : ""}</div></td>`;
  const tiles = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>${tile("Average", avg.toFixed(1))}${tile("Days rated", `${n} of ${dim}`)}</tr>
    <tr>${tile("Balanced days", String(count((x) => x >= 4 && x <= 6)), "rated 4 to 6")}${tile("Range", n ? `${Math.min(...r)} to ${Math.max(...r)}` : "-", "lowest to highest")}</tr>
    <tr>${tile("High days", String(count((x) => x >= 7)), "rated 7 or more")}${tile("Low days", String(count((x) => x <= 3)), "rated 3 or less")}</tr>
    <tr>${tile("Variability", sd.toFixed(1), "lower means steadier")}${tile("Biggest change", String(swing), "between rated days")}</tr></table>`;

  const phases = PHASES.map((p) => {
    const c = count((x) => x >= p.lo && x <= p.hi), w = n ? Math.round((c / n) * 100) : 0;
    return `<tr><td style="padding:6px 0;font-size:14px"><span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${p.c};margin-right:8px"></span>${p.name}</td><td align="right" style="font-size:14px;color:${muted}">${c} ${c === 1 ? "day" : "days"}</td></tr>
      <tr><td colspan="2"><div style="background:#E5E5EA;border-radius:3px;height:6px"><div style="background:${p.c};width:${c ? Math.max(w, 2) : 0}%;height:6px;border-radius:3px;font-size:0;line-height:0">&nbsp;</div></div></td></tr>`;
  }).join("");

  const log = days.map((d) => {
    const ph = phaseOf(d.rating);
    const date = new Date(d.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return `<tr><td valign="top" width="44" style="padding:8px 0;border-bottom:1px solid #E5E5EA"><div style="width:32px;height:32px;border-radius:16px;background:${ph.c};color:#fff;font-weight:600;font-size:15px;line-height:32px;text-align:center">${d.rating}</div></td>
      <td valign="top" style="padding:8px 0;border-bottom:1px solid #E5E5EA"><div style="font-size:14px;font-weight:600">${date}</div><div style="font-size:12px;color:${ph.c}">${ph.name}</div>${d.note ? `<div style="font-size:14px;color:${muted};margin-top:2px">${esc(d.note)}</div>` : ""}</td></tr>`;
  }).join("");

  const card = (inner: string) => `<div style="background:#fff;border-radius:20px;padding:18px;margin:0 0 14px">${inner}</div>`;
  return `<!doctype html><html><body style="margin:0;background:#F2F2F7;font-family:${font};color:#000">
  <div style="max-width:600px;margin:0 auto;padding:24px 14px">
    <div style="padding:0 6px 16px"><div style="font-size:30px;font-weight:700;letter-spacing:-0.5px">Mood report</div><div style="font-size:19px;color:${muted}">${title}</div><div style="font-size:14px;color:${muted};margin-top:4px">${n} of ${dim} days rated, average ${avg.toFixed(1)}</div><div style="font-size:14px;color:${muted};margin-top:4px">The full report is attached as a PDF.</div></div>
    ${card(`<div style="font-size:17px;font-weight:600;margin-bottom:12px">Mood over the month</div>${chart}<div style="font-size:12px;color:${muted};margin-top:8px">Bar height is the day's rating (0 to 10). The green band is the balanced range (4 to 6).</div>`)}
    <div style="margin:0 -5px 9px">${tiles}</div>
    ${card(`<div style="font-size:17px;font-weight:600;margin-bottom:6px">Time in each phase</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${phases}</table>`)}
    ${card(`<div style="font-size:17px;font-weight:600;margin-bottom:4px">Daily log</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${log || `<tr><td style="color:${muted};font-size:14px;padding:8px 0">No days rated this month.</td></tr>`}</table>`)}
    <div style="text-align:center;padding:8px"><a href="${APP_URL}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open Mood Tracker</a></div>
  </div></body></html>`;
}

// ---------- PDF report ----------
// The PDF layout lives in the app's report-pdf.js; it is loaded from the live app when this function is deployed.
type ReportDay = { day: number; rating: number; note: string };
type ReportData = { year: number; month: number; days: ReportDay[]; fonts?: { regular: string; bold: string }; today?: { year: number; month: number; day: number } };
const buildReportPDF = (globalThis as unknown as { buildReportPDF: (lib: typeof jsPDF, data: ReportData) => jsPDF }).buildReportPDF;

// DM Sans from the live app; if it can't be fetched the PDF uses Helvetica.
let fontCache: { regular: string; bold: string } | undefined;
async function reportFonts() {
  if (fontCache) return fontCache;
  try {
    const get = async (f: string) => {
      const r = await fetch(APP_URL + "fonts/" + f);
      if (!r.ok) throw new Error(f);
      return toBase64(await r.arrayBuffer());
    };
    fontCache = { regular: await get("DMSans-Regular.ttf"), bold: await get("DMSans-Bold.ttf") };
  } catch (e) {
    console.error("font fetch failed", (e as Error).message);
  }
  return fontCache;
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sendReport(userId: string, email: string, y: number, m: number) {
  if (!RESEND_KEY) return { ok: false, error: "RESEND_API_KEY secret is missing" };
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const { data, error } = await db.from("entries").select("day, rating, note")
    .eq("user_id", userId).eq("deleted", false).gte("day", start).lt("day", end).order("day");
  if (error) return { ok: false, error: error.message };
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const t = new Date();
  const doc = buildReportPDF(jsPDF, { year: y, month: m, fonts: await reportFonts(), today: { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }, days: (data ?? []).map((d) => ({ day: +d.day.slice(8, 10), rating: d.rating, note: d.note })) });
  const pdf = toBase64(doc.output("arraybuffer"));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Mood Tracker <onboarding@resend.dev>", to: [email], subject: `Mood report ${title}`, html: reportHTML(y, m, data ?? []),
      attachments: [{ filename: `Mood report ${title}.pdf`, content: pdf }],
    }),
  });
  if (!res.ok) return { ok: false, error: `Email service said: ${await res.text()}` };
  return { ok: true };
}

// ---------- Every 15 minutes ----------
async function tick() {
  const { data: rows, error } = await db.from("settings").select("*");
  if (error) throw error;
  for (const s of rows ?? []) {
    const now = localNow(s.timezone || "UTC");
    if (s.daily) {
      const [h, mi] = String(s.reminder_time || "20:00").split(":").map(Number);
      if (now.minutes >= h * 60 + (mi || 0) && s.last_daily_sent !== now.date) {
        const { data: rated } = await db.from("entries").select("day").eq("user_id", s.user_id).eq("day", now.date).eq("deleted", false).maybeSingle();
        if (!rated) await pushTo(s.user_id, { title: "How was today?", body: "Take a moment to rate your mood." });
        await db.from("settings").update({ last_daily_sent: now.date }).eq("user_id", s.user_id);
      }
    }
    if (s.monthly && s.email && now.d === 1 && now.minutes >= 9 * 60) {
      const py = now.m === 1 ? now.y - 1 : now.y, pm = now.m === 1 ? 12 : now.m - 1;
      const key = `${py}-${String(pm).padStart(2, "0")}`;
      if (s.last_report_month !== key) {
        const r = await sendReport(s.user_id, s.email, py, pm);
        if (r.ok) await db.from("settings").update({ last_report_month: key }).eq("user_id", s.user_id);
        else console.error("report failed", r.error);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const action = new URL(req.url).searchParams.get("action") ?? "";
  try {
    if (action === "vapid") return json({ publicKey: (await vapid()).publicKey });

    if (action === "tick") {
      const cron = await secret("cron", () => crypto.randomUUID() + crypto.randomUUID());
      if (req.headers.get("x-cron-secret") !== cron) return json({ error: "forbidden" }, 403);
      await tick();
      return json({ ok: true });
    }

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "Please sign in again" }, 401);

    if (action === "test-push") {
      const sent = await pushTo(user.id, { title: "Test reminder", body: "Push notifications are working." });
      return json(sent ? { ok: true, sent } : { ok: false, error: "No device has notifications turned on yet" });
    }
    if (action === "test-report") {
      const body = await req.json().catch(() => ({}));
      const { data: s } = await db.from("settings").select("email").eq("user_id", user.id).maybeSingle();
      const email = s?.email || user.email;
      if (!email) return json({ ok: false, error: "Add your email in Settings first" });
      const now = new Date();
      const y = Number(body.year) || now.getUTCFullYear(), m = Number(body.month) || now.getUTCMonth() + 1;
      return json({ ...(await sendReport(user.id, email, y, m)), email });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
