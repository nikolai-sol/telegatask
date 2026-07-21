import {
  encodeWeeklyTop10TelegramApprovalCallback,
  type WeeklyTop10TelegramApprovalButton,
} from "./weeklyTop10TelegramApprovalMessage";
import {
  DEFAULT_WEEKLY_TOP10_TELEGRAM_RU_TEMPLATE,
  type WeeklyTop10TelegramRuTemplate,
} from "./weeklyTop10TelegramApprovalRuTemplate";
import type { SeoOpportunityType } from "./types";
import type { SeoDigestAdvisory } from "./types";
import type { WeeklyTop10DigestItem } from "./weeklyTop10Generator";

export type WeeklyTop10TelegramApprovalEvidenceV2 = {
  opportunityId: string;
  clusterId?: string | null;
  section?: string | null;
  query: string;
  seedQueries?: string[];
  intentClass?: string | null;
  targetUrl?: string | null;
  targetUrlBindingSourceQuery?: string | null;
  targetUrlBindingSerpPosition?: number | null;
  webmasterAveragePosition?: number | null;
  serpPosition?: number | null;
  ctr?: number | null;
  impressions?: number | null;
  opportunityType?: SeoOpportunityType | null;
  medicalReviewRequired?: boolean;
  advisory?: SeoDigestAdvisory | null;
};

export type WeeklyTop10TelegramApprovalMessageV2 = {
  text: string;
  buttons: WeeklyTop10TelegramApprovalButton[][];
  metadata: {
    schema: "weekly_top10_telegram_approval_message_v2";
    language: "ru";
    maxCallbackDataBytes: 64;
    sendsNotifications: false;
    executesApprovalCommand: false;
    defaultConvertButton: false;
    evidence: WeeklyTop10TelegramApprovalEvidenceV2;
  };
};

