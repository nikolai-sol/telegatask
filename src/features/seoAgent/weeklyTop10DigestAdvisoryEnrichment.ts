import type { SeoDigestAdvisory, SeoOpportunity } from "./types";
import type { LLMService } from "../../core/services/llm";
import { execFile } from "child_process";
import { existsSync } from "fs";

export type HermesDigestAdvisoryDraft = {
  recommendationText: string;
  coveredIntents: string[];
  internalLinkSuggestions: string[];
  medicalReviewText: string | null;
};

export type HermesDigestAdvisoryUsage = SeoDigestAdvisory["tokenUsage"];

export type HermesDigestAdvisoryClient = {
  generateDigestAdvisory(input: {
    opportunity: Readonly<SeoOpportunity>;
    prompt: string;
  }): Promise<{
    advisory: HermesDigestAdvisoryDraft;
    usage?: Partial<HermesDigestAdvisoryUsage>;
  } | null>;
};

export type HermesCliDigestAdvisoryClientOptions = {
  command?: string;
  model?: string | null;
  timeoutMs?: number;
  runCommand?: (command: string, args: string[]) => Promise<string>;
  commandExists?: (command: string) => boolean;
};

export type WeeklyTop10DigestAdvisoryEnrichmentResult = {
  opportunities: SeoOpportunity[];
  summary: {
    requested: number;
    enriched: number;
    degraded: number;
    complianceRejected: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  failures: Array<{
    opportunityId: string;
    reason: string;
  }>;
};

export const DEFAULT_HERMES_DIGEST_MODEL = "grok-4.5";
export const EU_BLOCKED_HERMES_DIGEST_MODELS: string[] = [];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

function parseModelList(value: unknown): string[] {
  return cleanString(value)
    .split(",")
    .map((item) => normalizeModelId(item))
    .filter(Boolean);
}

export function resolveHermesDigestModel(value?: string | null): string {
  const model = cleanString(value) || cleanString(process.env.HERMES_DIGEST_MODEL) || DEFAULT_HERMES_DIGEST_MODEL;
  const blockedModels = new Set([
    ...EU_BLOCKED_HERMES_DIGEST_MODELS.map(normalizeModelId),
    ...parseModelList(process.env.HERMES_DIGEST_BLOCKED_MODELS),
  ]);
  if (blockedModels.has(normalizeModelId(model))) {
    throw new Error(
      `Hermes digest model "${model}" is blocked for this EU pipeline; use HERMES_DIGEST_MODEL=${DEFAULT_HERMES_DIGEST_MODEL}`
    );
  }
  return model;
}

function normalized(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/ё/g, "е");
}

function opportunityId(opportunity: SeoOpportunity): string {
  return cleanString(opportunity.sourceFindingId) || cleanString(opportunity.title) || "unknown_opportunity";
}

function textParts(advisory: HermesDigestAdvisoryDraft): string[] {
  return [
    advisory.recommendationText,
    ...(advisory.coveredIntents || []),
    ...(advisory.internalLinkSuggestions || []),
    advisory.medicalReviewText || "",
  ].filter(Boolean);
}

function complianceFailure(input: {
  advisory: HermesDigestAdvisoryDraft;
  drugComplianceTokens: readonly string[];
}): string | null {
  const text = normalized(textParts(input.advisory).join(" "));
  const token = input.drugComplianceTokens.find((item) => {
    const normalizedToken = normalized(item);
    return normalizedToken && text.includes(normalizedToken);
  });
  return token ? `advisory_contains_drug_compliance_token: ${token}` : null;
}

function languageFailure(advisory: HermesDigestAdvisoryDraft): string | null {
  const text = textParts(advisory).join(" ");
  const cyrillicCount = (text.match(/[а-яё]/gi) || []).length;
  const latinCount = (text.match(/[a-z]/gi) || []).length;
  if (cyrillicCount === 0) return "advisory_not_russian";
  return cyrillicCount >= latinCount ? null : "advisory_not_russian";
}

function usageWithDefaults(usage?: Partial<HermesDigestAdvisoryUsage>): HermesDigestAdvisoryUsage {
  const inputTokens = usage?.inputTokens || 0;
  const outputTokens = usage?.outputTokens || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage?.totalTokens || inputTokens + outputTokens,
    estimated: usage?.estimated ?? true,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(cleanString(text).length / 4);
}

function parseAdvisoryJson(text: string): HermesDigestAdvisoryDraft | null {
  try {
    const parsed = JSON.parse(text) as Partial<HermesDigestAdvisoryDraft>;
    const recommendationText = cleanString(parsed.recommendationText);
    if (!recommendationText) return null;
    return {
      recommendationText,
      coveredIntents: Array.isArray(parsed.coveredIntents) ? parsed.coveredIntents.map(cleanString).filter(Boolean) : [],
      internalLinkSuggestions: Array.isArray(parsed.internalLinkSuggestions)
        ? parsed.internalLinkSuggestions.map(cleanString).filter(Boolean)
        : [],
      medicalReviewText: cleanString(parsed.medicalReviewText) || null,
    };
  } catch {
    return null;
  }
}

function buildPrompt(opportunity: SeoOpportunity): string {
  return [
    "You are Hermes, an advisory SEO digest enrichment layer.",
    "Return only JSON with recommendationText, coveredIntents, internalLinkSuggestions, medicalReviewText.",
    "All human-facing JSON values must be written in Russian only.",
    "Do not create, score, filter, or change the opportunity.",
    `Opportunity: ${JSON.stringify({
      title: opportunity.title,
      opportunityType: opportunity.opportunityType,
      targetUrl: opportunity.targetUrl || null,
      targetKeywords: opportunity.targetKeywords,
      recommendedAction: opportunity.recommendedAction || null,
      evidence: opportunity.evidence || [],
    })}`,
  ].join("\n");
}

