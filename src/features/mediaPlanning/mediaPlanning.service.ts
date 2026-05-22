import Anthropic from "@anthropic-ai/sdk";
import {
  DECISION_CHECK_PROMPT,
  ORD_REMINDER,
  RUSSIA_CONTEXT,
  RUSSIA_FORBIDDEN_CHANNELS,
  STRATEGY_SYSTEM,
  STRATEGY_SYSTEM_PREFIX,
  SUMMARY_SYSTEM,
  TEAM_TASKS_SYSTEM,
  THEORIES_SYSTEM,
} from "./mediaPlanning.prompts";

export const MODEL_CONFIG = {
  fast: {
    model: process.env.MEDIA_PLAN_RESEARCH_MODEL || "claude-haiku-4-5",
    temperature: 0.0,
    max_tokens: 1000,
  },
  research: {
    model: process.env.MEDIA_PLAN_RESEARCH_MODEL || "claude-haiku-4-5",
    temperature: 0.2,
    max_tokens: 2000,
  },
  strategy: {
    model: process.env.MEDIA_PLAN_STRATEGY_MODEL || "claude-opus-4-6",
    temperature: 0.7,
    max_tokens: 8000,
  },
  strategy_final: {
    model: process.env.MEDIA_PLAN_STRATEGY_MODEL || "claude-opus-4-6",
    temperature: 0.5,
    max_tokens: 16000,
  },
} as const;

const STAGE0_MAX_TOKENS = Math.max(1000, Number(process.env.MEDIA_PLAN_STAGE0_MAX_TOKENS || 5000));
const STAGE0_PARSE_MAX_TOKENS = 3000;
const STAGE0_PARSE_TIMEOUT_MS = 120000;
const STAGE0_PARSE_RETRIES = 3;
const STAGE0_PARSE_RETRY_DELAY_MS = 3000;

const CLAUDE_RETRY_ATTEMPTS = Math.max(1, Number(process.env.MEDIA_PLAN_CLAUDE_RETRY_ATTEMPTS || 4));
const CLAUDE_RETRY_BASE_MS = Math.max(250, Number(process.env.MEDIA_PLAN_CLAUDE_RETRY_BASE_MS || 1200));
const FORBIDDEN_QUESTION_KEYWORDS = [
  "орд",
  "маркировк",
  "раскрыти",
  "регулятор",
  "закон",
  "ак ",
  "агентское вознагражден",
  "комисси",
  "процент агент",
  "ндс",
  "юридич",
  "договор",
  "постоплат",
];

let anthropicClient: Anthropic | null = null;
let anthropicClientKey: string | null = null;

type AnthropicUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

function getAnthropicApiKey(): string | null {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.CLAUDET_API_KEY ||
    null;
  return key && String(key).trim() ? String(key).trim() : null;
}

function getAnthropicClient(): Anthropic {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  if (!anthropicClient || anthropicClientKey !== apiKey) {
    anthropicClient = new Anthropic({ apiKey });
    anthropicClientKey = apiKey;
  }

  return anthropicClient;
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const maybeBlock = block as { type?: unknown; text?: unknown };
      if (maybeBlock?.type === "text" && typeof maybeBlock.text === "string") {
        return maybeBlock.text;
      }
      return "";
    })
    .join("")
    .trim();
}

function toToken(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function extractUsage(response: unknown): AnthropicUsage {
  const usage = (response as { usage?: Record<string, unknown> } | null)?.usage || {};
  return {
    inputTokens: toToken(usage.input_tokens),
    outputTokens: toToken(usage.output_tokens),
    cacheReadTokens: toToken(usage.cache_read_input_tokens),
    cacheWriteTokens: toToken(usage.cache_creation_input_tokens),
  };
}

function logAnthropicUsage(stage: string, model: string, response: unknown): void {
  const usage = extractUsage(response);
  console.log(
    `[mediaplan][llm] stage=${stage} provider=anthropic model=${model} inputTokens=${usage.inputTokens} outputTokens=${usage.outputTokens} cacheReadTokens=${usage.cacheReadTokens} cacheWriteTokens=${usage.cacheWriteTokens}`
  );
}

function stripArtifacts(raw: string): string {
  return String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```json|```/gi, "")
    .trim();
}

