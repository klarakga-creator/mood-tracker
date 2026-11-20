// Mood Tracker server: daily push reminders and the monthly email report.
// Runs every 15 minutes (see supabase-reminders.sql) and answers the app's test buttons.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

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
    <div style="padding:0 6px 16px"><div style="font-size:30px;font-weight:700;letter-spacing:-0.5px">Mood report</div><div style="font-size:19px;color:${muted}">${title}</div><div style="font-size:14px;color:${muted};margin-top:4px">${n} of ${dim} days rated, average ${avg.toFixed(1)}</div></div>
    ${card(`<div style="font-size:17px;font-weight:600;margin-bottom:12px">Mood over the month</div>${chart}<div style="font-size:12px;color:${muted};margin-top:8px">Bar height is the day's rating (0 to 10). The green band is the balanced range (4 to 6).</div>`)}
    <div style="margin:0 -5px 9px">${tiles}</div>
    ${card(`<div style="font-size:17px;font-weight:600;margin-bottom:6px">Time in each phase</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${phases}</table>`)}
    ${card(`<div style="font-size:17px;font-weight:600;margin-bottom:4px">Daily log</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${log || `<tr><td style="color:${muted};font-size:14px;padding:8px 0">No days rated this month.</td></tr>`}</table>`)}
    <div style="text-align:center;padding:8px"><a href="${APP_URL}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open Mood Tracker</a></div>
  </div></body></html>`;
}

async function sendReport(userId: string, email: string, y: number, m: number) {
  if (!RESEND_KEY) return { ok: false, error: "RESEND_API_KEY secret is missing" };
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const { data, error } = await db.from("entries").select("day, rating, note")
    .eq("user_id", userId).eq("deleted", false).gte("day", start).lt("day", end).order("day");
  if (error) return { ok: false, error: error.message };
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Mood Tracker <onboarding@resend.dev>", to: [email], subject: `Mood report ${title}`, html: reportHTML(y, m, data ?? []) }),
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