export type WeeklyTop10TelegramApprovalMessageV2Input = {
  item: WeeklyTop10DigestItem;
  evidence: WeeklyTop10TelegramApprovalEvidenceV2;
  teamId: string;
  runId: string;
  draftTaskId: string;
  includeConvertButton?: boolean;
  template?: WeeklyTop10TelegramRuTemplate;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, maxLength: number): string {
  const clean = cleanString(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : DEFAULT_WEEKLY_TOP10_TELEGRAM_RU_TEMPLATE.labels.unknown;
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : DEFAULT_WEEKLY_TOP10_TELEGRAM_RU_TEMPLATE.labels.unknown;
}

function formatIntent(value: string | null | undefined): string {
  return cleanString(value) || "не классифицирован";
}

function formatSerpLine(evidence: WeeklyTop10TelegramApprovalEvidenceV2, template: WeeklyTop10TelegramRuTemplate): string {
  if (evidence.opportunityType === "section_ranking_gap" && typeof evidence.serpPosition !== "number") {
    return `${template.labels.serp}: не найден в выдаче`;
  }
  return `${template.labels.serp}: позиция ${formatNumber(evidence.serpPosition)}`;
}

function actionText(input: {
  evidence: WeeklyTop10TelegramApprovalEvidenceV2;
  item: WeeklyTop10DigestItem;
  template: WeeklyTop10TelegramRuTemplate;
}): string {
  if (input.evidence.opportunityType === "section_ranking_gap") {
    return input.template.actionText.byOpportunityType.section_ranking_gap || input.template.actionText.default;
  }
  if (input.evidence.intentClass === "facility_navigational") {
    return input.template.actionText.facilityNavigational;
  }
  if (input.evidence.medicalReviewRequired || input.evidence.intentClass === "medical_informational") {
    return input.template.actionText.medicalInformational;
  }
  if (input.evidence.opportunityType && input.template.actionText.byOpportunityType[input.evidence.opportunityType]) {
    return input.template.actionText.byOpportunityType[input.evidence.opportunityType] || input.template.actionText.default;
  }
  return cleanString(input.item.recommendedAction) || input.template.actionText.default;
}

function gapPresentationLines(evidence: WeeklyTop10TelegramApprovalEvidenceV2, template: WeeklyTop10TelegramRuTemplate): string[] {
  if (evidence.opportunityType !== "section_ranking_gap") return [];
  const hasUrl = Boolean(cleanString(evidence.targetUrl));
  const lines = [
    `Тип gap: ${hasUrl ? "доработать существующую страницу" : "страницы нет — кандидат на новый контент"}`,
  ];
  if (hasUrl && evidence.targetUrlBindingSourceQuery) {
    lines.push(
      `URL найден по варианту: ${evidence.targetUrlBindingSourceQuery}, SERP позиция ${formatNumber(evidence.targetUrlBindingSerpPosition)}`
    );
  }
  if (!hasUrl) {
    lines.push(`URL verdict: ${template.labels.noUrl} в выдаче`);
  }
  return lines;
}

function advisoryLines(advisory: SeoDigestAdvisory | null | undefined): string[] {
  if (!advisory) return [];
  return [
    `Hermes-рекомендация: ${advisory.recommendationText}`,
    advisory.coveredIntents.length ? `Покрытые интенты: ${advisory.coveredIntents.join("; ")}` : "",
    advisory.internalLinkSuggestions.length ? `Внутренние ссылки: ${advisory.internalLinkSuggestions.join("; ")}` : "",
    advisory.medicalReviewText ? `Медицинское ревью: ${advisory.medicalReviewText}` : "",
  ].filter(Boolean);
}

export function mergeHermesAdvisoryIntoTelegramText(
  originalText: string,
  advisory: SeoDigestAdvisory
): string {
  const base = String(originalText || "").trim();
  if (!base || base.includes("Hermes-рекомендация:")) return base;
  const lines = base.split("\n");
  const actionIndex = lines.findIndex((line) => line.startsWith("Что сделать:"));
  const insertAt = actionIndex >= 0 ? actionIndex : lines.length;
  lines.splice(insertAt, 0, ...advisoryLines(advisory));
  return lines.join("\n");
}

export function buildWeeklyTop10TelegramApprovalMessageV2(
  input: WeeklyTop10TelegramApprovalMessageV2Input
): WeeklyTop10TelegramApprovalMessageV2 {
  const template = input.template || DEFAULT_WEEKLY_TOP10_TELEGRAM_RU_TEMPLATE;
  const callbackBase = {
    version: "v1" as const,
    teamId: input.teamId,
    runId: input.runId,
    draftTaskId: input.draftTaskId,
  };
  const buttons: WeeklyTop10TelegramApprovalButton[][] = [
    [
      {
        text: template.labels.approve,
        callbackData: encodeWeeklyTop10TelegramApprovalCallback({
          ...callbackBase,
          action: "approve",
        }),
      },
      {
        text: template.labels.reject,
        callbackData: encodeWeeklyTop10TelegramApprovalCallback({
          ...callbackBase,
          action: "reject",
        }),
      },
      {
        text: template.labels.open,
        callbackData: encodeWeeklyTop10TelegramApprovalCallback({
          ...callbackBase,
          action: "open",
        }),
      },
    ],
  ];
  if (input.includeConvertButton) {
    buttons.push([
      {
        text: template.labels.convert,
        callbackData: encodeWeeklyTop10TelegramApprovalCallback({
          ...callbackBase,
          action: "convert",
        }),
      },
    ]);
  }

  const evidence = input.evidence;
  const url = cleanString(evidence.targetUrl) || template.labels.noUrl;
  return {
    text: [
      `${template.labels.titlePrefix} #${input.item.rank + 1}: ${truncate(evidence.query || input.item.title, 90)}`,
      evidence.section ? `Раздел: ${evidence.section}` : "",
      evidence.seedQueries?.length ? `Запросы: ${evidence.seedQueries.slice(0, 4).join("; ")}` : "",
      `${template.labels.intent}: ${formatIntent(evidence.intentClass)}; ${
        evidence.medicalReviewRequired ? template.labels.medicalReviewRequired : template.labels.medicalReviewNotRequired
      }`,
      `${template.labels.url}: ${url}`,
      ...gapPresentationLines(evidence, template),
      `${template.labels.webmaster}: показы ${formatNumber(evidence.impressions)}, CTR ${formatPercent(evidence.ctr)}, ср. позиция ${formatNumber(evidence.webmasterAveragePosition, 2)}`,
      formatSerpLine(evidence, template),
      ...advisoryLines(evidence.advisory),
      `${template.labels.action}: ${actionText({ evidence, item: input.item, template })}`,
    ].filter(Boolean).join("\n"),
    buttons,
    metadata: {
      schema: "weekly_top10_telegram_approval_message_v2",
      language: "ru",
      maxCallbackDataBytes: 64,
      sendsNotifications: false,
      executesApprovalCommand: false,
      defaultConvertButton: false,
      evidence: { ...evidence },
    },
  };
}
