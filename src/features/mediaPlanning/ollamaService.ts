function getOllamaBaseUrl(): string {
  return String(process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
}

function getOllamaModel(): string {
  return String(process.env.OLLAMA_MODEL || "qwen3-fast:latest");
}

function getOllamaTimeoutMs(): number {
  return Math.max(10000, Number(process.env.OLLAMA_TIMEOUT_MS || 90000));
}

type OllamaGenerateResult = {
  text: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
};

const LARGE_BRIEF_THRESHOLD_CHARS = Math.max(4000, Number(process.env.MEDIA_PLAN_STAGE0_CHUNK_THRESHOLD || 12000));
const STAGE0_CHUNK_SIZE_CHARS = Math.max(2400, Number(process.env.MEDIA_PLAN_STAGE0_CHUNK_SIZE || 4500));
const STAGE0_CHUNK_OVERLAP_CHARS = Math.max(0, Number(process.env.MEDIA_PLAN_STAGE0_CHUNK_OVERLAP || 700));
const STAGE0_MIN_SPLIT_CHARS = Math.max(1000, Number(process.env.MEDIA_PLAN_STAGE0_MIN_SPLIT || 1800));
const STAGE0_MAX_SPLIT_DEPTH = Math.max(1, Number(process.env.MEDIA_PLAN_STAGE0_MAX_SPLIT_DEPTH || 3));

const STAGE0_RULES = `PARSING RULES:
- For pharma/medical products: always extract clinical claims, regulatory restrictions, competitor prices.
- For tenders: always extract tender_id, deadline, max_budget, deliverables list.
- For seasonal products: extract seasonality patterns.
- budget field: if budget has VAT/НДС note, set vat_included accordingly.
- channels_required vs channels_suggested: "обязательные" = required, "возможные/рекомендуемые" = suggested.
- product_restrictions: look for phrases like "реклама рецептурных", "медицинское изделие", "ОРД", pharma disclaimers.
- If brief mentions doctors/врачи as audience, add to b2b_targets.
- available_assets: look for mentions of existing site, accounts, creative materials, analytics access.`;

const STAGE0_SCHEMA = `{
  "product": "product/brand name",
  "product_type": "drug|medical_device|fmcg|service|b2b|other|null",
  "company": "company name if mentioned",
  "website": "url if mentioned",
  "goal": "primary campaign goal",
  "campaign_type": "always_on|launch|seasonal|tender|other|null",
  "period": { "start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null", "description": "text if no dates" },
  "budget": { "total": "number or null", "currency": "RUB|USD|EUR|null", "vat_included": "true|false|null", "note": "any budget notes" },
  "target_audience": {
    "primary": [
      {
        "description": "who they are",
        "age": "range or null",
        "gender": "all|male|female|null",
        "interests": ["list"],
        "pain_points": ["list"],
        "behavior": "how they search/decide"
      }
    ],
    "secondary": ["description of secondary segments"],
    "b2b_targets": ["doctors, pharmacists, etc if mentioned"]
  },
  "geo": { "cities": ["list"], "regions": ["list"], "type": "national|regional|local|null", "coverage": "description if given" },
  "channels_required": ["channels explicitly required in brief"],
  "channels_suggested": ["channels listed as possible/optional"],
  "channels_forbidden": ["any explicitly excluded"],
  "platforms_required": ["specific platforms: Yandex, VK, OZON, etc"],
  "kpi": {
    "awareness": ["reach, impressions, etc"],
    "engagement": ["CTR, clicks, etc"],
    "conversion": ["purchases, leads, etc"],
    "loyalty": ["reviews, repeat purchase, etc"],
    "custom": ["any other specific KPIs from brief"]
  },
  "competitors": [{ "name": "competitor name", "position": "how they compete", "price_ratio": "price comparison if given" }],
  "brand_position": "how client positions vs competitors",
  "price_positioning": "premium|mid|budget|null",
  "key_differentiators": ["what makes product unique"],
  "product_claims": ["proven claims, clinical data, ratings"],
  "product_barriers": ["known consumer objections or barriers"],
  "product_restrictions": ["legal/technical/regulatory restrictions on advertising"],
  "seasonality": "description of seasonal patterns if mentioned",
  "mandatory_requirements": ["must-have conditions: reporting cadence, account ownership, etc"],
  "deliverables": ["what agency must deliver: presentation, mediaplan, etc"],
  "creative_responsibility": "agency|client|both|null",
  "payment_terms": "payment conditions if mentioned",
  "tender_id": "tender number if present",
  "tender_deadline": "submission deadline if present",
  "tender_platform": "platform name if present",
  "max_budget": "number or null",
  "unclear": ["critical missing info that blocks strategy"],
  "available_assets": ["what client already has: site, creatives, accounts, data"]
}`;

async function ollamaGenerate(prompt: string): Promise<OllamaGenerateResult> {
  const response = await fetch(`${getOllamaBaseUrl()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getOllamaModel(),
      prompt,
      stream: false,
    }),
    signal: AbortSignal.timeout(getOllamaTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    response?: unknown;
    model?: unknown;
    prompt_eval_count?: unknown;
    eval_count?: unknown;
  };
  const model = typeof data.model === "string" && data.model.trim() ? data.model.trim() : getOllamaModel();
  const promptTokens = Number.isFinite(Number(data.prompt_eval_count)) ? Number(data.prompt_eval_count) : 0;
  const outputTokens = Number.isFinite(Number(data.eval_count)) ? Number(data.eval_count) : 0;

  return {
    text: typeof data.response === "string" ? data.response : "",
    model,
    promptTokens,
    outputTokens,
  };
}

function cleanModelJson(raw: string): string {
  return String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```json|```/gi, "")
    .trim();
}

function parseModelJson(raw: string): any {
  const clean = cleanModelJson(raw);
  try {
    return JSON.parse(clean);
  } catch {
    const objectMatch = clean.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error("Failed to parse Ollama JSON");
  }
}

function buildStage0Prompt(briefText: string, partial: boolean, index?: number, total?: number): string {
  const scope = partial
    ? `This is PART ${index || "?"}/${total || "?"} of the full brief. Extract only facts explicitly present in this part.`
    : "This is the full brief.";

  return `Extract structured data from this advertising brief.
Return ONLY valid JSON. No thinking tags. No explanation. No markdown. Start with { end with }.
Use null for any missing scalar field. Use [] for missing list field. Never invent data.
${scope}

${STAGE0_RULES}

Schema:
${STAGE0_SCHEMA}

Brief:
${briefText}`;
}

function splitIntoChunks(text: string, maxChars: number, overlapChars: number): string[] {
  const source = String(text || "").trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const end = Math.min(source.length, cursor + maxChars);
    const slice = source.slice(cursor, end).trim();
    if (slice) chunks.push(slice);
    if (end >= source.length) break;
    cursor = Math.max(end - overlapChars, cursor + 1);
  }
  return chunks;
}

function splitChunkInTwo(text: string): [string, string] {
  const source = String(text || "");
  const middle = Math.floor(source.length / 2);
  const left = source.slice(0, Math.min(source.length, middle + Math.floor(STAGE0_CHUNK_OVERLAP_CHARS / 2))).trim();
  const right = source
    .slice(Math.max(0, middle - Math.floor(STAGE0_CHUNK_OVERLAP_CHARS / 2)), source.length)
    .trim();
  return [left, right];
}

function normalizePrimitive(value: unknown): unknown {
  if (typeof value === "string") {
    const v = value.trim();
    if (!v) return null;
    if (v.toLowerCase() === "null") return null;
    if (v.toLowerCase() === "none") return null;
    if (v.toLowerCase() === "n/a") return null;
    return v;
  }
  if (value === undefined) return null;
  return value;
}

function mergeScalar(target: unknown, source: unknown): unknown {
  const t = normalizePrimitive(target);
  const s = normalizePrimitive(source);
  if (t === null && s !== null) return s;
  if (s === null) return t;
  if (typeof t === "string" && typeof s === "string") {
    if (t === s) return t;
    if (t.includes(s)) return t;
    if (s.includes(t)) return s;
    return t;
  }
  return t;
}

function mergeArrays(target: unknown[], source: unknown[]): unknown[] {
  const merged = [...target, ...source]
    .map((x) => (typeof x === "string" ? x.trim() : x))
    .filter((x) => x !== null && x !== undefined && x !== "");

  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const item of merged) {
    const key = typeof item === "string" ? item.toLowerCase() : JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function mergeDeep(target: any, source: any): any {
  if (source === null || source === undefined) return target;
  if (target === null || target === undefined) return source;
  if (Array.isArray(target) && Array.isArray(source)) return mergeArrays(target, source);
  if (typeof target === "object" && typeof source === "object") {
    const out: Record<string, unknown> = { ...target };
    for (const [key, sourceValue] of Object.entries(source)) {
      const targetValue = (out as Record<string, unknown>)[key];
      if (Array.isArray(sourceValue) || Array.isArray(targetValue)) {
        (out as Record<string, unknown>)[key] = mergeDeep(
          Array.isArray(targetValue) ? targetValue : [],
          Array.isArray(sourceValue) ? sourceValue : []
        );
      } else if (
        sourceValue &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        (out as Record<string, unknown>)[key] = mergeDeep(targetValue, sourceValue);
      } else {
        (out as Record<string, unknown>)[key] = mergeScalar(targetValue, sourceValue);
      }
    }
    return out;
  }
  return mergeScalar(target, source);
}

async function repairJsonOutput(raw: string): Promise<any> {
  const result = await ollamaGenerate(`Convert the following text to valid JSON object only.
Do not add explanations. Do not add markdown.
Keep only the JSON object content.

Text:
${raw}`);
  return parseModelJson(result.text);
}

async function parseChunkAdaptive(
  chunkText: string,
  chunkLabel: string,
  depth: number
): Promise<{ parsed: any; stats: { done: number; failed: number } }> {
  try {
    const result = await ollamaGenerate(buildStage0Prompt(chunkText, true));
    console.log(
      `[mediaplan][llm] stage=parse_brief_local_${chunkLabel} provider=ollama model=${result.model} inputTokens=${result.promptTokens} outputTokens=${result.outputTokens} depth=${depth}`
    );
    try {
      return { parsed: parseModelJson(result.text), stats: { done: 1, failed: 0 } };
    } catch (jsonError) {
      console.warn(`[mediaplan] stage=parse_brief_local_${chunkLabel} json parse failed, trying repair`, jsonError);
      try {
        return { parsed: await repairJsonOutput(result.text), stats: { done: 1, failed: 0 } };
      } catch (repairError) {
        console.warn(`[mediaplan] stage=parse_brief_local_${chunkLabel} json repair failed`, repairError);
        throw jsonError;
      }
    }
  } catch (error) {
    if (chunkText.length <= STAGE0_MIN_SPLIT_CHARS || depth >= STAGE0_MAX_SPLIT_DEPTH) {
      console.warn(`[mediaplan] stage=parse_brief_local_${chunkLabel} failed terminally`, error);
      return { parsed: null, stats: { done: 0, failed: 1 } };
    }

    const [left, right] = splitChunkInTwo(chunkText);
    if (!left || !right) {
      console.warn(`[mediaplan] stage=parse_brief_local_${chunkLabel} failed and cannot split`, error);
      return { parsed: null, stats: { done: 0, failed: 1 } };
    }

    console.warn(
      `[mediaplan] stage=parse_brief_local_${chunkLabel} failed, splitting depth=${depth + 1} left=${left.length} right=${right.length}`
    );
    const leftResult = await parseChunkAdaptive(left, `${chunkLabel}a`, depth + 1);
    const rightResult = await parseChunkAdaptive(right, `${chunkLabel}b`, depth + 1);
    return {
      parsed: mergeDeep(leftResult.parsed, rightResult.parsed),
      stats: {
        done: leftResult.stats.done + rightResult.stats.done,
        failed: leftResult.stats.failed + rightResult.stats.failed,
      },
    };
  }
}

export async function warmupOllama(): Promise<void> {
  try {
    const start = Date.now();
    const result = await ollamaGenerate('Return ONLY JSON: {"ok":true}');
    console.log(
      `[ollama] warmup ok model=${result.model} ms=${Date.now() - start} inputTokens=${result.promptTokens} outputTokens=${result.outputTokens}`
    );
  } catch (error) {
    console.warn("[ollama] warmup failed", error);
  }
}

export async function parseBriefLocal(text: string): Promise<any> {
  try {
    const source = String(text || "").trim();
    if (!source) return null;

    if (source.length <= LARGE_BRIEF_THRESHOLD_CHARS) {
      const result = await ollamaGenerate(buildStage0Prompt(source, false));
      console.log(
        `[mediaplan][llm] stage=parse_brief_local provider=ollama model=${result.model} inputTokens=${result.promptTokens} outputTokens=${result.outputTokens}`
      );
      return parseModelJson(result.text);
    }

    const chunks = splitIntoChunks(source, STAGE0_CHUNK_SIZE_CHARS, STAGE0_CHUNK_OVERLAP_CHARS);
    console.log(
      `[mediaplan] stage=parse_brief_local_chunked chunks=${chunks.length} chunkSize=${STAGE0_CHUNK_SIZE_CHARS} overlap=${STAGE0_CHUNK_OVERLAP_CHARS}`
    );

    let merged: any = null;
    let completed = 0;
    let failed = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const current = await parseChunkAdaptive(chunks[i], `chunk_${i + 1}_of_${chunks.length}`, 0);
      merged = mergeDeep(merged, current.parsed);
      completed += current.stats.done;
      failed += current.stats.failed;
    }

    if (!merged || completed === 0) {
      return null;
    }

    // Final pass normalizes merged facts back into the exact schema.
    const mergeFinalizePrompt = `You receive merged extraction candidates from multiple brief chunks.
Return ONLY valid final JSON in the exact schema. No markdown.
Preserve explicitly stated facts. Do not invent missing values.
Use null for missing scalar fields and [] for missing arrays.

${STAGE0_RULES}

Schema:
${STAGE0_SCHEMA}

Merged candidates:
${JSON.stringify(merged)}`;
    try {
      const finalResult = await ollamaGenerate(mergeFinalizePrompt);
      console.log(
        `[mediaplan][llm] stage=parse_brief_local_merge provider=ollama model=${finalResult.model} inputTokens=${finalResult.promptTokens} outputTokens=${finalResult.outputTokens} chunksDone=${completed} chunksFailed=${failed}`
      );
      return parseModelJson(finalResult.text);
    } catch (mergeError) {
      console.warn(
        `[mediaplan] stage=parse_brief_local_merge failed; continuing with merged chunk output chunksDone=${completed} chunksFailed=${failed}`,
        mergeError
      );
      return merged;
    }
  } catch (err) {
    console.warn("Ollama unavailable, falling back to Haiku for parsing", err);
    return null;
  }
}
