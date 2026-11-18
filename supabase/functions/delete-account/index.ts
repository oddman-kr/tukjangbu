// 계정 삭제(탈퇴): 플레이스토어 정책상 앱 안에서 바로 지울 수 있어야 해요
// - 가족 주인이 지우면: 다른 어른이 있으면 그 사람에게 주인을 넘기고, 혼자면 가계부 전체를 지워요
// - 가족 구성원이 지우면: 그 사람 계정만 지우고, 가족 기록은 '가족'으로 남겨요
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
function serviceKey(): string {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = o.default ?? Object.values(o)[0]; if (v) return String(v); } catch (_) { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ ok: false, message: "로그인이 필요해요" }, 401);
    const { confirm, reason } = await req.json().catch(() => ({}));
    if (confirm !== "삭제") return json({ ok: false, message: "확인 문구가 맞지 않아요" }, 400);
    const uid = u.user.id;
    const db = createClient(url, serviceKey(), { auth: { persistSession: false } });
    let removedHousehold = false;

    const { data: mine } = await db.from("members").select("id,household_id,role").eq("user_id", uid);
    for (const m of mine ?? []) {
      const { data: hh } = await db.from("households").select("id,owner_id").eq("id", m.household_id).maybeSingle();
      if (hh && hh.owner_id === uid) {
        const { data: others } = await db.from("members").select("id,user_id,role,joined_at").eq("household_id", hh.id).neq("user_id", uid).not("user_id", "is", null).neq("role", "child").order("joined_at", { ascending: true });
        if (others && others.length) {
          await db.from("households").update({ owner_id: others[0].user_id }).eq("id", hh.id);
          await db.from("members").update({ role: "owner" }).eq("id", others[0].id);
          await db.from("members").delete().eq("id", m.id);
        } else {
          await db.from("households").delete().eq("id", hh.id); // 내역·카테고리 등 모두 함께 지워져요
          removedHousehold = true;
        }
      } else {
        await db.from("members").delete().eq("id", m.id);
      }
    }
    await db.from("device_tokens").delete().eq("user_id", uid);
    const { error } = await db.auth.admin.deleteUser(uid);
    if (error) return json({ ok: false, message: "계정을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요" }, 500);
    await db.from("deletion_log").insert({ household_removed: removedHousehold, reason: String(reason || "").slice(0, 200) || null });
    return json({ ok: true, householdRemoved: removedHousehold });
  } catch (_e) {
    return json({ ok: false, message: "계정을 지우지 못했어요" }, 500);
  }
});
