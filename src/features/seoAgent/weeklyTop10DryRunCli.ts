import { readFileSync } from "fs";
import type { SeoOpportunity } from "./types";
import type { WeeklyTop10GeneratorConfig } from "./weeklyTop10Generator";

export type WeeklyTop10DryRunCliOptions = {
  teamId: string;
  runId: string;
  opportunitiesPath: string;
  config: Partial<WeeklyTop10GeneratorConfig>;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function readNumberFlag(args: string[], name: string): number | null {
  const raw = readFlag(args, name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseWeeklyTop10DryRunCliOptions(args: string[]): WeeklyTop10DryRunCliOptions {
  const teamId = readFlag(args, "--team-id");
  const runId = readFlag(args, "--run-id");
  const opportunitiesPath = readFlag(args, "--opportunities");
  if (!teamId || !runId || !opportunitiesPath) {
    throw new Error(
      "Usage: runWeeklyTop10DryRun --team-id <teamId> --run-id <runId> --opportunities <opportunities.json> [--now <iso>] [--max-items <n>] [--max-watchlist-items <n>] [--min-confidence-score <n>] [--stale-approved-days <n>]"
    );
  }

  const config: Partial<WeeklyTop10GeneratorConfig> = {};
  const now = readFlag(args, "--now");
  const maxItems = readNumberFlag(args, "--max-items");
  const maxWatchlistItems = readNumberFlag(args, "--max-watchlist-items");
  const minConfidenceScore = readNumberFlag(args, "--min-confidence-score");
  const staleApprovedDays = readNumberFlag(args, "--stale-approved-days");

  if (now) config.now = now;
  if (maxItems !== null) config.maxItems = maxItems;
  if (maxWatchlistItems !== null) config.maxWatchlistItems = maxWatchlistItems;
  if (minConfidenceScore !== null) config.minConfidenceScore = minConfidenceScore;
  if (staleApprovedDays !== null) config.staleApprovedDays = staleApprovedDays;

  return {
    teamId,
    runId,
    opportunitiesPath,
    config,
  };
}

function isOpportunity(value: unknown): value is SeoOpportunity {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return Boolean(
    item &&
      typeof item.title === "string" &&
      typeof item.description === "string" &&
      Array.isArray(item.targetKeywords) &&
      typeof item.priority === "string" &&
      typeof item.confidence === "string" &&
      typeof item.source === "string"
  );
}

export function parseSeoOpportunitiesJson(raw: string): SeoOpportunity[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isOpportunity)) {
    throw new Error("Opportunities file must contain a JSON array of SeoOpportunity-like objects.");
  }
  return parsed;
}

export function readSeoOpportunitiesFile(path: string): SeoOpportunity[] {
  return parseSeoOpportunitiesJson(readFileSync(path, "utf8"));
}
