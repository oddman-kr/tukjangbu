// 구글 플레이 구독 영수증 확인 → subscriptions 표에 기록 (서버만 쓸 수 있어요)
// 필요한 비밀값: GOOGLE_PLAY_SA (플레이 콘솔에 연결한 서비스 계정 JSON), PLAY_PACKAGE (기본 kr.oddman.tukjangbu)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const PRODUCTS: Record<string, string> = { tuk_plus_month: "month", tuk_plus_year: "year" };
function serviceKey(): string {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = o.default ?? Object.values(o)[0]; if (v) return String(v); } catch (_) { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const b64u = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + head + "." + body + "." + b64u(sig) }).then((x) => x.json());
  if (!r.access_token) throw new Error("google auth failed");
  return r.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ ok: false, message: "로그인이 필요해요" }, 401);
    const { household, productId, purchaseToken } = await req.json();
    if (!PRODUCTS[productId] || !purchaseToken) return json({ ok: false, message: "결제 정보가 올바르지 않아요" }, 400);
    const admin = createClient(url, serviceKey(), { auth: { persistSession: false } });
    const { data: mem } = await admin.from("members").select("household_id").eq("user_id", u.user.id).eq("household_id", household).maybeSingle();
    if (!mem) return json({ ok: false, message: "가족 정보를 찾지 못했어요" }, 403);

    const saRaw = Deno.env.get("GOOGLE_PLAY_SA");
    if (!saRaw) return json({ ok: false, message: "결제 확인 준비가 아직 안 됐어요" }, 503);
    const pkg = Deno.env.get("PLAY_PACKAGE") ?? "kr.oddman.tukjangbu";
    const tok = await googleToken(JSON.parse(saRaw));
    const g = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { Authorization: "Bearer " + tok } }).then((x) => x.json());
    const state = g.subscriptionState as string | undefined;
    const line = (g.lineItems ?? [])[0] ?? {};
    const active = state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
    if (!active || line.productId !== productId) return json({ ok: false, message: "유효한 구독이 아니에요" }, 402);

    // 같은 영수증을 다른 가족이 쓰지 못하게
    const { data: other } = await admin.from("subscriptions").select("household_id").eq("purchase_token", purchaseToken).neq("household_id", household).maybeSingle();
    if (other) return json({ ok: false, message: "이미 다른 가계부에서 쓰인 결제예요" }, 409);

    const { error: upErr } = await admin.from("subscriptions").upsert({ household_id: household, plan: "plus", period: PRODUCTS[productId], status: "active", expires_at: line.expiryTime ?? null,
      source: "play", purchase_token: purchaseToken, product_id: productId, updated_at: new Date().toISOString() }, { onConflict: "household_id" });
    if (upErr) return json({ ok: false, message: "구독을 기록하지 못했어요" }, 500);

    // 확인(acknowledge)하지 않으면 3일 뒤 구글이 자동 환불해요
    if (g.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
      await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptions/${productId}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: "{}" });
    }
    return json({ ok: true, expires: line.expiryTime ?? null });
  } catch (e) {
    return json({ ok: false, message: "결제를 확인하지 못했어요" }, 500);
  }
});
