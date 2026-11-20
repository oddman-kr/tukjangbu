// 앱 로그인 넘겨주기: 로그인 완료 페이지(auth-return)가 토큰을 맡기고(put), 앱이 한 번만 가져가요(take). 3분 지나면 무효.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
function serviceKey(): string {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = o.default ?? Object.values(o)[0]; if (v) return String(v); } catch (_) { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const NONCE = /^[A-Za-z0-9_-]{32,80}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const n = String(b.n || "");
    if (!NONCE.test(n)) return json({ ok: false }, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, serviceKey(), { auth: { persistSession: false } });
    const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    await db.from("auth_handoff").delete().lt("created_at", cutoff);
    if (b.op === "put") {
      const at = String(b.access_token || ""), rt = String(b.refresh_token || "");
      if (!at || !rt) return json({ ok: false }, 400);
      // 진짜 로그인 토큰인지 확인하고 맡아요
      const { data: u } = await db.auth.getUser(at);
      if (!u?.user) return json({ ok: false }, 401);
      await db.from("auth_handoff").upsert({ nonce: n, payload: { access_token: at, refresh_token: rt, expires_in: Number(b.expires_in) || 3600 }, created_at: new Date().toISOString() });
      return json({ ok: true });
    }
    if (b.op === "take") {
      const { data } = await db.from("auth_handoff").select("payload,created_at").eq("nonce", n).gte("created_at", cutoff).maybeSingle();
      if (!data) return json({ ok: true, ready: false });
      await db.from("auth_handoff").delete().eq("nonce", n);
      return json({ ok: true, ready: true, session: data.payload });
    }
    return json({ ok: false }, 400);
  } catch (_e) {
    return json({ ok: false }, 500);
  }
});
