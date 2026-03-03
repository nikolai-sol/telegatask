import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  STAGE1_SYSTEM,
  STAGE2_CORRECTION_PREFIX,
  STAGE2_SYSTEM,
  type MediaBriefSummary,
} from "./mediaPlanning.prompts";

export const FAST_MODEL =
  process.env.MEDIA_PLAN_FAST_MODEL ||
  process.env.MEDIAPLAN_FAST_MODEL ||
  "claude-haiku-4-5";
export const THINKING_MODEL =
  process.env.MEDIA_PLAN_THINKING_MODEL ||
  process.env.MEDIAPLAN_THINKING_MODEL ||
  "claude-opus-4-5";

const PROMPT_CACHE_TTL_MS = Number(
  process.env.MEDIA_PLAN_PROMPT_CACHE_TTL_MS ||
    process.env.MEDIAPLAN_PROMPT_CACHE_TTL_MS ||
    10 * 60 * 1000
);
const PROMPT_CACHING_BETA = "prompt-caching-2024-07-31";

const promptCache = new Map<string, { value: string; expiresAt: number }>();

let anthropicClient: Anthropic | null = null;
let anthropicClientKey: string | null = null;

type ClaudeCallOptions = {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
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
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  if (!anthropicClient || anthropicClientKey !== apiKey) {
    anthropicClient = new Anthropic({ apiKey });
    anthropicClientKey = apiKey;
  }

  return anthropicClient;
}

function buildCacheKey(options: ClaudeCallOptions): string {
  const raw = [
    options.model,
    String(options.temperature ?? 0.3),
    String(options.maxOutputTokens ?? 4096),
    options.systemInstruction,
    options.userPrompt,
  ].join("\n---\n");

  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getCachedValue(key: string): string | null {
  const item = promptCache.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) {
    promptCache.delete(key);
    return null;
  }
  return item.value;
}

function setCachedValue(key: string, value: string): void {
  promptCache.set(key, { value, expiresAt: Date.now() + PROMPT_CACHE_TTL_MS });
}

function extractJsonPayload(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{") && inner.endsWith("}")) return inner;
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function toNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeCurrency(value: unknown): "RUB" | "USD" | "EUR" {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "RUB";
  if (raw === "USD" || raw === "EUR") return raw;
  return "RUB";
}

function normalizeGender(value: unknown): "all" | "male" | "female" | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "all" || raw === "male" || raw === "female") return raw;
  return null;
}

function normalizeGeoType(value: unknown): "national" | "regional" | "local" | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "national" || raw === "regional" || raw === "local") return raw;
  return null;
}

