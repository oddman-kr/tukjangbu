// 운영자 관리자 기능: 관리자 이메일 명단(admin_emails)에 있는 계정만 쓸 수 있어요. 모든 변경은 admin_audit에 남겨요.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
function serviceKey(): string {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = o.default ?? Object.values(o)[0]; if (v) return String(v); } catch (_) { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const providerOf = (u: any) => u.user_metadata?.provider === "naver" ? "naver" : u.is_anonymous ? "anonymous" : (u.app_metadata?.provider || "email");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const uc = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: me } = await uc.auth.getUser();
    if (!me?.user?.email) return json({ ok: false, message: "로그인이 필요해요" }, 401);
    const db = createClient(url, serviceKey(), { auth: { persistSession: false } });
    const { data: adm } = await db.from("admin_emails").select("email").ilike("email", me.user.email).maybeSingle();
    if (!adm) return json({ ok: false, message: "관리자만 쓸 수 있어요" }, 403);
    const adminEmail = me.user.email;
    const body = await req.json().catch(() => ({}));
    const act = String(body.action || "");
    const audit = (action: string, target: string, detail: unknown = null) => db.from("admin_audit").insert({ admin_email: adminEmail, action, target, detail });
    const adminSet = new Set(((await db.from("admin_emails").select("email")).data ?? []).map((x: any) => x.email.toLowerCase()));

    async function allUsers() {
      const out: any[] = [];
      for (let page = 1; page < 50; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        out.push(...data.users);
        if (data.users.length < 1000) break;
      }
      return out;
    }
    async function enrich(users: any[]) {
      const ids = users.map((u) => u.id);
      const { data: mem } = ids.length ? await db.from("members").select("id,user_id,household_id,role,display_name,joined_at").in("user_id", ids) : { data: [] };
      const hhIds = [...new Set((mem ?? []).map((m: any) => m.household_id))];
      const [{ data: hhs }, { data: subs }] = await Promise.all([
        hhIds.length ? db.from("households").select("id,name,owner_id,trial_ends_at,created_at").in("id", hhIds) : Promise.resolve({ data: [] }),
        hhIds.length ? db.from("subscriptions").select("household_id,plan,status,period,expires_at,source").in("household_id", hhIds) : Promise.resolve({ data: [] }),
      ]);
      const now = Date.now();
      return users.map((u) => {
        const m = (mem ?? []).find((x: any) => x.user_id === u.id);
        const h = m ? (hhs ?? []).find((x: any) => x.id === m.household_id) : null;
        const s = m ? (subs ?? []).find((x: any) => x.household_id === m.household_id) : null;
        const paid = !!(s && s.plan !== "free" && s.status === "active" && (!s.expires_at || Date.parse(s.expires_at) > now));
        const trial = !paid && !!(h?.trial_ends_at && Date.parse(h.trial_ends_at) > now);
        return {
          id: u.id, email: u.email || null, provider: providerOf(u), name: m?.display_name || u.user_metadata?.full_name || u.user_metadata?.name || "",
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until || null, admin: !!(u.email && adminSet.has(u.email.toLowerCase())),
          household: h ? { id: h.id, name: h.name, owner: h.owner_id === u.id, trial_ends_at: h.trial_ends_at } : null, role: m?.role || null,
          plan: paid ? "paid" : trial ? "trial" : h ? "free" : "-", sub: s ? { period: s.period, expires_at: s.expires_at, source: s.source, status: s.status } : null,
        };
      });
    }

    if (act === "users") {
      const q = String(body.q || "").trim().toLowerCase();
      let users = await allUsers();
      let rows = await enrich(users);
      if (q) rows = rows.filter((r) => [r.email, r.name, r.household?.name, r.id].some((v) => v && String(v).toLowerCase().includes(q)));
      const f = String(body.filter || "all");
      if (f !== "all") rows = rows.filter((r) => f === "banned" ? !!r.banned_until && Date.parse(r.banned_until) > Date.now() : r.plan === f);
      rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return json({ ok: true, total: rows.length, users: rows.slice(0, 500) });
    }

    if (act === "user") {
      const { data: g, error } = await db.auth.admin.getUserById(String(body.id));
      if (error || !g?.user) return json({ ok: false, message: "회원을 찾지 못했어요" }, 404);
      const [row] = await enrich([g.user]);
      let family: any[] = [], stats: any = {};
      if (row.household) {
        const hid = row.household.id;
        const [{ data: ms }, { count: txc }, { data: last }, { count: wc }, { count: dc }] = await Promise.all([
          db.from("members").select("display_name,role,user_id,joined_at").eq("household_id", hid),
          db.from("transactions").select("id", { count: "exact", head: true }).eq("household_id", hid).is("deleted_at", null),
          db.from("transactions").select("created_at").eq("household_id", hid).order("created_at", { ascending: false }).limit(1),
          db.from("wishes").select("id", { count: "exact", head: true }).eq("household_id", hid),
          db.from("device_tokens").select("id", { count: "exact", head: true }).eq("household_id", hid),
        ]);
        family = (ms ?? []).map((x: any) => ({ name: x.display_name, role: x.role, joined: !!x.user_id, joined_at: x.joined_at }));
        stats = { tx: txc ?? 0, last_record: last?.[0]?.created_at || null, wishes: wc ?? 0, devices: dc ?? 0 };
      }
      const { data: fb } = await db.from("feedback").select("created_at,kind,body,status").eq("user_id", row.id).order("created_at", { ascending: false }).limit(20);
      const { data: log } = await db.from("admin_audit").select("at,admin_email,action,detail").eq("target", row.id).order("at", { ascending: false }).limit(20);
      return json({ ok: true, user: row, family, stats, feedback: fb ?? [], log: log ?? [] });
    }

    const uid = String(body.id || "");
    if (act === "grantPlus" || act === "revokePlus" || act === "extendTrial") {
      const { data: m } = await db.from("members").select("household_id").eq("user_id", uid).maybeSingle();
      if (!m) return json({ ok: false, message: "가족 가계부가 없는 회원이에요" }, 400);
      const hid = m.household_id;
      if (act === "grantPlus") {
        const months = Math.max(1, Math.min(36, Number(body.months) || 1));
        const { data: cur } = await db.from("subscriptions").select("expires_at,status,plan").eq("household_id", hid).maybeSingle();
        const base = cur && cur.status === "active" && cur.plan !== "free" && cur.expires_at && Date.parse(cur.expires_at) > Date.now() ? new Date(cur.expires_at) : new Date();
        base.setMonth(base.getMonth() + months);
        await db.from("subscriptions").upsert({ household_id: hid, plan: "plus", status: "active", period: "comp", source: "admin", expires_at: base.toISOString(), updated_at: new Date().toISOString() }, { onConflict: "household_id" });
        await audit("플러스 지급", uid, { months, until: base.toISOString(), memo: body.memo || null });
        return json({ ok: true, until: base.toISOString() });
      }
      if (act === "revokePlus") {
        await db.from("subscriptions").update({ status: "none", updated_at: new Date().toISOString() }).eq("household_id", hid);
        await audit("플러스 회수", uid, { memo: body.memo || null });
        return json({ ok: true });
      }
      const days = Math.max(1, Math.min(365, Number(body.days) || 7));
      const { data: h } = await db.from("households").select("trial_ends_at").eq("id", hid).maybeSingle();
      const base = h?.trial_ends_at && Date.parse(h.trial_ends_at) > Date.now() ? new Date(h.trial_ends_at) : new Date();
      base.setDate(base.getDate() + days);
      await db.from("households").update({ trial_ends_at: base.toISOString() }).eq("id", hid);
      await audit("무료 체험 연장", uid, { days, until: base.toISOString() });
      return json({ ok: true, until: base.toISOString() });
    }
    if (act === "ban" || act === "unban") {
      if (uid === me.user.id) return json({ ok: false, message: "자기 자신은 정지할 수 없어요" }, 400);
      const { error } = await db.auth.admin.updateUserById(uid, { ban_duration: act === "ban" ? "876000h" : "none" } as any);
      if (error) return json({ ok: false, message: "처리하지 못했어요: " + error.message }, 500);
      await audit(act === "ban" ? "이용 정지" : "정지 해제", uid, { reason: body.reason || null });
      return json({ ok: true });
    }
    if (act === "delete") {
      if (uid === me.user.id) return json({ ok: false, message: "자기 자신은 여기서 지울 수 없어요" }, 400);
      if (body.confirm !== "탈퇴") return json({ ok: false, message: "확인 문구가 맞지 않아요" }, 400);
      let removed = false;
      const { data: mine } = await db.from("members").select("id,household_id").eq("user_id", uid);
      for (const m of mine ?? []) {
        const { data: hh } = await db.from("households").select("id,owner_id").eq("id", m.household_id).maybeSingle();
        if (hh && hh.owner_id === uid) {
          const { data: others } = await db.from("members").select("id,user_id").eq("household_id", hh.id).neq("user_id", uid).not("user_id", "is", null).neq("role", "child").order("joined_at", { ascending: true });
          if (others && others.length) { await db.from("households").update({ owner_id: others[0].user_id }).eq("id", hh.id); await db.from("members").update({ role: "owner" }).eq("id", others[0].id); await db.from("members").delete().eq("id", m.id); }
          else { await db.from("households").delete().eq("id", hh.id); removed = true; }
        } else await db.from("members").delete().eq("id", m.id);
      }
      await db.from("device_tokens").delete().eq("user_id", uid);
      const { error } = await db.auth.admin.deleteUser(uid);
      if (error) return json({ ok: false, message: "지우지 못했어요: " + error.message }, 500);
      await db.from("deletion_log").insert({ household_removed: removed, reason: "관리자 처리: " + String(body.reason || "").slice(0, 150) });
      await audit("강제 탈퇴", uid, { reason: body.reason || null, household_removed: removed });
      return json({ ok: true, householdRemoved: removed });
    }
    if (act === "audit") {
      const { data } = await db.from("admin_audit").select("*").order("at", { ascending: false }).limit(100);
      return json({ ok: true, log: data ?? [] });
    }
    return json({ ok: false, message: "알 수 없는 요청" }, 400);
  } catch (e) {
    return json({ ok: false, message: "처리 중 오류: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
