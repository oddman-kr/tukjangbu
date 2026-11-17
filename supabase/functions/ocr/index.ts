// 영수증 글자 읽기 (유료 OCR 공급자 교체 가능)
// 비밀값: OCR_PROVIDER = "clova" | "google",  CLOVA_OCR_URL, CLOVA_OCR_SECRET  또는  GOOGLE_VISION_KEY
// 무료 요금제는 한 달 10장까지 (usage_counters.ocr_count)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function clova(b64: string, mime: string): Promise<string> {
  const url = Deno.env.get("CLOVA_OCR_URL"), secret = Deno.env.get("CLOVA_OCR_SECRET");
  if (!url || !secret) throw new Error("NOT_CONFIGURED");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OCR-SECRET": secret },
    body: JSON.stringify({ version: "V2", requestId: crypto.randomUUID(), timestamp: Date.now(), lang: "ko",
      images: [{ format: mime.includes("png") ? "png" : "jpg", name: "receipt", data: b64 }] }),
  });
  if (!r.ok) throw new Error("OCR_FAILED " + r.status);
  const o = await r.json();
  const fields = o?.images?.[0]?.fields ?? [];
  // 줄 바꿈 정보를 살려 한 줄씩 이어 붙여요
  return fields.map((f: { inferText: string; lineBreak: boolean }) => f.inferText + (f.lineBreak ? "\n" : " ")).join("");
}

async function vision(b64: string): Promise<string> {
  const key = Deno.env.get("GOOGLE_VISION_KEY");
  if (!key) throw new Error("NOT_CONFIGURED");
  const r = await fetch("https://vision.googleapis.com/v1/images:annotate?key=" + key, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: b64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }], imageContext: { languageHints: ["ko"] } }] }),
  });
  if (!r.ok) throw new Error("OCR_FAILED " + r.status);
  const o = await r.json();
  return o?.responses?.[0]?.fullTextAnnotation?.text ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ ok: false, message: "로그인이 필요해요" }, 401);
    const { image, mime = "image/jpeg", household } = await req.json();
    const b64 = String(image || "").replace(/^data:[^,]+,/, "");
    if (!b64) return json({ ok: false, message: "사진이 없어요." }, 400);
    if (b64.length > 9_000_000) return json({ ok: false, message: "사진이 너무 커요. 다시 찍어 주세요." }, 400);

    // 사용량 확인 (서비스 키로 셈: 사용자가 직접 못 바꾸게)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: mem } = await admin.from("members").select("household_id").eq("user_id", u.user.id).eq("household_id", household).maybeSingle();
    if (!mem) return json({ ok: false, message: "가족 정보를 찾지 못했어요" }, 403);
    const month = new Date().toISOString().slice(0, 7);
    const { data: sub } = await admin.from("subscriptions").select("plan,status,expires_at").eq("household_id", household).maybeSingle();
    const { data: hh } = await admin.from("households").select("trial_ends_at").eq("id", household).maybeSingle();
    const paid = (sub && sub.plan !== "free" && sub.status === "active") || (hh && new Date(hh.trial_ends_at) > new Date());
    const { data: cnt } = await admin.from("usage_counters").select("ocr_count").eq("household_id", household).eq("month", month).maybeSingle();
    const used = cnt?.ocr_count ?? 0;
    if (!paid && used >= 10) return json({ ok: false, limit: true, message: "무료 요금제는 영수증을 한 달 10장까지 읽을 수 있어요. 구독하면 마음껏 쓸 수 있어요." });

    const provider = Deno.env.get("OCR_PROVIDER") ?? "clova";
    let text = "";
    try { text = provider === "google" ? await vision(b64) : await clova(b64, mime); }
    catch (e) {
      if (String(e).includes("NOT_CONFIGURED")) return json({ ok: false, message: "영수증 인식 설정이 아직 끝나지 않았어요. 금액을 직접 넣어 주세요." });
      throw e;
    }
    await admin.from("usage_counters").upsert({ household_id: household, month, ocr_count: used + 1 }, { onConflict: "household_id,month" });
    return json({ ok: true, text: text.slice(0, 5000), used: used + 1, paid: !!paid });
  } catch (e) {
    return json({ ok: false, message: "영수증을 읽지 못했어요. 잠시 후 다시 시도해 주세요.", detail: String(e).slice(0, 200) }, 500);
  }
});
