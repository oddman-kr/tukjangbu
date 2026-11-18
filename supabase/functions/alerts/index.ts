// 휴대폰 알림(로그인 버전): 앱의 기기 열쇠로 이 가족의 새 소식을 알려 줘요
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Recur from "./recur.js";

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
function serviceKey(): string {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = o.default ?? Object.values(o)[0]; if (v) return String(v); } catch (_) { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const pad = (n: number) => (n < 10 ? "0" : "") + n;
// 한국 시간 기준 날짜
function kst(d = new Date()) { const k = new Date(d.getTime() + 9 * 3600e3); return k.getUTCFullYear() + "-" + pad(k.getUTCMonth() + 1) + "-" + pad(k.getUTCDate()); }
function addDays(ymd: string, n: number) { const [y, m, d] = ymd.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.getUTCFullYear() + "-" + pad(x.getUTCMonth() + 1) + "-" + pad(x.getUTCDate()); }
function diffDays(a: string, b: string) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
async function sha256(t: string) { const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req) => {
  try {
    const { token, since = "" } = await req.json();
    if (!token || String(token).length < 20) return json({ alerts: [] }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });
    const { data: dev } = await db.from("device_tokens").select("id,user_id,household_id").eq("token_hash", await sha256(String(token))).maybeSingle();
    if (!dev) return json({ alerts: [] }, 401);
    await db.from("device_tokens").update({ last_seen: new Date().toISOString() }).eq("id", dev.id);
    const hh = dev.household_id;
    const [{ data: members }, { data: house }, { data: sub }] = await Promise.all([
      db.from("members").select("id,user_id,role,display_name,monthly_allowance,allowance_period").eq("household_id", hh),
      db.from("households").select("month_start,trial_ends_at").eq("id", hh).maybeSingle(),
      db.from("subscriptions").select("plan,status,expires_at").eq("household_id", hh).maybeSingle(),
    ]);
    const me = (members ?? []).find((m) => m.user_id === dev.user_id);
    if (!me) return json({ alerts: [] });
    const name = (id: string | null) => (members ?? []).find((m) => m.id === id)?.display_name ?? "가족";
    const plus = (sub && sub.plan !== "free" && sub.status === "active" && (!sub.expires_at || Date.parse(sub.expires_at) > Date.now())) || (house?.trial_ends_at && Date.parse(house.trial_ends_at) > Date.now());
    const today = kst(), out: { id: string; title: string; body: string }[] = [];

    if (me.role === "child") {
      const { data: ws } = await db.from("wishes").select("client_id,id,name,status,reply,handled_at,handled_by").eq("household_id", hh).eq("requested_by", me.id).in("status", ["승인", "거절", "보류"]);
      (ws ?? []).filter((w) => w.handled_at && (!since || w.handled_at > since)).forEach((w) => out.push({
        id: "ans_" + (w.client_id || w.id) + "_" + w.handled_at, title: name(w.handled_by) + "님이 “" + w.name + "” 요청을 " + (w.status === "승인" ? "승인했어요 🙆" : w.status === "보류" ? "보류했어요 🤔" : "거절했어요"), body: w.reply || "앱에서 확인해 보세요" }));
      return json({ alerts: out });
    }
    // 1) 아이들 사 주세요 요청
    const { data: reqs } = await db.from("wishes").select("client_id,id,name,price,reason,request_msg,requested_by").eq("household_id", hh).eq("status", "요청");
    (reqs ?? []).forEach((w) => out.push({ id: "req_" + (w.client_id || w.id), title: name(w.requested_by) + "님이 “" + w.name + "” 사 달래요", body: [w.price ? won(Number(w.price)) + "원" : "", w.reason || w.request_msg || ""].filter(Boolean).join(" · ") || "앱에서 확인해 보세요" }));

    // 2) 자녀 용돈 50% 이하
    const ms = Math.min(28, Math.max(1, Number(house?.month_start) || 1));
    const kids = (members ?? []).filter((m) => m.role === "child" && Number(m.monthly_allowance) > 0);
    if (kids.length) {
      const { data: tx } = await db.from("transactions").select("member_id,amount_base,date").eq("household_id", hh).eq("type", "지출").eq("scope", "개인").is("deleted_at", null).gte("date", addDays(today, -40)).in("member_id", kids.map((k) => k.id));
      kids.forEach((k) => {
        let from: string, to: string;
        if (k.allowance_period === "주") { const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; from = addDays(today, -dow); to = addDays(from, 6); }
        else { const [y, m, d] = today.split("-").map(Number); const st = d >= ms ? new Date(Date.UTC(y, m - 1, ms)) : new Date(Date.UTC(y, m - 2, ms)); from = st.toISOString().slice(0, 10); to = addDays(new Date(Date.UTC(st.getUTCFullYear(), st.getUTCMonth() + 1, ms)).toISOString().slice(0, 10), -1); }
        const amt = Number(k.monthly_allowance), used = (tx ?? []).filter((t) => t.member_id === k.id && t.date >= from && t.date <= to).reduce((a, t) => a + Number(t.amount_base), 0), left = amt - used;
        if (left <= amt * 0.5) out.push({ id: "allow_" + k.display_name + "_" + from + "_" + (left <= 0 ? "out" : "half"), title: k.display_name + "님 용돈이 " + (left <= 0 ? "다 떨어졌어요" : "절반 이하로 남았어요"), body: (k.allowance_period === "주" ? "이번 주 " : "이번 달 ") + won(used) + " / " + won(amt) + "원 썼어요" });
      });
    }

    // 3) 다가오는 정기 지출
    const { data: recs } = await db.from("recurring").select("id,client_id,description,amount,cycle,every,starts_on,day,remind_days,active").eq("household_id", hh).eq("active", true).gt("remind_days", 0);
    (recs ?? []).forEach((r) => {
      const nx = Recur.next({ cycle: r.cycle, every: r.every, start: r.starts_on, day: r.day }, addDays(today, 1));
      if (!nx) return;
      const d = diffDays(today, nx);
      if (d >= 1 && d <= r.remind_days) out.push({ id: "rec_" + (r.client_id || r.id) + "_" + nx, title: r.description + " " + (d === 1 ? "내일" : d + "일 뒤") + " 나가요", body: Number(nx.slice(5, 7)) + "월 " + Number(nx.slice(8)) + "일 · " + won(Number(r.amount)) + "원" });
    });

    // 4) 카드 결제일 이틀 전 (플러스)
    if (plus) {
      const { data: cards } = await db.from("cards").select("name,kind,pay_day,use_from,use_back,bills").eq("household_id", hh).not("pay_day", "is", null);
      for (const c of cards ?? []) {
        if ((c.kind || "신용") !== "신용") continue;
        const pd = Number(c.pay_day); let f = Number(c.use_from) || 0, b = Number(c.use_back) || 0;
        if (!f) { f = pd - 13; b = 1; if (f < 1) { f += 30; b = 2; } }
        const dayIn = (y: number, m0: number, d: number) => { const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m0, Math.min(d, last))); };
        const [y, m] = today.split("-").map(Number);
        for (let k = 0; k < 2; k++) {
          const pay = dayIn(y, m - 1 + k, pd), ps = pay.toISOString().slice(0, 10);
          if (ps < today) continue;
          const dl = diffDays(today, ps);
          if (dl > 2) break;
          const fromD = dayIn(pay.getUTCFullYear(), pay.getUTCMonth() - (b || 1), f), nxt = dayIn(fromD.getUTCFullYear(), fromD.getUTCMonth() + 1, f);
          const from = fromD.toISOString().slice(0, 10), to = addDays(nxt.toISOString().slice(0, 10), -1), ym = ps.slice(0, 7);
          let amt = c.bills && c.bills[ym] ? Number(c.bills[ym]) : 0; const act = !!amt;
          if (!amt) { const { data: t2 } = await db.from("transactions").select("amount_base").eq("household_id", hh).eq("type", "지출").eq("method", c.name).is("deleted_at", null).gte("date", from).lte("date", to); amt = (t2 ?? []).reduce((a, t) => a + Number(t.amount_base), 0); }
          if (amt) out.push({ id: "bill_" + c.name + "_" + ym, title: c.name + " 카드값 " + (dl === 0 ? "오늘" : dl === 1 ? "내일" : "모레") + " 나가요", body: Number(ps.slice(5, 7)) + "월 " + Number(ps.slice(8)) + "일 · " + won(amt) + "원" + (act ? "" : " (기록 기준 예상)") });
          break;
        }
      }
    }
    return json({ alerts: out });
  } catch (_e) {
    return json({ alerts: [] }, 500);
  }
});