function safeParseJSON(text: string, fallback?: unknown): any {
  let clean = stripArtifacts(text);

  try {
    return JSON.parse(clean);
  } catch {
    console.warn("[mediaPlan] JSON truncated, attempting repair...");

    clean = clean.replace(/,\s*$/, "");

    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (const ch of clean) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{") stack.push("}");
        if (ch === "[") stack.push("]");
        if (ch === "}" || ch === "]") stack.pop();
      }
    }

    if (inString) clean += "\"";
    clean += stack.reverse().join("");

    try {
      return JSON.parse(clean);
    } catch (repairError) {
      if (typeof fallback !== "undefined") {
        console.error("[mediaPlan] JSON repair failed, returning fallback");
        return fallback;
      }
      throw repairError;
    }
  }
}

function parseJsonValue(raw: string): any {
  const clean = stripArtifacts(raw);

  try {
    return safeParseJSON(clean);
  } catch {
    const objectMatch = clean.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      return safeParseJSON(objectMatch[0]);
    }

    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    if (arrayMatch?.[0]) {
      return safeParseJSON(arrayMatch[0]);
    }

    throw new Error("Failed to parse model JSON output");
  }
}

export function detectRussiaGeo(briefSummary: any): boolean {
  const geoText = JSON.stringify(briefSummary?.geo || "").toLowerCase();
  const rfKeywords = [
    "россия",
    "рф",
    "russia",
    "rf",
    "москва",
    "санкт-петербург",
    "вся россия",
    "national",
    "федерация",
  ];
  return rfKeywords.some((kw) => geoText.includes(kw));
}

export function filterChannelsForGeo(
  channels: string[],
  isRussia: boolean
): {
  allowed: string[];
  blocked: string[];
  warning: string | null;
} {
  if (!isRussia) return { allowed: channels, blocked: [], warning: null };
  const normalizedChannels = Array.isArray(channels) ? channels : [];
  const blocked = normalizedChannels.filter((ch) =>
    RUSSIA_FORBIDDEN_CHANNELS.some((f) => String(ch || "").toLowerCase().includes(f.toLowerCase()))
  );
  const allowed = normalizedChannels.filter(
    (ch) => !RUSSIA_FORBIDDEN_CHANNELS.some((f) => String(ch || "").toLowerCase().includes(f.toLowerCase()))
  );
  return {
    allowed,
    blocked,
    warning: blocked.length
      ? `⚠️ Следующие каналы недоступны в РФ и исключены: ${blocked.join(", ")}`
      : null,
  };
}