function normalizeSummary(raw: unknown): MediaBriefSummary {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const targetAudienceRaw =
    obj.target_audience && typeof obj.target_audience === "object"
      ? (obj.target_audience as Record<string, unknown>)
      : null;

  const budgetRaw =
    obj.budget && typeof obj.budget === "object" ? (obj.budget as Record<string, unknown>) : {};

  const geoRaw = obj.geo && typeof obj.geo === "object" ? (obj.geo as Record<string, unknown>) : null;

  const timingRaw =
    obj.timing && typeof obj.timing === "object" ? (obj.timing as Record<string, unknown>) : {};

  const targetAudienceLegacy = typeof obj.target_audience === "string" ? obj.target_audience.trim() : "";
  const geoLegacy = Array.isArray(obj.geo) ? toStringArray(obj.geo) : [];

  return {
    target_audience: {
      description: targetAudienceRaw
        ? toStringOrNull(targetAudienceRaw.description)
        : targetAudienceLegacy || null,
      age: targetAudienceRaw ? toStringOrNull(targetAudienceRaw.age) : null,
      gender: targetAudienceRaw ? normalizeGender(targetAudienceRaw.gender) : null,
      interests: targetAudienceRaw ? toStringArray(targetAudienceRaw.interests) : [],
      income: targetAudienceRaw ? toStringOrNull(targetAudienceRaw.income) : null,
    },
    budget: {
      total: toNumberOrNull(budgetRaw.total),
      currency: normalizeCurrency(budgetRaw.currency),
      note: toStringOrNull(budgetRaw.note),
    },
    geo: {
      cities: geoRaw ? toStringArray(geoRaw.cities) : geoLegacy,
      regions: geoRaw ? toStringArray(geoRaw.regions) : [],
      type: geoRaw ? normalizeGeoType(geoRaw.type) : null,
    },
    channels: toStringArray(obj.channels),
    goal: toStringOrNull(obj.goal),
    timing: {
      start: toStringOrNull(timingRaw.start),
      end: toStringOrNull(timingRaw.end),
      duration_weeks: toNumberOrNull(timingRaw.duration_weeks),
    },
    kpi: toStringArray(obj.kpi),
    product: toStringOrNull(obj.product),
    unclear: toStringArray(obj.unclear),
  };
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

async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const cacheKey = buildCacheKey(options);
  const cached = getCachedValue(cacheKey);
  if (cached !== null) return cached;

  const client = getAnthropicClient();

  const response = await client.beta.messages.create(
    {
      model: options.model,
      max_tokens: options.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? 0.3,
      betas: [PROMPT_CACHING_BETA],
      system: [
        {
          type: "text",
          text: options.systemInstruction,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: options.userPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    },
    options.timeoutMs ? { timeout: options.timeoutMs } : undefined
  );

  const text = extractTextBlocks(response.content);

  if (!text) {
    throw new Error("Claude returned empty response");
  }

  setCachedValue(cacheKey, text);
  return text;
}

async function parseSummaryWithRetry(userPrompt: string): Promise<MediaBriefSummary> {
  const first = await callClaude({
    model: FAST_MODEL,
    systemInstruction: STAGE1_SYSTEM,
    userPrompt,
    temperature: 0.1,
    maxOutputTokens: 1600,
  });

  const firstJson = extractJsonPayload(first);
  if (firstJson) {
    return normalizeSummary(JSON.parse(firstJson) as unknown);
  }

  const retry = await callClaude({
    model: FAST_MODEL,
    systemInstruction: STAGE1_SYSTEM,
    userPrompt: `${userPrompt}\n\nJSON only, no other text.`,
    temperature: 0,
    maxOutputTokens: 1600,
  });

  const retryJson = extractJsonPayload(retry);
  if (!retryJson) {
    throw new Error("Invalid JSON response from fast model");
  }

  return normalizeSummary(JSON.parse(retryJson) as unknown);
}

export async function parseBrief(text: string): Promise<MediaBriefSummary> {
  try {
    return await parseSummaryWithRetry(text);
  } catch (error) {
    console.error("[mediaplan] parseBrief failed", error);
    throw error;
  }
}

export async function updateBriefSummary(
  currentSummary: MediaBriefSummary,
  correction: string,
  briefRaw: string
): Promise<MediaBriefSummary> {
  try {
    const prompt = [
      "Original brief:",
      briefRaw,
      "",
      "Current summary JSON:",
      JSON.stringify(currentSummary, null, 2),
      "",
      `User correction: ${correction}`,
      "",
      "Return only corrected JSON in the same schema.",
    ].join("\n");

    return await parseSummaryWithRetry(prompt);
  } catch (error) {
    console.error("[mediaplan] updateBriefSummary failed", error);
    throw error;
  }
}

export async function generateStrategy(summary: MediaBriefSummary, history: string[] = []): Promise<string> {
  try {
    const historyBlock = history.length
      ? `\n\nConversation history:\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : "";

    const prompt = `Validated media brief JSON:\n${JSON.stringify(summary, null, 2)}${historyBlock}`;

    return await callClaude({
      model: THINKING_MODEL,
      systemInstruction: STAGE2_SYSTEM,
      userPrompt: prompt,
      temperature: 0.35,
      maxOutputTokens: 4096,
      timeoutMs: 120000,
    });
  } catch (error) {
    console.error("[mediaplan] generateStrategy failed", error);
    throw error;
  }
}

export async function regenerateStrategyWithCorrection(
  summary: MediaBriefSummary,
  previousStrategy: string,
  correction: string,
  history: string[] = []
): Promise<string> {
  try {
    const correctionPrompt = STAGE2_CORRECTION_PREFIX(previousStrategy, correction);
    const prompt =
      `Validated media brief JSON:\n${JSON.stringify(summary, null, 2)}\n\n` +
      correctionPrompt +
      (history.length
        ? `\n\nConversation history:\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
        : "");

    return await callClaude({
      model: THINKING_MODEL,
      systemInstruction: STAGE2_SYSTEM,
      userPrompt: prompt,
      temperature: 0.35,
      maxOutputTokens: 4096,
      timeoutMs: 120000,
    });
  } catch (error) {
    console.error("[mediaplan] regenerateStrategyWithCorrection failed", error);
    throw error;
  }
}