export function createHermesDigestAdvisoryClient(llm: Pick<LLMService, "generate">): HermesDigestAdvisoryClient {
  return {
    async generateDigestAdvisory(input) {
      const text = await llm.generate(input.prompt, true);
      if (!text) return null;
      const advisory = parseAdvisoryJson(text);
      if (!advisory) return null;
      return {
        advisory,
        usage: {
          inputTokens: estimateTokens(input.prompt),
          outputTokens: estimateTokens(text),
          totalTokens: estimateTokens(input.prompt) + estimateTokens(text),
          estimated: true,
        },
      };
    },
  };
}

function runHermesCli(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = cleanString(stderr) || error.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout);
    });
  });
}

export function createHermesCliDigestAdvisoryClient(
  options: HermesCliDigestAdvisoryClientOptions = {}
): HermesDigestAdvisoryClient {
  const command = cleanString(options.command) || process.env.HERMES_CLI_PATH || "/Users/nafanya/.local/bin/hermes";
  const model = resolveHermesDigestModel(options.model);
  const timeoutMs = options.timeoutMs || Number(process.env.HERMES_DIGEST_TIMEOUT_MS || 120_000);
  const runCommand = options.runCommand || ((cmd, args) => runHermesCli(cmd, args, timeoutMs));

  return {
    async generateDigestAdvisory(input) {
      const args = ["-z", input.prompt];
      args.push("--model", model);
      args.push("--ignore-rules", "--safe-mode");
      const text = await runCommand(command, args);
      const advisory = parseAdvisoryJson(text);
      if (!advisory) return null;
      return {
        advisory,
        usage: {
          inputTokens: estimateTokens(input.prompt),
          outputTokens: estimateTokens(text),
          totalTokens: estimateTokens(input.prompt) + estimateTokens(text),
          estimated: true,
        },
      };
    },
  };
}

export function createDefaultHermesDigestAdvisoryClient(
  llm: Pick<LLMService, "generate">,
  options: HermesCliDigestAdvisoryClientOptions = {}
): HermesDigestAdvisoryClient {
  const command = cleanString(options.command) || process.env.HERMES_CLI_PATH || "/Users/nafanya/.local/bin/hermes";
  const commandExists = options.commandExists || existsSync;
  if (commandExists(command)) {
    return createHermesCliDigestAdvisoryClient({
      ...options,
      command,
    });
  }
  return createHermesDigestAdvisoryClient(llm);
}

function emptySummary(): WeeklyTop10DigestAdvisoryEnrichmentResult["summary"] {
  return {
    requested: 0,
    enriched: 0,
    degraded: 0,
    complianceRejected: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export async function enrichWeeklyTop10DigestAdvisory(input: {
  enabled: boolean;
  generatedAt: string;
  opportunities: readonly SeoOpportunity[];
  client: HermesDigestAdvisoryClient;
  config: {
    drugComplianceTokens: readonly string[];
  };
}): Promise<WeeklyTop10DigestAdvisoryEnrichmentResult> {
  if (!input.enabled) {
    return {
      opportunities: [...input.opportunities],
      summary: emptySummary(),
      failures: [],
    };
  }

  const opportunities: SeoOpportunity[] = [];
  const summary = emptySummary();
  const failures: WeeklyTop10DigestAdvisoryEnrichmentResult["failures"] = [];

  for (const opportunity of input.opportunities) {
    summary.requested += 1;
    try {
      const response = await input.client.generateDigestAdvisory({
        opportunity: Object.freeze({ ...opportunity }),
        prompt: buildPrompt(opportunity),
      });
      if (!response?.advisory?.recommendationText) {
        summary.degraded += 1;
        failures.push({ opportunityId: opportunityId(opportunity), reason: "empty_advisory" });
        opportunities.push({ ...opportunity });
        continue;
      }
      const failure = complianceFailure({
        advisory: response.advisory,
        drugComplianceTokens: input.config.drugComplianceTokens,
      });
      if (failure) {
        summary.complianceRejected += 1;
        failures.push({ opportunityId: opportunityId(opportunity), reason: failure });
        opportunities.push({ ...opportunity });
        continue;
      }
      const languageCheckFailure = languageFailure(response.advisory);
      if (languageCheckFailure) {
        summary.complianceRejected += 1;
        failures.push({ opportunityId: opportunityId(opportunity), reason: languageCheckFailure });
        opportunities.push({ ...opportunity });
        continue;
      }
      const tokenUsage = usageWithDefaults(response.usage);
      summary.enriched += 1;
      summary.inputTokens += tokenUsage.inputTokens;
      summary.outputTokens += tokenUsage.outputTokens;
      summary.totalTokens += tokenUsage.totalTokens;
      opportunities.push({
        ...opportunity,
        advisory: {
          source: "hermes",
          generatedAt: input.generatedAt,
          recommendationText: response.advisory.recommendationText,
          coveredIntents: [...(response.advisory.coveredIntents || [])],
          internalLinkSuggestions: [...(response.advisory.internalLinkSuggestions || [])],
          medicalReviewText: response.advisory.medicalReviewText || null,
          complianceStatus: "passed",
          tokenUsage,
        },
      });
    } catch (error) {
      summary.degraded += 1;
      failures.push({
        opportunityId: opportunityId(opportunity),
        reason: String((error as Error)?.message || error),
      });
      opportunities.push({ ...opportunity });
    }
  }

  return {
    opportunities,
    summary,
    failures,
  };
}