function filterQuestions(questions: string[]): string[] {
  return questions.filter((q) => {
    const lower = String(q || "").toLowerCase();
    return !FORBIDDEN_QUESTION_KEYWORDS.some((kw) => lower.includes(kw));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAnthropicError(error: unknown): boolean {
  const status = Number((error as { status?: unknown })?.status);
  const msg = String((error as { message?: unknown })?.message || "").toLowerCase();

  if (status === 403) return true;
  if (msg.includes("403")) return true;
  if (msg.includes("cloudflare")) return true;
  if (status === 429 || status === 529) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

async function anthropicWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = CLAUDE_RETRY_ATTEMPTS,
  delayMs = CLAUDE_RETRY_BASE_MS,
  label = "anthropic"
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = isRetryableAnthropicError(err);
      if (!retryable || attempt >= maxRetries) {
        throw err;
      }

      const backoffMs = delayMs * attempt;
      const msg = String((err as { message?: unknown })?.message || err);
      console.warn(
        `[mediaplan] ${label} attempt ${attempt}/${maxRetries} failed: ${msg}. Retry in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Max retries exceeded");
}

async function callClaudeJson(options: {
  stage: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
}): Promise<any> {
  const client = getAnthropicClient();
  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: options.model,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          system: options.system,
          messages: [{ role: "user", content: options.user }],
        },
        options.timeoutMs ? { timeout: options.timeoutMs } : undefined
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    options.stage
  );

  logAnthropicUsage(options.stage, options.model, response);

  const raw = extractTextBlocks(response.content);
  if (!raw) throw new Error("Claude returned empty response");
  try {
    return parseJsonValue(raw);
  } catch (parseError) {
    console.warn(`[mediaplan] ${options.stage} JSON parse failed, trying repair`, parseError);
    const repairResponse = await anthropicWithRetry(
      () =>
        client.messages.create(
          {
            model: options.model,
            max_tokens: Math.max(400, Math.min(options.maxTokens, STAGE0_MAX_TOKENS)),
            temperature: 0,
            system: "Fix malformed JSON. Return ONLY valid JSON. No markdown. No explanation.",
            messages: [{ role: "user", content: raw }],
          },
          options.timeoutMs ? { timeout: options.timeoutMs } : undefined
        ),
      CLAUDE_RETRY_ATTEMPTS,
      CLAUDE_RETRY_BASE_MS,
      `${options.stage}_json_repair`
    );
    logAnthropicUsage(`${options.stage}_json_repair`, options.model, repairResponse);
    const repairedRaw = extractTextBlocks(repairResponse.content);
    if (!repairedRaw) throw parseError;
    return parseJsonValue(repairedRaw);
  }
}

export async function parseBrief(text: string): Promise<any> {
  const stage0System = `Extract brief data. Return ONLY valid JSON. No markdown. No explanation.
Use null for any missing scalar field. Use [] for missing list field. Never invent data.

PARSING RULES:
- For pharma/medical products: always extract clinical claims, regulatory restrictions, competitor prices.
- For tenders: always extract tender_id, deadline, max_budget, deliverables list.
- For seasonal products: extract seasonality patterns.
- budget field: if budget has VAT/НДС note, set vat_included accordingly.
- channels_required vs channels_suggested: "обязательные" = required, "возможные/рекомендуемые" = suggested.
- product_restrictions: look for phrases like "реклама рецептурных", "медицинское изделие", "ОРД", pharma disclaimers.
- If brief mentions doctors/врачи as audience, add to b2b_targets.
- available_assets: look for mentions of existing site, accounts, creative materials, analytics access.

Schema:
{
  "product": "product/brand name",
  "product_type": "drug|medical_device|fmcg|service|b2b|other|null",
  "company": "company name if mentioned",
  "website": "url if mentioned",
  "goal": "primary campaign goal",
  "campaign_type": "always_on|launch|seasonal|tender|other|null",
  "period": { "start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null", "description": "text if no dates" },
  "budget": { "total": number or null, "currency": "RUB|USD|EUR|null", "vat_included": "true|false|null", "note": "any budget notes" },
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

  const client = getAnthropicClient();
  const prepared = String(text || "").slice(0, 15000);
  console.log(`[mediaPlan] parseBrief start, text length: ${prepared.length}`);

  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.fast.model,
          temperature: MODEL_CONFIG.fast.temperature,
          max_tokens: STAGE0_PARSE_MAX_TOKENS,
          system: stage0System,
          messages: [{ role: "user", content: prepared }],
        },
        { timeout: STAGE0_PARSE_TIMEOUT_MS }
      ),
    STAGE0_PARSE_RETRIES,
    STAGE0_PARSE_RETRY_DELAY_MS,
    "parse_brief_haiku"
  );
  logAnthropicUsage("parse_brief_haiku", MODEL_CONFIG.fast.model, response);

  const raw = extractTextBlocks(response.content);
  if (!raw) throw new Error("Claude returned empty response");

  try {
    const parsed = parseJsonValue(raw);
    const isRussia = detectRussiaGeo(parsed);
    parsed._geo_russia = isRussia;
    if (isRussia) {
      const { allowed, blocked, warning } = filterChannelsForGeo(parsed.channels_required || [], true);
      parsed.channels_required = allowed;
      parsed.channels_forbidden = [...(Array.isArray(parsed.channels_forbidden) ? parsed.channels_forbidden : []), ...blocked];
      if (warning) console.log(`[mediaPlan] ${warning}`);
    }
    console.log("[mediaPlan] parseBrief done");
    return parsed;
  } catch (parseError) {
    console.warn(`[mediaplan] parse_brief_haiku JSON parse failed, trying repair`, parseError);
    const repairResponse = await anthropicWithRetry(
      () =>
        client.messages.create(
          {
            model: MODEL_CONFIG.fast.model,
            temperature: 0,
            max_tokens: STAGE0_PARSE_MAX_TOKENS,
            system: "Fix malformed JSON. Return ONLY valid JSON. No markdown. No explanation.",
            messages: [{ role: "user", content: raw }],
          },
          { timeout: STAGE0_PARSE_TIMEOUT_MS }
        ),
      STAGE0_PARSE_RETRIES,
      STAGE0_PARSE_RETRY_DELAY_MS,
      "parse_brief_haiku_json_repair"
    );
    logAnthropicUsage("parse_brief_haiku_json_repair", MODEL_CONFIG.fast.model, repairResponse);
    const repairedRaw = extractTextBlocks(repairResponse.content);
    if (!repairedRaw) {
      return {
        product: "Не удалось распарсить",
        goal: null,
        unclear: ["Ошибка парсинга брифа — требуется ручная проверка"],
        _parse_error: true,
      };
    }
    const parsed = safeParseJSON(repairedRaw, {
      product: "Не удалось распарсить",
      goal: null,
      unclear: ["Ошибка парсинга брифа — требуется ручная проверка"],
      _parse_error: true,
    });
    const isRussia = detectRussiaGeo(parsed);
    parsed._geo_russia = isRussia;
    if (isRussia) {
      const { allowed, blocked, warning } = filterChannelsForGeo(parsed.channels_required || [], true);
      parsed.channels_required = allowed;
      parsed.channels_forbidden = [...(Array.isArray(parsed.channels_forbidden) ? parsed.channels_forbidden : []), ...blocked];
      if (warning) console.log(`[mediaPlan] ${warning}`);
    }
    console.log("[mediaPlan] parseBrief done");
    return parsed;
  }
}

export async function researchBrief(briefSummary: any): Promise<any> {
  console.log("[mediaPlan] researchBrief start");
  const result = await callClaudeJson({
    stage: "research_brief",
    model: MODEL_CONFIG.research.model,
    maxTokens: MODEL_CONFIG.research.max_tokens,
    temperature: MODEL_CONFIG.research.temperature,
    system: "You are a media planning analyst. Return ONLY valid JSON. No markdown. No explanation.",
    user: `Research this brief and return JSON:
{
  "audience_size": {
    "linkedin": "string",
    "facebook": "string",
    "google_search": "string"
  },
  "benchmarks": {
    "linkedin": { "cpl": "string", "ctr": "string", "cpc": "string" },
    "google_search": { "cpl": "string", "ctr": "string", "cpc": "string" },
    "facebook": { "cpl": "string", "ctr": "string", "cpc": "string" },
    "instagram": { "cpl": "string", "ctr": "string", "cpc": "string" }
  },
  "competitors": ["string"],
  "market_insights": ["string"],
  "budget_assessment": "string",
  "seasonality_data": "search volume peaks by month if product has seasonality",
  "regulatory_notes": "any advertising restrictions for this product category in Russia",
  "category_benchmarks": {
    "typical_ctr_search": "range for this category",
    "typical_cpm_display": "range",
    "typical_cpl": "range if lead-gen"
  },
  "recommended_channels_for_category": ["channels that typically work for this product type"],
  "channels_to_avoid": ["channels with restrictions for this category e.g. pharma on some platforms"]
}

    Brief: ${JSON.stringify(briefSummary)}`,
    timeoutMs: 45000,
  });
  console.log("[mediaPlan] researchBrief done");
  return result;
}

export async function generateQuestions(briefSummary: any, researchData: any): Promise<string[]> {
  console.log("[mediaPlan] generateQuestions start");
  const geoClause =
    !briefSummary?.geo?.type && !briefSummary?._geo_russia
      ? `IMPORTANT: geo is unclear. Make "В каких регионах планируется кампания? Вся Россия или конкретные города?" the FIRST question.`
      : "";
  const parsed = await callClaudeJson({
    stage: "generate_questions",
    model: MODEL_CONFIG.fast.model,
    maxTokens: 500,
    temperature: MODEL_CONFIG.fast.temperature,
    system: "Return ONLY a valid JSON array of strings. No markdown. Start with [ end with ].",
    user: `Generate max 5 clarifying questions for this advertising brief.

STRICT RULES — NEVER ask about:
- ОРД, маркировка рекламы, юридические требования (это проверяется позже на этапе стратегии)
- АК (агентское вознаграждение), комиссии, процент агентства (это медиапланирование/закупки)
- Каналы если они уже указаны в брифе как обязательные или возможные
- KPI если они явно прописаны в брифе
- Бюджет если он указан
- Гео если уже ясно (${briefSummary?._geo_russia ? "гео = Россия, уже определено" : "ГЕО НЕИЗВЕСТНО — спроси первым"})

ONLY ask about things that BLOCK strategy creation:
- Who exactly is the target audience (if vague)
- What is the main conversion action / goal (if unclear)
- What assets exist: site analytics access, existing creatives, social accounts
- Seasonality or campaign timing specifics (if not in brief)
- Key message / USP priority (if multiple and unclear which to lead with)
- Competitive differentiation focus (if unclear)

${geoClause}
Brief: ${JSON.stringify(briefSummary)}
Research gaps: ${JSON.stringify(briefSummary?.unclear || [])}
Research data: ${JSON.stringify(researchData)}

Return ONLY a JSON array of strings. Max 5 questions. Only what truly blocks strategy.
Start with [ end with ].`,
    timeoutMs: 30000,
  });

  if (!Array.isArray(parsed)) return [];
  const parsedQuestions = parsed
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
  const filtered = filterQuestions(parsedQuestions).slice(0, 5);
  console.log(`[mediaPlan] Questions: ${parsedQuestions.length} raw -> ${filtered.length} after filter`);
  console.log("[mediaPlan] generateQuestions done");
  return filtered;
}

export async function generateSummary(
  briefSummary: any,
  researchData: any,
  clarifications: Array<{ question: string; answer: string }>
): Promise<string> {
  console.log("[mediaPlan] generateSummary start");
  const client = getAnthropicClient();
  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.fast.model,
          temperature: MODEL_CONFIG.fast.temperature,
          max_tokens: 800,
          system: SUMMARY_SYSTEM,
          messages: [
            {
              role: "user",
              content: JSON.stringify({ briefSummary, researchData, clarifications }),
            },
          ],
        },
        { timeout: 30000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "generate_summary"
  );

  logAnthropicUsage("generate_summary", MODEL_CONFIG.fast.model, response);
  let text = extractTextBlocks(response.content);
  if (briefSummary?._geo_russia) {
    const blocked = Array.isArray(briefSummary?.channels_forbidden) ? briefSummary.channels_forbidden : [];
    const geoNote =
      `\n\n**Гео:** Россия 🇷🇺\n` +
      `**Доступные платформы:** только российские (Meta/Google/LinkedIn заблокированы)` +
      (blocked.length ? `\n**⚠️ Исключены как недоступные в РФ:** ${blocked.join(", ")}` : "");
    if (!text.includes("Россия 🇷🇺")) text += geoNote;
  }
  console.log("[mediaPlan] generateSummary done");
  return text;
}

export async function generateStrategy(
  briefRaw: string,
  briefSummary: any,
  researchData: any,
  clarifications: Array<{ question: string; answer: string }>,
  teamData = ""
): Promise<string> {
  const client = getAnthropicClient();
  const strategyPayload = {
    original_brief: briefRaw,
    parsed_summary: briefSummary,
    research_data: researchData,
    clarifications,
    team_data: teamData,
  };
  const strategyPayloadChars = JSON.stringify(strategyPayload).length;
  console.log(`[mediaPlan] generateStrategy start, payloadChars=${strategyPayloadChars}`);
  const strategySystem = `${briefSummary?._geo_russia ? `${RUSSIA_CONTEXT}\n${ORD_REMINDER}\n` : ""}${STRATEGY_SYSTEM_PREFIX(teamData)}${STRATEGY_SYSTEM}`;

  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.strategy_final.model,
          max_tokens: MODEL_CONFIG.strategy_final.max_tokens,
          temperature: MODEL_CONFIG.strategy_final.temperature,
          system: strategySystem,
          messages: [
            {
              role: "user",
              content: JSON.stringify(strategyPayload),
            },
          ],
        },
        { timeout: 300000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "generate_strategy"
  );

  logAnthropicUsage("generate_strategy", MODEL_CONFIG.strategy_final.model, response);

  const text = extractTextBlocks(response.content);
  if (!text) throw new Error("Strategy model returned empty response");
  console.log("[mediaPlan] generateStrategy done");
  return text;
}

