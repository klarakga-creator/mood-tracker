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
      stroke(color, 0.3); doc.circle(cx, cy, dr, "S");
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
