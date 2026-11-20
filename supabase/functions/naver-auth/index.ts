// 네이버 로그인 → Supabase 세션
// 1) ?redirect=<앱 주소>  : 네이버 로그인 화면으로 보냄 (state에 서명)
// 2) ?code=&state=        : 네이버 콜백 → 프로필 확인 → Supabase 사용자 만들고 매직링크로 로그인시켜 앱으로 돌려보냄
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CID = Deno.env.get("NAVER_CLIENT_ID") ?? "";
const SEC = Deno.env.get("NAVER_SECRET") ?? "";
const URL_ = Deno.env.get("SUPABASE_URL")!;
function serviceKey(): string {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = o.default ?? Object.values(o)[0]; if (v) return String(v); } catch (_) { /* */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SELF = URL_ + "/functions/v1/naver-auth";
const ALLOW = [/^https:\/\/oddman-kr\.github\.io\/tukjangbu\//, /^gagyebu:\/\/auth-callback/];
const DEFAULT_BACK = "https://oddman-kr.github.io/tukjangbu/v2/";

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
async function hmac(msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEC), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))));
}
const go = (to: string) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
function fail(back: string, msg: string) {
  const u = back + (back.includes("#") ? "&" : "#") + "error_description=" + encodeURIComponent(msg);
  return go(u);
}

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  if (!CID || !SEC) return new Response("naver not configured", { status: 500 });

  // 1) 시작
  if (!q.get("code") && !q.get("error")) {
    let back = q.get("redirect") ?? DEFAULT_BACK;
    if (!ALLOW.some((r) => r.test(back))) back = DEFAULT_BACK;
    const body = b64u(new TextEncoder().encode(JSON.stringify({ r: back, n: crypto.randomUUID(), t: Date.now() })));
    const state = body + "." + (await hmac(body));
    return go("https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=" + encodeURIComponent(CID) +
      "&redirect_uri=" + encodeURIComponent(SELF) + "&state=" + encodeURIComponent(state));
  }

  // 2) 콜백
  const state = q.get("state") ?? "";
  const [body, sig] = state.split(".");
  if (!body || !sig || sig !== (await hmac(body))) return new Response("bad state", { status: 400 });
  const st = JSON.parse(fromB64u(body));
  const back: string = ALLOW.some((r) => r.test(st.r)) ? st.r : DEFAULT_BACK;
  if (Date.now() - st.t > 10 * 60 * 1000) return fail(back, "로그인 시간이 지났어요. 다시 시도해 주세요");
  if (q.get("error")) return fail(back, "네이버 로그인을 취소했어요");

  const tok = await fetch("https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=" + encodeURIComponent(CID) +
    "&client_secret=" + encodeURIComponent(SEC) + "&code=" + encodeURIComponent(q.get("code")!) + "&state=" + encodeURIComponent(state)).then((r) => r.json());
  if (!tok.access_token) return fail(back, "네이버 로그인에 실패했어요");
  const me = await fetch("https://openapi.naver.com/v1/nid/me", { headers: { Authorization: "Bearer " + tok.access_token } }).then((r) => r.json());
  const p = me && me.response;
  if (!p || !p.id) return fail(back, "네이버 정보를 받지 못했어요");

  const admin = createClient(URL_, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  // 이메일을 받지 않으므로 네이버 고유 ID로 내부용 주소를 만들어요 (메일은 보내지 않아요)
  const email = "naver_" + String(p.id).replace(/[^A-Za-z0-9_-]/g, "") + "@naver.tukjangbu.invalid";
  const meta = { provider: "naver", naver_id: p.id, full_name: p.nickname || "", name: p.nickname || "", avatar_url: p.profile_image || "" };
  const cr = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta, app_metadata: { provider: "naver", providers: ["naver"] } });
  if (cr.error && !/already|registered|exists/i.test(cr.error.message)) return fail(back, "계정을 만들지 못했어요");
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: back } });
  const action = link.data?.properties?.action_link;
  if (link.error || !action) return fail(back, "로그인 링크를 만들지 못했어요");
  return go(action);
});