export async function generateTheories(
  briefSummary: any,
  researchData: any,
  clarifications: Array<{ question: string; answer: string }>
): Promise<string> {
  const client = getAnthropicClient();
  const theoriesSystem = `${briefSummary?._geo_russia ? `${RUSSIA_CONTEXT}\n` : ""}${THEORIES_SYSTEM}`;
  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.strategy.model,
          max_tokens: 1000,
          temperature: MODEL_CONFIG.strategy.temperature,
          system: theoriesSystem,
          messages: [
            {
              role: "user",
              content: JSON.stringify({ briefSummary, researchData, clarifications }),
            },
          ],
        },
        { timeout: 90000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "generate_theories"
  );
  logAnthropicUsage("generate_theories", MODEL_CONFIG.strategy.model, response);

  return extractTextBlocks(response.content);
}

export async function checkIfDecided(message: string): Promise<boolean> {
  const client = getAnthropicClient();
  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.fast.model,
          max_tokens: 10,
          temperature: MODEL_CONFIG.fast.temperature,
          messages: [{ role: "user", content: DECISION_CHECK_PROMPT(message) }],
        },
        { timeout: 20000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "decision_check"
  );
  logAnthropicUsage("decision_check", MODEL_CONFIG.fast.model, response);

  const text = extractTextBlocks(response.content);
  return text.trim().toLowerCase().includes("decided");
}

