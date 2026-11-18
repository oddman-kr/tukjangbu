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
    const { data: adm } = await db.from("admin_emails").select("email,role").ilike("email", me.user.email).maybeSingle();
    if (!adm) return json({ ok: false, message: "관리자만 쓸 수 있어요" }, 403);
    const adminEmail = me.user.email;
    const body = await req.json().catch(() => ({}));
    const act = String(body.action || "");
    const audit = (action: string, target: string, detail: unknown = null) => db.from("admin_audit").insert({ admin_email: adminEmail, action, target, detail });
    // 역할: owner(운영자, 모든 기능) / support(상담 담당: 회원 보기, 의견 답변, 공지만)
    const role = adm.role || "owner";
    const OWNER_ONLY = ["grantPlus", "revokePlus", "extendTrial", "ban", "unban", "delete", "ledger", "setConfig", "admins", "addAdmin", "removeAdmin", "exportUsers"];
    if (role !== "owner" && OWNER_ONLY.includes(act)) return json({ ok: false, message: "운영자(owner) 권한이 필요해요" }, 403);
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
      const au: any = g.user;
      const [row] = await enrich([au]);
      const md = au.user_metadata || {};
      // 로그인 계정 정보: 연결된 소셜 계정(카카오·네이버·구글·이메일)과 소셜 프로필
      const identities = (au.identities || []).map((i: any) => ({ provider: i.provider, email: i.identity_data?.email || null, name: i.identity_data?.full_name || i.identity_data?.name || i.identity_data?.user_name || null,
        avatar: i.identity_data?.avatar_url || i.identity_data?.picture || null, created_at: i.created_at, last_sign_in_at: i.last_sign_in_at }));
      if (md.provider === "naver") identities.unshift({ provider: "naver", email: null, name: md.name || null, avatar: md.avatar_url || null, created_at: au.created_at, last_sign_in_at: au.last_sign_in_at, naver_id: md.naver_id || null });
      const account: any = { email_confirmed_at: au.email_confirmed_at || null, phone: au.phone || null, anonymous: !!au.is_anonymous, social_name: md.full_name || md.name || md.nickname || null,
        social_avatar: md.avatar_url || md.picture || identities.find((i: any) => i.avatar)?.avatar || null, identities };
      let family: any[] = [], stats: any = {}, household: any = null, money: any = null, extra: any = {};
      if (row.household) {
        const hid = row.household.id;
        const now9 = new Date(Date.now() + 9 * 3600e3), ym = now9.toISOString().slice(0, 7);
        const prev = new Date(Date.UTC(now9.getUTCFullYear(), now9.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
        const since30 = new Date(Date.now() - 30 * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
        const [{ data: ms }, { count: txc }, { data: last }, { data: first }, { data: hh }, { data: sub }, { data: lgs }, { data: cards }, { data: recs }, { data: wishes }, { data: use }, { data: devs }, { data: act30 }, { data: tx2 }, { data: srcs }] = await Promise.all([
          db.from("members").select("id,display_name,role,user_id,joined_at,color,avatar_path,monthly_allowance,allowance_period,hide_personal,guardian_consent_at").eq("household_id", hid),
          db.from("transactions").select("id", { count: "exact", head: true }).eq("household_id", hid).is("deleted_at", null),
          db.from("transactions").select("created_at").eq("household_id", hid).order("created_at", { ascending: false }).limit(1),
          db.from("transactions").select("created_at").eq("household_id", hid).order("created_at", { ascending: true }).limit(1),
          db.from("households").select("name,kind,created_at,month_start,base_currency,owner_id,trial_ends_at").eq("id", hid).maybeSingle(),
          db.from("subscriptions").select("plan,period,status,source,product_id,expires_at,updated_at").eq("household_id", hid).maybeSingle(),
          db.from("ledgers").select("name,kind,currency,is_default,archived,starts_on,ends_on").eq("household_id", hid),
          db.from("cards").select("name,kind,member_id,pay_day,monthly_target").eq("household_id", hid).order("sort"),
          db.from("recurring").select("description,amount,cycle,every,starts_on,active,type").eq("household_id", hid),
          db.from("wishes").select("name,price,status,requested_by,created_at").eq("household_id", hid).order("created_at", { ascending: false }).limit(30),
          db.from("usage_counters").select("month,ocr_count").eq("household_id", hid).order("month", { ascending: false }).limit(6),
          db.from("device_tokens").select("user_id,created_at,last_seen").eq("household_id", hid),
          db.from("daily_active").select("user_id,day,platform").eq("household_id", hid).gte("day", since30),
          db.from("transactions").select("date,type,category,amount_base,member_id,scope").eq("household_id", hid).is("deleted_at", null).gte("date", prev + "-01"),
          db.from("transactions").select("source").eq("household_id", hid).is("deleted_at", null).limit(5000),
        ]);
        const mname = (id: string | null) => (ms ?? []).find((m: any) => m.id === id)?.display_name || "";
        const uname = (uid2: string | null) => (ms ?? []).find((m: any) => m.user_id === uid2)?.display_name || "";
        const sign = async (path: string | null) => { if (!path) return null; const { data } = await db.storage.from("avatars").createSignedUrl(path, 3600); return data?.signedUrl || null; };
        family = await Promise.all((ms ?? []).map(async (x: any) => ({ name: x.display_name, role: x.role, joined: !!x.user_id, joined_at: x.joined_at, me: x.user_id === row.id, color: x.color,
          photo: await sign(x.avatar_path), allowance: Number(x.monthly_allowance) || 0, period: x.allowance_period, hide: !!x.hide_personal, consent_at: x.guardian_consent_at,
          active_days: (act30 ?? []).filter((a: any) => a.user_id && a.user_id === x.user_id).length })));
        const meMember = (ms ?? []).find((m: any) => m.user_id === row.id);
        account.app_photo = await sign(meMember?.avatar_path || null);
        // 이번 달·지난달 돈 흐름 요약 (개인 내용 숨기기를 켠 사람의 개인 지출은 분류를 가려요)
        const hideIds = new Set((ms ?? []).filter((m: any) => m.hide_personal).map((m: any) => m.id));
        const sum = (k: string) => { const o: any = { in: 0, out: 0, save: 0, cats: {}, who: {} };
          for (const t of tx2 ?? []) { if (String(t.date).slice(0, 7) !== k) continue; const a = Number(t.amount_base) || 0;
            if (t.type === "수입") o.in += a; else if (t.type === "지출") { o.out += a; const c = t.scope === "개인" && hideIds.has(t.member_id) ? "개인(숨김)" : (t.category || "기타"); o.cats[c] = (o.cats[c] || 0) + a; const w = mname(t.member_id) || "자동"; o.who[w] = (o.who[w] || 0) + a; } else o.save += a; }
          return o; };
        money = { month: ym, cur: sum(ym), prevMonth: prev, prev: sum(prev) };
        const bySrc: Record<string, number> = {}; for (const t of srcs ?? []) bySrc[t.source || "manual"] = (bySrc[t.source || "manual"] || 0) + 1;
        const myDays = (act30 ?? []).filter((a: any) => a.user_id === row.id);
        stats = { tx: txc ?? 0, last_record: last?.[0]?.created_at || null, first_record: first?.[0]?.created_at || null, wishes: (wishes ?? []).length, devices: (devs ?? []).length, by_source: bySrc,
          active_days_30: myDays.length, last_active: myDays.map((a: any) => a.day).sort().pop() || null, platforms: [...new Set(myDays.map((a: any) => a.platform).filter(Boolean))] };
        household = hh ? { name: hh.name, kind: hh.kind, created_at: hh.created_at, month_start: hh.month_start, currency: hh.base_currency, owner: uname(hh.owner_id), trial_ends_at: hh.trial_ends_at } : null;
        extra = { sub: sub || null, ledgers: lgs ?? [], cards: (cards ?? []).map((c: any) => ({ name: c.name, kind: c.kind, owner: mname(c.member_id), pay_day: c.pay_day, target: c.monthly_target })),
          recurring: (recs ?? []).map((r: any) => ({ desc: r.description, amount: Number(r.amount), cycle: r.cycle, every: r.every, start: r.starts_on, active: r.active, type: r.type })),
          wishes: (wishes ?? []).map((w: any) => ({ name: w.name, price: Number(w.price) || 0, status: w.status, by: mname(w.requested_by), at: w.created_at })),
          ocr: use ?? [], devices: (devs ?? []).map((d: any) => ({ who: uname(d.user_id), created_at: d.created_at, last_seen: d.last_seen })) };
      }
      const { data: fb } = await db.from("feedback").select("id,created_at,kind,body,status,reply,replied_at,app_ver,device,contact").eq("user_id", row.id).order("created_at", { ascending: false }).limit(20);
      const { data: log } = await db.from("admin_audit").select("at,admin_email,action,detail").eq("target", row.id).neq("action", "회원 상세 열람").order("at", { ascending: false }).limit(30);
      if (role !== "owner") { money = null; extra = { sub: extra.sub || null }; } // 상담 담당에게는 돈 내용을 보여 주지 않아요
      await audit("회원 상세 열람", row.id);
      return json({ ok: true, user: row, account, household, family, stats, money, extra, feedback: fb ?? [], log: log ?? [] });
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
    // ---- 가계부 열람: 고객 문의 처리용. 사유를 꼭 남기고, 열람할 때마다 관리 기록에 남겨요 ----
    if (act === "ledger") {
      const reason = String(body.reason || "").trim() || "(사유 미입력)";
      const { data: m } = await db.from("members").select("household_id").eq("user_id", uid).maybeSingle();
      if (!m) return json({ ok: false, message: "가족 가계부가 없는 회원이에요" }, 400);
      const hid = m.household_id;
      const ym = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
      const from = ym + "-01", toD = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const six = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 6, 1)).toISOString().slice(0, 10);
      const [{ data: ms }, { data: tx }, { data: hist }, { data: lg }] = await Promise.all([
        db.from("members").select("id,display_name,role,hide_personal").eq("household_id", hid),
        db.from("transactions").select("date,type,category,amount_base,description,method,scope,member_id,source,ledger_id,created_at").eq("household_id", hid).is("deleted_at", null).gte("date", from).lte("date", toD).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
        db.from("transactions").select("date,type,amount_base").eq("household_id", hid).is("deleted_at", null).gte("date", six).lte("date", toD),
        db.from("ledgers").select("id,name,is_default").eq("household_id", hid),
      ]);
      const mm = new Map((ms ?? []).map((x: any) => [x.id, x]));
      const ledgerName = new Map((lg ?? []).map((x: any) => [x.id, x.is_default ? "" : x.name]));
      // 이용자가 '개인 용돈 내용 숨기기'를 켠 개인 지출은 가족에게처럼 내용을 가려요
      const rows = (tx ?? []).map((t: any) => { const mem: any = mm.get(t.member_id); const hide = t.scope === "개인" && mem?.hide_personal;
        return { date: t.date, type: t.type, category: hide ? "개인" : t.category, amount: Number(t.amount_base), desc: hide ? "(숨김)" : t.description, method: hide ? "" : t.method, who: mem?.display_name || "", source: t.source, ledger: ledgerName.get(t.ledger_id) || "" }; });
      const months: Record<string, { in: number; out: number }> = {};
      for (const t of hist ?? []) { const k = String(t.date).slice(0, 7); months[k] ??= { in: 0, out: 0 }; if (t.type === "수입") months[k].in += Number(t.amount_base); else if (t.type === "지출") months[k].out += Number(t.amount_base); }
      const cats: Record<string, number> = {};
      for (const r of rows) if (r.type === "지출") cats[r.category || "기타"] = (cats[r.category || "기타"] || 0) + r.amount;
      await audit("가계부 열람", uid, { reason, month: ym });
      return json({ ok: true, month: ym, rows, months, cats, members: (ms ?? []).map((x: any) => ({ name: x.display_name, role: x.role })) });
    }

    // ---- 의견 답변: 이용자 앱의 '의견 보내기' 아래와 휴대폰 알림으로 보여요 ----
    if (act === "reply") {
      const text = String(body.reply || "").trim().slice(0, 2000);
      const { data: f } = await db.from("feedback").select("id,user_id,status").eq("id", String(body.fid)).maybeSingle();
      if (!f) return json({ ok: false, message: "의견을 찾지 못했어요" }, 404);
      const patch: any = { reply: text || null, replied_at: text ? new Date().toISOString() : null, reply_seen: false };
      if (text && f.status === "새 의견") patch.status = "확인함";
      if (body.status) patch.status = String(body.status);
      await db.from("feedback").update(patch).eq("id", f.id);
      await audit(text ? "의견 답변" : "답변 지움", f.user_id || "", { fid: f.id, reply: text.slice(0, 200) });
      return json({ ok: true });
    }

    // ---- 공지 ----
    if (act === "notices") {
      const { data } = await db.from("notices").select("*").order("created_at", { ascending: false }).limit(100);
      return json({ ok: true, notices: data ?? [] });
    }
    if (act === "saveNotice") {
      const n = body.notice || {};
      const row: any = { title: String(n.title || "").trim().slice(0, 80), body: n.body ? String(n.body).slice(0, 2000) : null, level: ["info", "warn", "event"].includes(n.level) ? n.level : "info",
        audience: ["all", "free", "paid"].includes(n.audience) ? n.audience : "all", link: /^https:\/\//.test(n.link || "") ? n.link : null,
        starts_at: n.starts_at || new Date().toISOString(), ends_at: n.ends_at || null, active: n.active !== false };
      if (!row.title) return json({ ok: false, message: "제목을 넣어 주세요" }, 400);
      const q = n.id ? db.from("notices").update(row).eq("id", n.id).select().single() : db.from("notices").insert({ ...row, created_by: adminEmail }).select().single();
      const { data, error } = await q;
      if (error) return json({ ok: false, message: "저장하지 못했어요: " + error.message }, 400);
      await audit(n.id ? "공지 수정" : "공지 등록", "", { id: data.id, title: row.title, active: row.active });
      return json({ ok: true, notice: data });
    }
    if (act === "deleteNotice") {
      await db.from("notices").delete().eq("id", String(body.nid));
      await audit("공지 삭제", "", { id: body.nid });
      return json({ ok: true });
    }

    // ---- 앱 운영 설정 ----
    if (act === "config") {
      const { data } = await db.from("app_config").select("*");
      return json({ ok: true, config: Object.fromEntries((data ?? []).map((x: any) => [x.key, { value: x.value, updated_at: x.updated_at, updated_by: x.updated_by }])) });
    }
    if (act === "setConfig") {
      const key = String(body.key || ""), v = body.value;
      let value: unknown;
      if (key === "min_version") value = Math.max(0, Math.min(100000, Math.floor(Number(v) || 0)));
      else if (key === "maintenance") value = { on: !!v?.on, message: String(v?.message || "").slice(0, 300) };
      else if (key === "free_limits") value = { members: Math.max(1, Math.min(20, Math.floor(Number(v?.members) || 2))), ocr: Math.max(0, Math.min(1000, Math.floor(Number(v?.ocr) || 0))) };
      else return json({ ok: false, message: "알 수 없는 설정이에요" }, 400);
      await db.from("app_config").upsert({ key, value, updated_at: new Date().toISOString(), updated_by: adminEmail });
      await audit("운영 설정 변경", "", { key, value });
      return json({ ok: true, value });
    }

    // ---- 관리자 명단 ----
    if (act === "admins") {
      const { data } = await db.from("admin_emails").select("email,role,note,created_at").order("created_at");
      return json({ ok: true, admins: data ?? [] });
    }
    if (act === "addAdmin") {
      const em = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json({ ok: false, message: "이메일을 확인해 주세요" }, 400);
      const r = body.role === "support" ? "support" : "owner";
      await db.from("admin_emails").upsert({ email: em, role: r, note: String(body.note || "").slice(0, 100) || null });
      await audit("관리자 추가", "", { email: em, role: r });
      return json({ ok: true });
    }
    if (act === "removeAdmin") {
      const em = String(body.email || "").trim().toLowerCase();
      if (em === adminEmail.toLowerCase()) return json({ ok: false, message: "자기 자신은 뺄 수 없어요" }, 400);
      await db.from("admin_emails").delete().ilike("email", em);
      await audit("관리자 제외", "", { email: em });
      return json({ ok: true });
    }

    // ---- 회원 목록 내보내기(기록만 남기고, 파일은 화면에서 만들어요) ----
    if (act === "exportUsers") {
      const rows = await enrich(await allUsers());
      await audit("회원 목록 내보내기", "", { count: rows.length });
      return json({ ok: true, users: rows });
    }
    if (act === "me") return json({ ok: true, email: adminEmail, role });

    if (act === "audit") {
      const { data } = await db.from("admin_audit").select("*").order("at", { ascending: false }).limit(100);
      return json({ ok: true, log: data ?? [] });
    }
    return json({ ok: false, message: "알 수 없는 요청" }, 400);
  } catch (e) {
    return json({ ok: false, message: "처리 중 오류: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
