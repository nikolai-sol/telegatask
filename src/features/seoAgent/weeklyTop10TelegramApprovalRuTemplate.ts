import type { SeoOpportunityType } from "./types";

export type WeeklyTop10TelegramRuTemplate = {
  labels: {
    titlePrefix: string;
    intent: string;
    medicalReviewRequired: string;
    medicalReviewNotRequired: string;
    url: string;
    webmaster: string;
    serp: string;
    action: string;
    noUrl: string;
    unknown: string;
    approve: string;
    reject: string;
    open: string;
    convert: string;
  };
  actionText: {
    default: string;
    byOpportunityType: Partial<Record<SeoOpportunityType, string>>;
    facilityNavigational: string;
    medicalInformational: string;
  };
};

export const DEFAULT_WEEKLY_TOP10_TELEGRAM_RU_TEMPLATE: WeeklyTop10TelegramRuTemplate = {
  labels: {
    titlePrefix: "SEO-возможность",
    intent: "Интент",
    medicalReviewRequired: "медревью: требуется",
    medicalReviewNotRequired: "медревью: не требуется",
    url: "URL",
    webmaster: "Яндекс.Вебмастер",
    serp: "SERP",
    action: "Что сделать",
    noUrl: "URL не найден",
    unknown: "н/д",
    approve: "Одобрить",
    reject: "Отклонить",
    open: "Открыть",
    convert: "Convert",
  },
  actionText: {
    default: "Проверить страницу, уточнить соответствие запросу и добавить внутренние ссылки из релевантных материалов.",
    byOpportunityType: {
      content_optimization:
        "Уточнить соответствие страницы запросу: добавить недостающий блок/подзаголовки, усилить сниппет и перелинковку.",
      keyword_quick_win:
        "Доработать страницу под быстрый рост: усилить title/description, первый экран и внутренние ссылки.",
      internal_linking:
        "Добавить внутренние ссылки на целевую страницу из релевантных материалов и разделов.",
      content_gap:
        "Подготовить контентный блок или материал под кластер запросов с проверенными источниками.",
      technical_issue:
        "Проверить техническую причину просадки и зафиксировать конкретное исправление.",
      competitor_gap:
        "Сравнить покрытие конкурентов и усилить страницу недостающими сущностями и ответами.",
      section_ranking_gap:
        "Закрыть ranking gap раздела: выбрать или доработать целевую страницу, усилить интент, сниппет и внутренние ссылки.",
    },
    facilityNavigational:
      "Проверить карточку учреждения: адрес, заголовок, видимость в каталоге, сниппет и внутренние ссылки на карту.",
    medicalInformational:
      "Доработать медицинский материал под кластер запроса и отправить изменения на медицинское ревью перед публикацией.",
  },
};