export async function continueTheoriesDiscussion(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  isRussia = false
): Promise<string> {
  const client = getAnthropicClient();
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];
  const theoriesSystem = `${isRussia ? `${RUSSIA_CONTEXT}\n` : ""}${THEORIES_SYSTEM}`;

  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.strategy.model,
          max_tokens: 600,
          temperature: MODEL_CONFIG.strategy.temperature,
          system: theoriesSystem,
          messages,
        },
        { timeout: 60000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "continue_theories"
  );
  logAnthropicUsage("continue_theories", MODEL_CONFIG.strategy.model, response);

  return extractTextBlocks(response.content);
}

export async function generateTeamTasks(
  briefSummary: any,
  researchData: any,
  selectedTheory: string
): Promise<string> {
  const client = getAnthropicClient();
  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.strategy.model,
          max_tokens: 1500,
          temperature: 0.3,
          system: TEAM_TASKS_SYSTEM,
          messages: [
            {
              role: "user",
              content: JSON.stringify({ briefSummary, researchData, chosenDirection: selectedTheory }),
            },
          ],
        },
        { timeout: 60000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "generate_team_tasks"
  );
  logAnthropicUsage("generate_team_tasks", MODEL_CONFIG.strategy.model, response);

  return extractTextBlocks(response.content);
}

