import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FLOOR = 0.45;
const ABSTAIN = "제공된 자료에서 관련 내용을 찾지 못했습니다. (근거 없는 추측은 하지 않습니다)";
const BUSY = "일시적으로 응답이 많아 처리가 지연됩니다. 잠시 후 다시 시도해 주세요.";
const GROUND_SYS = "당신은 기후시민회의 자료 안내 도우미 '그득이'입니다. 아래 <자료>에 적힌 내용만을 근거로 답합니다. 규칙: (1) 자료에 없는 내용은 절대 지어내지 말고 found=false. (2) 모든 사실 주장 문장은 그 문장을 뒷받침하는 자료 번호를 citation_ids에 포함한다. (3) 일반상식·외부지식·추측 금지. (4) 자료가 '검토·제안·권고'이면 '확정·결정·도입함'으로 과장하지 않고 원문 수준으로 보수적으로 표현한다. (5) 질문과 정말 관련된 자료만 인용한다. (6) 간결·정확한 한국어. 반드시 JSON만 출력: {\"found\":boolean, \"answer\":string, \"citation_ids\":number[]}.";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function llmFetch(url: string, opts: RequestInit): Promise<Response> {
  let r: Response | null = null;
  for (let i = 0; i < 3; i++) {
    r = await fetch(url, opts);
    if ((r.status === 429 || r.status === 503) && i < 2) { await sleep(1300 * (i + 1)); continue; }
    break;
  }
  return r!;
}
function bg(p: Promise<unknown>) {
  try { // @ts-ignore Supabase 엣지 런타임 waitUntil
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p.catch(() => {})); else p.catch(() => {});
  } catch { p.catch(() => {}); }
}
function logChat(sb: SupabaseClient | null, row: Record<string, unknown>) { if (sb) bg(sb.from("chat_logs").insert(row).then(() => {})); }

let SECRETS: Record<string, string> | null = null;
async function getSecrets(sb: SupabaseClient): Promise<Record<string, string>> {
  if (SECRETS) return SECRETS;
  const { data } = await sb.from("app_secrets").select("name,value");
  SECRETS = Object.fromEntries((data ?? []).map((r: { name: string; value: string }) => [r.name, r.value]));
  return SECRETS;
}

