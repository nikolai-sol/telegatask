import crypto from "crypto";
import {
  STAGE1_SYSTEM,
  STAGE2_CORRECTION,
  STAGE2_SYSTEM,
  type MediaBriefSummary,
} from "./mediaPlanning.prompts";

export const FAST_MODEL = process.env.MEDIAPLAN_FAST_MODEL || "claude-3-5-haiku-latest";
export const THINKING_MODEL = process.env.MEDIAPLAN_THINKING_MODEL || "claude-3-opus-latest";

const PROMPT_CACHE_TTL_MS = Number(process.env.MEDIAPLAN_PROMPT_CACHE_TTL_MS || 10 * 60 * 1000);
const promptCache = new Map<string, { value: string; expiresAt: number }>();

type ClaudeContentBlock = {
  type: string;
  text?: string;
};

type ClaudeResponse = {
  content?: ClaudeContentBlock[];
};

type ClaudeCallOptions = {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

function getClaudeApiKey(): string | null {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.CLAUDET_API_KEY ||
    process.env.GEMINI_API_KEY ||
    null;
  return key && String(key).trim() ? String(key).trim() : null;
}

function buildCacheKey(options: ClaudeCallOptions): string {
  const raw = [
    options.model,
    String(options.temperature ?? 0.4),
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
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function normalizeCurrency(value: unknown): "RUB" | "USD" | "EUR" {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "RUB";
  if (raw === "USD" || raw === "EUR") return raw;
  return "RUB";
}

function normalizeSummary(raw: unknown): MediaBriefSummary {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const budgetRaw = obj.budget && typeof obj.budget === "object" ? (obj.budget as Record<string, unknown>) : {};
  const timingRaw = obj.timing && typeof obj.timing === "object" ? (obj.timing as Record<string, unknown>) : {};

  const budgetTotal = Number(budgetRaw.total);

  return {
    target_audience:
      typeof obj.target_audience === "string" && obj.target_audience.trim()
        ? obj.target_audience.trim()
        : "не указано",
    budget: {
      total: Number.isFinite(budgetTotal) && budgetTotal >= 0 ? budgetTotal : 0,
      currency: normalizeCurrency(budgetRaw.currency),
    },
    geo: toStringArray(obj.geo),
    channels: toStringArray(obj.channels),
    goal: typeof obj.goal === "string" && obj.goal.trim() ? obj.goal.trim() : "не указано",
    timing: {
      start: typeof timingRaw.start === "string" && timingRaw.start.trim() ? timingRaw.start.trim() : null,
      end: typeof timingRaw.end === "string" && timingRaw.end.trim() ? timingRaw.end.trim() : null,
    },
    kpi: toStringArray(obj.kpi),
    unclear: toStringArray(obj.unclear),
  };
}

async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const apiKey = getClaudeApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY (or CLAUDE_API_KEY) not set");
  }

  const cacheKey = buildCacheKey(options);
  const cached = getCachedValue(cacheKey);
  if (cached !== null) return cached;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxOutputTokens ?? 4096,
      temperature: options.temperature ?? 0.4,
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
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as ClaudeResponse;
  const text =
    (data.content || [])
      .map((block) => (block.type === "text" ? block.text || "" : ""))
      .join("")
      .trim() || "";

  if (!text) {
    throw new Error("Claude returned empty response");
  }

  setCachedValue(cacheKey, text);
  return text;
}

export async function parseBrief(text: string): Promise<MediaBriefSummary> {
  try {
    const raw = await callClaude({
      model: FAST_MODEL,
      systemInstruction: STAGE1_SYSTEM,
      userPrompt: text,
      temperature: 0.1,
      maxOutputTokens: 1200,
    });

    const jsonText = extractJsonPayload(raw);
    if (!jsonText) {
      throw new Error("Invalid JSON response");
    }

    const parsed = JSON.parse(jsonText) as unknown;
    return normalizeSummary(parsed);
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

    const raw = await callClaude({
      model: FAST_MODEL,
      systemInstruction: STAGE1_SYSTEM,
      userPrompt: prompt,
      temperature: 0.1,
      maxOutputTokens: 1400,
    });

    const jsonText = extractJsonPayload(raw);
    if (!jsonText) {
      throw new Error("Invalid JSON response");
    }

    const parsed = JSON.parse(jsonText) as unknown;
    return normalizeSummary(parsed);
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
    const correctionPrompt = STAGE2_CORRECTION(previousStrategy, correction);
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
    });
  } catch (error) {
    console.error("[mediaplan] regenerateStrategyWithCorrection failed", error);
    throw error;
  }
}