export function parseTeamTasksIntoBlocks(teamTasksText: string): {
  targetologist: string[];
  analyst: string[];
  account: string[];
  client: string[];
} {
  const lines = String(teamTasksText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = {
    targetologist: [] as string[],
    analyst: [] as string[],
    account: [] as string[],
    client: [] as string[],
  };

  let current: keyof typeof result | null = null;
  for (const line of lines) {
    if (line.includes("Таргетолог") || line.includes("Медиабайер")) {
      current = "targetologist";
      continue;
    }
    if (line.includes("Аналитик")) {
      current = "analyst";
      continue;
    }
    if (line.includes("Клиент-менеджер") || line.includes("Аккаунт")) {
      current = "account";
      continue;
    }
    if (line.includes("Запросить у клиента")) {
      current = "client";
      continue;
    }

    if (!current) continue;
    if (!line.startsWith("-") && !line.startsWith("•")) continue;
    const normalized = line.replace(/^[-•]\s*/, "").trim();
    if (!normalized) continue;
    result[current].push(normalized);
  }

  return result;
}

export async function generatePlanTitle(briefSummary: any): Promise<string> {
  const client = getAnthropicClient();
  const response = await anthropicWithRetry(
    () =>
      client.messages.create(
        {
          model: MODEL_CONFIG.fast.model,
          max_tokens: 30,
          temperature: MODEL_CONFIG.fast.temperature,
          messages: [
            {
              role: "user",
              content: `Generate a short 3-5 word title for this campaign brief. Return ONLY the title, nothing else.
Brief: ${briefSummary?.product || ""} | Goal: ${briefSummary?.goal || ""} | Budget: ${briefSummary?.budget?.total || ""} ${briefSummary?.budget?.currency || ""}`,
            },
          ],
        },
        { timeout: 20000 }
      ),
    CLAUDE_RETRY_ATTEMPTS,
    CLAUDE_RETRY_BASE_MS,
    "generate_plan_title"
  );
  logAnthropicUsage("generate_plan_title", MODEL_CONFIG.fast.model, response);

  const title = extractTextBlocks(response.content).replace(/[\r\n]+/g, " ").trim();
  return title || "Медиаплан";
}