async function runLLM(provider: string, model: string, keys: Record<string, string | null>, userText: string): Promise<{ ok: boolean; txt?: string; err?: string; busy?: boolean }> {
  if (provider === "gemini") {
    const schema = { type: "object", properties: { found: { type: "boolean" }, answer: { type: "string" }, citation_ids: { type: "array", items: { type: "integer" } } }, required: ["found", "answer", "citation_ids"] };
    const r = await llmFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys.GEMINI}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: GROUND_SYS }] }, contents: [{ role: "user", parts: [{ text: userText }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (r.status === 429 || r.status === 503) return { ok: false, busy: true, err: `gemini ${r.status}` };
    if (!r.ok) return { ok: false, err: `gemini ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = await r.json();
    return { ok: true, txt: j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "" };
  }
  if (provider === "nvidia") {
    const r = await llmFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${keys.NVIDIA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 1024, response_format: { type: "json_object" }, messages: [{ role: "system", content: GROUND_SYS }, { role: "user", content: userText }] }),
    });
    if (r.status === 429 || r.status === 503) return { ok: false, busy: true, err: `nvidia ${r.status}` };
    if (!r.ok) return { ok: false, err: `nvidia ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = await r.json();
    return { ok: true, txt: j.choices?.[0]?.message?.content ?? "" };
  }
  if (provider === "anthropic") {
    const schema = { type: "object", additionalProperties: false, required: ["found", "answer", "citation_ids"], properties: { found: { type: "boolean" }, answer: { type: "string" }, citation_ids: { type: "array", items: { type: "integer" } } } };
    const r = await llmFetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": keys.ANTHROPIC!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1024, system: GROUND_SYS, messages: [{ role: "user", content: userText }], output_config: { format: { type: "json_schema", schema } } }),
    });
    if (r.status === 429 || r.status === 503) return { ok: false, busy: true, err: `anthropic ${r.status}` };
    if (!r.ok) return { ok: false, err: `anthropic ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = await r.json();
    return { ok: true, txt: (j.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "{}" };
  }
  return { ok: false, err: "provider 없음" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  let sb: SupabaseClient | null = null;
  let session_id: string | null = null, q = "", source: string | null = null;
  try {
    sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const sec = await getSecrets(sb);
    const K = (n: string) => Deno.env.get(n) ?? sec[n] ?? null;
    const OPENAI = K("OPENAI_API_KEY");
    const keys = { GEMINI: K("GEMINI_API_KEY"), NVIDIA: K("NVIDIA_API_KEY"), ANTHROPIC: K("ANTHROPIC_API_KEY") };
    const GEMINI_MODEL = K("GEMINI_MODEL") ?? "gemini-2.5-flash";
    const NVIDIA_MODEL = K("NVIDIA_MODEL") ?? "deepseek-ai/deepseek-v4-flash";
    // 우선순위 체인: gemini > nvidia > anthropic(키 있는 것만). busy/error 시 다음으로 failover. LLM_PROVIDER로 고정 가능.
    const forced = K("LLM_PROVIDER");
    let chain: [string, string][] = [];
    if (keys.GEMINI) chain.push(["gemini", GEMINI_MODEL]);
    if (keys.NVIDIA) chain.push(["nvidia", NVIDIA_MODEL]);
    if (keys.ANTHROPIC) chain.push(["anthropic", "claude-sonnet-4-6"]);
    if (forced) chain = chain.filter(([p]) => p === forced);

    if (!OPENAI) return json({ error: "OPENAI_API_KEY 미설정" }, 500);
    const body = await req.json().catch(() => ({}));
    q = String(body.query ?? "").trim();
    const k = body.k ?? 10;
    source = body.source ?? null;
    session_id = body.session_id ?? null;
    if (q.length < 2) return json({ found: false, answer: "질문을 입력해 주세요.", citations: [], abstained: true });

    const er = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-large", dimensions: 1536, input: q }),
    });
    if (!er.ok) { logChat(sb, { session_id, query: q, source_filter: source, error: `embed ${er.status}`, latency_ms: Date.now() - t0 }); return json({ error: `embed ${er.status}` }, 500); }
    const embedding = (await er.json()).data[0].embedding as number[];
    const { data: hits, error } = await sb.rpc("match_kb", { query_embedding: embedding, match_count: k, source_filter: source });
    if (error) { logChat(sb, { session_id, query: q, source_filter: source, error: error.message, latency_ms: Date.now() - t0 }); return json({ error: error.message }, 500); }
    const rows = (hits ?? []) as { id: number; source: string; doc: string; ref_id: string; title: string; body: string; category: string; similarity: number }[];
    const top = rows[0]?.similarity ?? 0;

    if (!rows.length || top < FLOOR) {
      logChat(sb, { session_id, query: q, source_filter: source, answer: ABSTAIN, found: false, abstained: true, top_similarity: top, retrieved: rows.length, latency_ms: Date.now() - t0 });
      return json({ found: false, answer: ABSTAIN, citations: [], abstained: true, top_similarity: top });
    }
    if (!chain.length) { logChat(sb, { session_id, query: q, source_filter: source, error: "LLM 키 미설정", top_similarity: top, retrieved: rows.length, latency_ms: Date.now() - t0 }); return json({ error: "LLM 키 미설정(GEMINI/NVIDIA/ANTHROPIC 중 1)", retrieved: rows.length, top_similarity: top }, 500); }

    const sent = new Map(rows.map((r) => [r.id, r]));
    const context = rows.map((r) => `[자료#${r.id}] (${r.doc} / ${r.category ?? ""}) ${r.title}\n${r.body}`).join("\n\n");
    const userText = `질문: ${q}\n\n<자료>\n${context}\n</자료>`;
    // failover 체인 실행
    let llm: { ok: boolean; txt?: string; err?: string; busy?: boolean } = { ok: false, err: "none" };
    let usedModel = "none";
    for (const [p, m] of chain) {
      llm = await runLLM(p, m, keys, userText);
      usedModel = `${p}:${m}`;
      if (llm.ok) break;
    }
    if (!llm.ok) {
      logChat(sb, { session_id, query: q, source_filter: source, error: llm.err, top_similarity: top, retrieved: rows.length, model: usedModel, latency_ms: Date.now() - t0 });
      if (llm.busy) return json({ found: false, answer: BUSY, citations: [], busy: true, top_similarity: top });
      return json({ error: llm.err }, 500);
    }
    let parsed: { found?: boolean; answer?: string; citation_ids?: number[] } = {};
    try { parsed = JSON.parse(llm.txt ?? "{}"); } catch { /* */ }

    const validIds = (parsed.citation_ids ?? []).filter((id) => sent.has(id));
    // body(권고 원문)를 인용 카드에 노출 — 출처 검증 가능성(trust→verify source)의 핵심
    const citations = validIds.map((id) => { const r = sent.get(id)!; return { id, source: r.source, doc: r.doc, ref_id: r.ref_id, title: r.title, category: r.category, body: r.body, similarity: Math.round(r.similarity * 1000) / 1000 }; });

    if (!parsed.found || citations.length === 0) {
      logChat(sb, { session_id, query: q, source_filter: source, answer: ABSTAIN, found: false, abstained: true, top_similarity: top, retrieved: rows.length, model: usedModel, latency_ms: Date.now() - t0 });
      return json({ found: false, answer: parsed.answer && parsed.found ? parsed.answer : ABSTAIN, citations: [], abstained: true, top_similarity: top });
    }
    logChat(sb, { session_id, query: q, source_filter: source, answer: parsed.answer ?? "", found: true, abstained: false, top_similarity: top, retrieved: rows.length, citation_ids: validIds, model: usedModel, latency_ms: Date.now() - t0 });
    return json({ found: true, answer: parsed.answer ?? "", citations, abstained: false, top_similarity: top, model: usedModel });
  } catch (e) {
    logChat(sb, { session_id, query: q, source_filter: source, error: String(e), latency_ms: Date.now() - t0 });
    return json({ error: String(e) }, 500);
  }
});
