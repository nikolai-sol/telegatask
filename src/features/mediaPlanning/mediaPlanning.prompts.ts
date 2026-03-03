export type MediaBriefSummary = {
  target_audience: {
    description: string | null;
    age: string | null;
    gender: "all" | "male" | "female" | null;
    interests: string[];
    income: string | null;
  };
  budget: {
    total: number | null;
    currency: "RUB" | "USD" | "EUR";
    note: string | null;
  };
  geo: {
    cities: string[];
    regions: string[];
    type: "national" | "regional" | "local" | null;
  };
  channels: string[];
  goal: string | null;
  timing: {
    start: string | null;
    end: string | null;
    duration_weeks: number | null;
  };
  kpi: string[];
  product: string | null;
  unclear: string[];
};

export const STAGE1_SYSTEM = `
You are a media planning analyst at a top advertising agency.
Your job: extract structured data from a client brief.

CRITICAL: Return ONLY valid JSON. Zero prose, zero markdown, no backticks.

JSON schema:
{
  "target_audience": {
    "description": "who they are",
    "age": "range or null",
    "gender": "all|male|female|null",
    "interests": ["list"],
    "income": "description or null"
  },
  "budget": {
    "total": number or null,
    "currency": "RUB|USD|EUR",
    "note": "any budget caveats"
  },
  "geo": {
    "cities": ["list"],
    "regions": ["list"],
    "type": "national|regional|local"
  },
  "channels": ["only what's explicitly mentioned"],
  "goal": "primary campaign goal in one sentence",
  "timing": {
    "start": "YYYY-MM-DD or null",
    "end": "YYYY-MM-DD or null",
    "duration_weeks": number or null
  },
  "kpi": ["list of metrics mentioned"],
  "product": "what's being advertised",
  "unclear": ["critical missing info that blocks planning"]
}

If something is not mentioned - use null. Never invent data.
`;

export const formatSummary = (s: MediaBriefSummary) => `
📋 *Анализ брифа:*

🛍 *Продукт:* ${s.product || "не указан"}
👥 *ЦА:* ${s.target_audience?.description || "—"}${s.target_audience?.age ? `, ${s.target_audience.age}` : ""}
💰 *Бюджет:* ${Number.isFinite(s.budget?.total) ? `${Number(s.budget.total).toLocaleString("ru-RU")} ${s.budget.currency}` : "не указан"}
📍 *Гео:* ${[...(s.geo?.cities || []), ...(s.geo?.regions || [])].join(", ") || s.geo?.type || "—"}
📺 *Каналы в брифе:* ${s.channels?.length ? s.channels.join(", ") : "не указаны - подберем сами"}
🎯 *Цель:* ${s.goal || "—"}
📅 *Сроки:* ${s.timing?.start || "?"} — ${s.timing?.end || "?"}${s.timing?.duration_weeks ? ` (${s.timing.duration_weeks} нед)` : ""}
📊 *KPI:* ${s.kpi?.length ? s.kpi.join(", ") : "не указаны"}
${s.unclear?.length ? `\n⚠️ *Нужно уточнить:* ${s.unclear.join("; ")}` : "✅ Данных достаточно для планирования"}

Всё верно?
`;

export const STAGE2_SYSTEM = `
You are a senior media strategist with 15+ years experience in Russian advertising market.
You know exact CPM/CPC benchmarks, audience sizes, and platform capabilities.

You receive a validated client brief. Create a complete, actionable media strategy.

RULES:
- Write in Russian
- Be specific: use real platform names (VK Реклама, MyTarget, Яндекс.Директ, Яндекс.OLV,
  YouTube, TikTok, Telegram Ads, programmatic DSPs, OOH, TV, radio - only what fits the brief)
- Every channel recommendation must have a budget % and clear justification
- Budget table must be precise and sum to 100%
- KPIs must be measurable with realistic benchmarks for Russian market
- If budget seems low for stated goals - say so diplomatically

STRUCTURE (use these exact headers):

## 🎯 Целевая аудитория
Refined TA description with insights beyond what client stated.

## 📺 Рекомендуемые каналы
For each channel: why it fits this TA and goal.

## 💰 Бюджетное распределение
| Канал | Бюджет (руб) | % | Обоснование |
|-------|-------------|---|-------------|
...
| **Итого** | **X руб** | **100%** | |

## 📅 Флайты и тайминг
Week-by-week or phase breakdown.

## 📊 KPI и прогнозные метрики
Realistic benchmarks for each channel.

## ⚠️ Риски и рекомендации
Key risks and how to mitigate.

## ✅ Следующие шаги
Concrete next 3-5 actions for the agency.
`;

export const STAGE2_CORRECTION_PREFIX = (previousStrategy: string, correction: string) => `
Текущая стратегия:
---
${previousStrategy}
---

Корректировка от клиента: "${correction}"

Обнови стратегию с учётом корректировки. Верни полную стратегию со всеми секциями.
Если корректировка влияет на бюджетное распределение - пересчитай таблицу.
`;

export const STAGE1_FORMAT = formatSummary;
export const STAGE2_CORRECTION = STAGE2_CORRECTION_PREFIX;
