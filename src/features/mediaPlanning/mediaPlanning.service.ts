import {
  STAGE1_SYSTEM,
  STAGE2_CORRECTION,
  STAGE2_SYSTEM,
  type MediaBriefSummary,
} from "./mediaPlanning.prompts";

export const FAST_MODEL = "gemini-2.0-flash";
export const THINKING_MODEL = "gemini-2.5-pro";

type GeminiContentPart = { text?: string };
type GeminiCandidate = { content?: { parts?: GeminiContentPart[] } };

type GeminiCallOptions = {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  responseJson?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
};

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

async function callGemini(options: GeminiCallOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const model = options.model;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: options.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: options.userPrompt }] }],
        generationConfig: options.responseJson
          ? {
              responseMimeType: "application/json",
              temperature: options.temperature ?? 0.2,
            }
          : {
              temperature: options.temperature ?? 0.5,
              maxOutputTokens: options.maxOutputTokens ?? 4096,
            },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as { candidates?: GeminiCandidate[] };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return text;
}

export async function parseBrief(text: string): Promise<MediaBriefSummary> {
  try {
    const raw = await callGemini({
      model: FAST_MODEL,
      systemInstruction: STAGE1_SYSTEM,
      userPrompt: text,
      responseJson: true,
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

    const raw = await callGemini({
      model: FAST_MODEL,
      systemInstruction: STAGE1_SYSTEM,
      userPrompt: prompt,
      responseJson: true,
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

    return await callGemini({
      model: THINKING_MODEL,
      systemInstruction: STAGE2_SYSTEM,
      userPrompt: prompt,
      responseJson: false,
      temperature: 0.4,
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

    return await callGemini({
      model: THINKING_MODEL,
      systemInstruction: STAGE2_SYSTEM,
      userPrompt: prompt,
      responseJson: false,
      temperature: 0.4,
      maxOutputTokens: 4096,
    });
  } catch (error) {
    console.error("[mediaplan] regenerateStrategyWithCorrection failed", error);
    throw error;
  }
}
