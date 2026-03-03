export type MediaBriefSummary = {
  target_audience: string;
  budget: {
    total: number;
    currency: "RUB" | "USD" | "EUR";
  };
  geo: string[];
  channels: string[];
  goal: string;
  timing: {
    start: string | null;
    end: string | null;
  };
  kpi: string[];
  unclear: string[];
};

export const STAGE1_SYSTEM = `
You are a media planning assistant. Extract from the brief ONLY valid JSON (no markdown, no explanation):
{
  "target_audience": "description",
  "budget": { "total": number, "currency": "RUB|USD|EUR" },
  "geo": ["city or region"],
  "channels": ["channel names if mentioned"],
  "goal": "campaign goal",
  "timing": { "start": "date or null", "end": "date or null" },
  "kpi": ["metrics if mentioned"],
  "unclear": ["list anything missing or unclear"]
}
`;

export const STAGE1_FORMAT = (summary: MediaBriefSummary) => `
📋 *Вот что я понял из брифа:*

👥 *ЦА:* ${summary.target_audience || "не указано"}
💰 *Бюджет:* ${Number.isFinite(summary.budget?.total) ? summary.budget.total : 0} ${summary.budget?.currency || "RUB"}
📍 *Гео:* ${summary.geo.length ? summary.geo.join(", ") : "не указано"}
📺 *Каналы:* ${summary.channels.length ? summary.channels.join(", ") : "не указаны"}
🎯 *Цель:* ${summary.goal || "не указано"}
📅 *Сроки:* ${summary.timing.start || "?"} — ${summary.timing.end || "?"}
📊 *KPI:* ${summary.kpi.length ? summary.kpi.join(", ") : "не указаны"}
${summary.unclear.length ? `\n⚠️ *Не хватает:* ${summary.unclear.join(", ")}` : ""}

Всё верно?
`;

export const STAGE2_SYSTEM = `
You are a senior media strategist at a top Russian advertising agency.
Given a validated media brief, create a complete media strategy.
Write in Russian. Be specific, professional, data-driven.
Use exact platform names (VK, MyTarget, Яндекс.Директ, YouTube, OLV, OOH, etc.)
Structure your response with these exact sections using markdown:

## Целевая аудитория
## Каналы и обоснование
## Бюджетное распределение
(include a markdown table: Канал | Бюджет | % от общего | Обоснование)
## Флайты и тайминг
## KPI и метрики
## Следующие шаги
`;

export const STAGE2_CORRECTION = (previousStrategy: string, correction: string) => `
Previous strategy:
${previousStrategy}

User correction: ${correction}

Apply the correction and return the updated full strategy. Keep all sections.
`;
