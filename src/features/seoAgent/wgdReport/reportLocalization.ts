import type {
  CoverageState,
  KeywordTopicAlignment,
  LighthouseFieldDataEvidence,
  RobotsAccessEvidence,
  WgdAssessmentState,
  WgdComponentId,
  WgdFindingDeliveryStage,
  WgdFindingSeverity,
  WgdKnownFindingCode,
  WgdManagerLabel,
  WgdMarket,
  WgdScoreStatus,
} from "./types";
import type { SeoRankProviderStatusState, SeoSourceStatusType } from "../types";
import type { YandexAiProbe } from "../production/zaruku/zarukuWgdRunnerHelpers";

export type { WgdManagerLabel } from "./types";

export type WgdReportLocale = "ru" | "en";

export type WgdManagerSourceState =
  | CoverageState
  | SeoSourceStatusType
  | SeoRankProviderStatusState
  | YandexAiProbe["status"]
  | LighthouseFieldDataEvidence["state"]
  | RobotsAccessEvidence["state"]
  | KeywordTopicAlignment["state"];

export type WgdLighthouseCategory = "performance" | "accessibility" | "best-practices" | "seo";
export type WgdPageIndexabilityState = "indexable" | "not_indexable" | "unknown";
export type WgdManagerHeading =
  | "report"
  | "overall"
  | "components"
  | "problems"
  | "yandex"
  | "alice"
  | "speed"
  | "priorities"
  | "pages"
  | "siteTechnical"
  | "methodology"
  | "specialist";
export type WgdManagerEmptyState =
  | "problems"
  | "yandex"
  | "alice"
  | "lighthouse"
  | "priorities"
  | "pages"
  | "accessGaps"
  | "diagnostics"
  | "specialistFiles";
export type WgdLighthouseDiagnostic =
  | "cache-insight"
  | "font-display-insight"
  | "image-delivery-insight"
  | "render-blocking-insight"
  | "uses-long-cache-ttl"
  | "font-display"
  | "render-blocking-resources"
  | "uses-optimized-images"
  | "uses-responsive-images"
  | "modern-image-formats"
  | "efficient-animated-content";
export type WgdKnownSourceId =
  | "crawl"
  | "crawler"
  | "lighthouse"
  | "yandex_search"
  | "alice_ai"
  | "yandex_webmaster"
  | "gsc"
  | "dataforseo";
export type WgdManagerLimitation =
  | "crawlTruncated"
  | "pageCollectionErrors"
  | "lighthouseIncomplete"
  | "yandexIncomplete"
  | "aliceIncomplete"
  | "sourcePartial"
  | "sourceUnavailable"
  | "ownerAccess"
  | "additional";

type FindingPresentation = { title: string; impact: string; action: string };
type StagePresentation = { title: string; result: string };

export type WgdReportLocalization = {
  locale: WgdReportLocale;
  localeTag: "ru-RU" | "en-US";
  headings: Record<WgdManagerHeading, string>;
  assessmentStates: Record<WgdAssessmentState, string>;
  scoreStatuses: Record<WgdScoreStatus, string>;
  severities: Record<WgdFindingSeverity, string>;
  deliveryStages: Record<WgdFindingDeliveryStage, StagePresentation>;
  findings: Record<WgdKnownFindingCode, FindingPresentation>;
  sourceStates: Record<WgdManagerSourceState, string>;
  sourceNames: Record<WgdKnownSourceId, string>;
  limitations: Record<WgdManagerLimitation, string>;
  lighthouseCategories: Record<WgdLighthouseCategory, string>;
  lighthouseFieldDataStates: Record<LighthouseFieldDataEvidence["state"], string>;
  lighthouseDiagnostics: Record<WgdLighthouseDiagnostic, string>;
  pageIndexability: Record<WgdPageIndexabilityState, string>;
  emptyStates: Record<WgdManagerEmptyState, string>;
  components: Record<WgdComponentId, { name: string; explanation: string }>;
  markets: Record<WgdMarket, string>;
  conclusions: {
    assessment: Record<WgdAssessmentState, string>;
    score: Record<WgdScoreStatus, string>;
  };
  labels: Record<WgdManagerLabel, string>;
  formatDate(value: string): string;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatScore(value: number | null): string;
  formatPercent(value: number): string;
  formatCollection(collected: number, requested: number): string;
  formatAffectedPages(count: number): string;
  formatYandexSummary(requested: number, checked: number, found: number, top10: number): string;
  formatAliceConclusion(used: number, checked: number): string;
  formatLimitation(
    kind: WgdManagerLimitation,
    values?: Partial<Record<"count" | "collected" | "requested" | "source", string | number>>
  ): string;
};

const RU_HEADINGS: Record<WgdManagerHeading, string> = {
  report: "SEO-аудит сайта",
  overall: "Общая оценка",
  components: "Составляющие оценки",
  problems: "Что мешает росту",
  yandex: "Позиции в Яндексе",
  alice: "Видимость в ответах Алисы",
  speed: "Скорость и удобство",
  priorities: "Что делать сначала",
  pages: "Подробнее по страницам",
  siteTechnical: "Технические данные сайта",
  methodology: "Методика и доступность данных",
  specialist: "Данные проверки для специалиста",
};

const EN_HEADINGS: Record<WgdManagerHeading, string> = {
  report: "Site SEO audit",
  overall: "Overall assessment",
  components: "Assessment components",
  problems: "What limits growth",
  yandex: "Yandex positions",
  alice: "Visibility in Alice answers",
  speed: "Speed and usability",
  priorities: "What to do first",
  pages: "Page details",
  siteTechnical: "Site technical data",
  methodology: "Method and data availability",
  specialist: "Audit data for specialists",
};

const RU_ASSESSMENT_STATES: Record<WgdAssessmentState, string> = {
  scored: "Оценка рассчитана",
  preliminary: "Предварительная оценка",
  insufficient_data: "Недостаточно данных",
};

const EN_ASSESSMENT_STATES: Record<WgdAssessmentState, string> = {
  scored: "Assessment calculated",
  preliminary: "Preliminary assessment",
  insufficient_data: "Insufficient data",
};

const RU_SCORE_STATUSES: Record<WgdScoreStatus, string> = {
  critical: "Критическое состояние",
  high_risk: "Высокий риск",
  needs_improvement: "Требуются улучшения",
  good: "Хорошее состояние",
};

const EN_SCORE_STATUSES: Record<WgdScoreStatus, string> = {
  critical: "Critical condition",
  high_risk: "High risk",
  needs_improvement: "Needs improvement",
  good: "Good condition",
};

const RU_SEVERITIES: Record<WgdFindingSeverity, string> = {
  critical: "критический",
  high: "высокий",
  medium: "средний",
  low: "низкий",
};

const EN_SEVERITIES: Record<WgdFindingSeverity, string> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

const RU_DELIVERY_STAGES: Record<WgdFindingDeliveryStage, StagePresentation> = {
  blocking: {
    title: "Устранить блокирующие проблемы",
    result: "Критические страницы доступны, а блокирующие ошибки устранены.",
  },
  visibility: {
    title: "Исправить проблемы, влияющие на видимость и посадочные страницы",
    result: "Посадочные страницы передают поисковой системе однозначные сигналы.",
  },
  improvement: {
    title: "Улучшить скорость, контент и дополнительные сигналы",
    result: "Повторная проверка подтверждает улучшение измеряемых показателей.",
  },
};

const EN_DELIVERY_STAGES: Record<WgdFindingDeliveryStage, StagePresentation> = {
  blocking: {
    title: "Remove blocking problems",
    result: "Critical pages are available and blocking errors are resolved.",
  },
  visibility: {
    title: "Fix problems affecting visibility and landing pages",
    result: "Landing pages send clear signals to the search engine.",
  },
  improvement: {
    title: "Improve speed, content, and additional signals",
    result: "A repeat check confirms better measured results.",
  },
};

const RU_FINDINGS: Record<WgdKnownFindingCode, FindingPresentation> = {
  homepage_noindex: {
    title: "Главная страница закрыта от индексации",
    impact: "Поисковая система не сможет добавить главную страницу в выдачу.",
    action: "Уберите запрет на индексацию с главной страницы и повторите проверку.",
  },
  indexability_signal_conflict: {
    title: "Сигналы индексирования противоречат друг другу",
    impact: "Поисковой системе сложнее определить, нужно ли показывать страницу в выдаче.",
    action: "Согласуйте правила индексации, канонический адрес и языковые версии, затем повторите обход.",
  },
  page_evidence_collection_failed: {
    title: "Данные страницы не получены",
    impact: "Состояние страницы нельзя подтвердить по этой проверке.",
    action: "Проверьте доступность страницы и запустите обход повторно.",
  },
  missing_sitemap: {
    title: "Карта сайта не найдена",
    impact: "Поисковой системе сложнее находить и обновлять адреса сайта.",
    action: "Опубликуйте корректную карту сайта XML и укажите её в robots.txt.",
  },
  broken_internal_links: {
    title: "Внутренние ссылки ведут на недоступные страницы",
    impact: "Посетители и поисковые роботы попадают на страницы с ошибкой.",
    action: "Исправьте или удалите неработающие внутренние ссылки.",
  },
  orphan_candidate: {
    title: "Страница не связана внутренними ссылками",
    impact: "Страницу сложнее найти посетителям и поисковым роботам.",
    action: "Добавьте уместную внутреннюю ссылку или исключите страницу из публикации.",
  },
  missing_h1: {
    title: "На странице нет основного заголовка",
    impact: "Структура и основная тема страницы выражены недостаточно ясно.",
    action: "Добавьте один содержательный заголовок H1.",
  },
  missing_canonical: {
    title: "На странице не указан канонический адрес",
    impact: "Поисковой системе сложнее выбрать основной адрес страницы.",
    action: "Укажите корректный канонический адрес и повторите обход.",
  },
  duplicate_titles: {
    title: "Несколько страниц используют одинаковый заголовок",
    impact: "Страницы хуже различаются в поисковой выдаче.",
    action: "Напишите отдельный заголовок для каждой целевой страницы.",
  },
  mobile_desktop_regression: {
    title: "Мобильная версия заметно медленнее компьютерной",
    impact: "Посетителям со смартфонов приходится дольше ждать загрузки.",
    action: "Проверьте мобильную загрузку и сократите самые тяжёлые операции.",
  },
  accessibility_audits_failed: {
    title: "Lighthouse выявил проблемы доступности",
    impact: "Части интерфейса могут быть неудобны для некоторых посетителей.",
    action: "Исправьте подтверждённые проверки доступности и проверьте интерфейс вручную.",
  },
  duplicate_descriptions: {
    title: "Несколько страниц используют одинаковое описание",
    impact: "Поисковой системе и посетителям сложнее различать назначение страниц.",
    action: "Подготовьте отдельное описание для каждой целевой страницы.",
  },
  generic_description: {
    title: "Описание страницы слишком общее",
    impact: "Описание слабо объясняет содержание страницы в поисковой выдаче.",
    action: "Уточните описание по фактическому содержанию страницы.",
  },
  keyword_topic_alignment_gap: {
    title: "Страница слабо отражает выбранную тему",
    impact: "Поисковой системе сложнее сопоставить страницу с выбранным запросом.",
    action: "Уточните заголовок страницы, описание и H1 по её содержанию.",
  },
  thin_content_heuristic: {
    title: "На странице мало содержательного текста",
    impact: "Страница может недостаточно полно отвечать на запрос посетителя.",
    action: "Добавьте полезные сведения, если они нужны для темы страницы.",
  },
  missing_image_alt: {
    title: "У части изображений нет текстового описания",
    impact: "Содержание изображений может быть недоступно части посетителей.",
    action: "Добавьте описание значимым изображениям. Декоративные изображения оставьте пустыми.",
  },
  alice_ai_not_used: {
    title: "Сайт не использован в проверенных ответах Алисы",
    impact: "В выбранной выборке сайт не был источником ответа.",
    action: "Проверьте полноту и ясность материалов по выбранным вопросам.",
  },
  crawl_truncated: {
    title: "Обход сайта завершён не полностью",
    impact: "Часть доступных страниц не вошла в проверку.",
    action: "Увеличьте лимит обхода и повторите проверку.",
  },
  owner_access_gap: {
    title: "Нет данных из кабинета владельца сайта",
    impact: "Отчёт не содержит официальную статистику показов и переходов.",
    action: "Предоставьте подтверждённый доступ, если эти данные нужны для анализа.",
  },
};

const EN_FINDINGS: Record<WgdKnownFindingCode, FindingPresentation> = {
  homepage_noindex: {
    title: "The home page is blocked from indexing",
    impact: "The search engine cannot add the home page to its results.",
    action: "Remove the noindex directive from the home page and run the check again.",
  },
  indexability_signal_conflict: {
    title: "Indexing signals conflict",
    impact: "The search engine cannot clearly determine whether to show the page.",
    action: "Make robots, canonical, and hreflang signals consistent, then crawl the site again.",
  },
  page_evidence_collection_failed: {
    title: "Page data was not collected",
    impact: "This check cannot confirm the page condition.",
    action: "Check that the page is available and crawl it again.",
  },
  missing_sitemap: {
    title: "No sitemap was found",
    impact: "The search engine has less guidance for finding and refreshing site URLs.",
    action: "Publish a valid XML sitemap and reference it in robots.txt.",
  },
  broken_internal_links: {
    title: "Internal links lead to unavailable pages",
    impact: "Visitors and search crawlers reach error pages.",
    action: "Fix or remove the broken internal links.",
  },
  orphan_candidate: {
    title: "A page has no internal links pointing to it",
    impact: "Visitors and search crawlers may have difficulty finding the page.",
    action: "Add a relevant internal link or remove the page from publication.",
  },
  missing_h1: {
    title: "A page has no main heading",
    impact: "The page structure and main topic are less clear.",
    action: "Add one descriptive H1 heading.",
  },
  missing_canonical: {
    title: "A page has no canonical URL",
    impact: "The search engine has less guidance when choosing the primary page URL.",
    action: "Add the correct canonical URL and crawl the page again.",
  },
  duplicate_titles: {
    title: "Several pages use the same title",
    impact: "The pages are harder to distinguish in search results.",
    action: "Write a distinct title for each target page.",
  },
  mobile_desktop_regression: {
    title: "The mobile page is much slower than the desktop page",
    impact: "Visitors on phones wait longer for the page to load.",
    action: "Review mobile loading and reduce the heaviest operations.",
  },
  accessibility_audits_failed: {
    title: "Lighthouse found accessibility problems",
    impact: "Parts of the interface may be difficult for some visitors to use.",
    action: "Fix the confirmed accessibility checks and test the interface manually.",
  },
  duplicate_descriptions: {
    title: "Several pages use the same description",
    impact: "The search engine and visitors have less information for distinguishing the pages.",
    action: "Write a distinct description for each target page.",
  },
  generic_description: {
    title: "The page description is too general",
    impact: "The description does not explain the page well in search results.",
    action: "Make the description specific to the page content.",
  },
  keyword_topic_alignment_gap: {
    title: "The page does not clearly cover the selected topic",
    impact: "The search engine has less evidence for matching the page to the selected query.",
    action: "Make the title, description, and H1 consistent with the page content.",
  },
  thin_content_heuristic: {
    title: "The page has little substantive text",
    impact: "The page may not fully answer the visitor's question.",
    action: "Add useful information when the page topic requires it.",
  },
  missing_image_alt: {
    title: "Some images have no text alternative",
    impact: "Some visitors may not be able to understand the images.",
    action: "Describe meaningful images and keep decorative image alternatives empty.",
  },
  alice_ai_not_used: {
    title: "The site was not used in the checked Alice answers",
    impact: "The site was not an answer source in the selected sample.",
    action: "Review whether the content answers the selected questions clearly and fully.",
  },
  crawl_truncated: {
    title: "The site crawl was incomplete",
    impact: "Some available pages were not checked.",
    action: "Increase the crawl limit and run the check again.",
  },
  owner_access_gap: {
    title: "Owner console data is unavailable",
    impact: "The report does not include official impression and click data.",
    action: "Provide verified access if this data is needed for the analysis.",
  },
};

const RU_SOURCE_STATES: Record<WgdManagerSourceState, string> = {
  success: "Данные получены",
  partial: "Получены частично",
  unavailable: "Недоступно при этой проверке",
  not_applicable: "Не используется для этого рынка",
  owner_access_required: "Нужен доступ владельца сайта",
  failed: "Проверка не выполнена",
  skipped: "Проверка пропущена",
  connected: "Источник подключён, данные получены",
  not_collected: "Данные не собирались",
  measured: "Измерено",
  not_measured: "Не измерено",
  no_keywords: "Запросы не заданы",
  missing_credentials: "Источник не подключён",
  provider_error: "Источник временно недоступен",
  limit_exceeded: "Лимит источника исчерпан",
  partial_success: "Получены частично",
  checked: "Запрос проверен",
  not_configured: "Источник не настроен",
  permission_denied: "Недостаточно прав доступа",
};

const EN_SOURCE_STATES: Record<WgdManagerSourceState, string> = {
  success: "Data collected",
  partial: "Partly collected",
  unavailable: "Unavailable in this check",
  not_applicable: "Not used for this market",
  owner_access_required: "Site owner access required",
  failed: "Check not completed",
  skipped: "Check skipped",
  connected: "Source connected and data collected",
  not_collected: "Data not collected",
  measured: "Measured",
  not_measured: "Not measured",
  no_keywords: "No queries provided",
  missing_credentials: "Source not connected",
  provider_error: "Source temporarily unavailable",
  limit_exceeded: "Source limit reached",
  partial_success: "Partly collected",
  checked: "Query checked",
  not_configured: "Source not configured",
  permission_denied: "Access permission missing",
};

const RU_SOURCE_NAMES: Record<WgdKnownSourceId, string> = {
  crawl: "Обход сайта",
  crawler: "Обход сайта",
  lighthouse: "Lighthouse",
  yandex_search: "Поиск Яндекса",
  alice_ai: "Ответы Алисы",
  yandex_webmaster: "Яндекс.Вебмастер",
  gsc: "Google Search Console",
  dataforseo: "DataForSEO",
};

const EN_SOURCE_NAMES: Record<WgdKnownSourceId, string> = {
  crawl: "Site crawl",
  crawler: "Site crawl",
  lighthouse: "Lighthouse",
  yandex_search: "Yandex Search",
  alice_ai: "Alice answers",
  yandex_webmaster: "Yandex Webmaster",
  gsc: "Google Search Console",
  dataforseo: "DataForSEO",
};

const RU_LIMITATIONS: Record<WgdManagerLimitation, string> = {
  crawlTruncated: "Обход ограничен. Найденные страницы вне проверки: {count}.",
  pageCollectionErrors: "Страницы с ошибкой сбора данных: {count}.",
  lighthouseIncomplete: "Полные пары проверок Lighthouse: {collected} из {requested}.",
  yandexIncomplete: "Проверенные запросы в Яндексе: {collected} из {requested}.",
  aliceIncomplete: "Проверенные ответы Алисы: {collected} из {requested}.",
  sourcePartial: "{source}: данные получены частично.",
  sourceUnavailable: "{source}: данные недоступны при этой проверке.",
  ownerAccess: "Часть данных кабинетов владельца недоступна без подтверждённого доступа.",
  additional: "В исходных данных отмечены дополнительные ограничения сбора.",
};

const EN_LIMITATIONS: Record<WgdManagerLimitation, string> = {
  crawlTruncated: "The crawl was limited. Pages left outside the check: {count}.",
  pageCollectionErrors: "Page data could not be collected for {count} pages.",
  lighthouseIncomplete: "Lighthouse: {collected} of {requested} complete test pairs were collected.",
  yandexIncomplete: "Yandex: {collected} of {requested} queries were checked.",
  aliceIncomplete: "Alice: {collected} of {requested} answers were checked.",
  sourcePartial: "{source}: data was collected in part.",
  sourceUnavailable: "{source}: data was unavailable in this check.",
  ownerAccess: "Some owner console data is unavailable without verified access.",
  additional: "The source data records additional collection limitations.",
};

const RU_CATEGORIES: Record<WgdLighthouseCategory, string> = {
  performance: "Производительность",
  accessibility: "Доступность",
  "best-practices": "Лучшие практики",
  seo: "Поисковая оптимизация",
};

const EN_CATEGORIES: Record<WgdLighthouseCategory, string> = {
  performance: "Performance",
  accessibility: "Accessibility",
  "best-practices": "Best practices",
  seo: "SEO",
};

const RU_LIGHTHOUSE_FIELD_DATA_STATES: Record<LighthouseFieldDataEvidence["state"], string> = {
  not_collected: "Данные не собирались",
  unavailable: "Недоступны при этой проверке",
};

const EN_LIGHTHOUSE_FIELD_DATA_STATES: Record<LighthouseFieldDataEvidence["state"], string> = {
  not_collected: "Data not collected",
  unavailable: "Unavailable in this check",
};

const RU_DIAGNOSTICS: Record<WgdLighthouseDiagnostic, string> = {
  "cache-insight": "Увеличить срок хранения файлов в браузере",
  "font-display-insight": "Настроить отображение шрифтов во время загрузки",
  "image-delivery-insight": "Оптимизировать загрузку изображений",
  "render-blocking-insight": "Сократить ресурсы, задерживающие первый показ страницы",
  "uses-long-cache-ttl": "Увеличить срок хранения статических файлов",
  "font-display": "Настроить быстрое отображение веб-шрифтов",
  "render-blocking-resources": "Сократить ресурсы, блокирующие отображение страницы",
  "uses-optimized-images": "Оптимизировать файлы изображений",
  "uses-responsive-images": "Подбирать размер изображений под экран",
  "modern-image-formats": "Использовать современные форматы изображений",
  "efficient-animated-content": "Уменьшить размер анимированных материалов",
};

const EN_DIAGNOSTICS: Record<WgdLighthouseDiagnostic, string> = {
  "cache-insight": "Increase browser cache lifetimes",
  "font-display-insight": "Configure font display during loading",
  "image-delivery-insight": "Optimize image delivery",
  "render-blocking-insight": "Reduce resources that delay the first page display",
  "uses-long-cache-ttl": "Increase static file cache lifetimes",
  "font-display": "Configure fast web font display",
  "render-blocking-resources": "Reduce resources that block page display",
  "uses-optimized-images": "Optimize image files",
  "uses-responsive-images": "Serve images sized for the screen",
  "modern-image-formats": "Use modern image formats",
  "efficient-animated-content": "Reduce the size of animated content",
};

const RU_PAGE_STATES: Record<WgdPageIndexabilityState, string> = {
  indexable: "Доступна для индексации",
  not_indexable: "Недоступна для индексации",
  unknown: "Индексируемость не определена",
};

const EN_PAGE_STATES: Record<WgdPageIndexabilityState, string> = {
  indexable: "Available for indexing",
  not_indexable: "Unavailable for indexing",
  unknown: "Indexability not determined",
};

const RU_EMPTY: Record<WgdManagerEmptyState, string> = {
  problems: "Подтверждённых проблем для этого раздела нет.",
  yandex: "Запросы для проверки позиций не заданы.",
  alice: "Запросы для проверки ответов Алисы не заданы.",
  lighthouse: "Данные Lighthouse не получены.",
  priorities: "Подтверждённых этапов работ нет.",
  pages: "Проверенные страницы не найдены.",
  accessGaps: "Дополнительный доступ владельца не требуется.",
  diagnostics: "Подтверждённые факторы замедления не найдены.",
  specialistFiles: "Ссылки на исходные данные не добавлены.",
};

const EN_EMPTY: Record<WgdManagerEmptyState, string> = {
  problems: "No confirmed problems are available for this section.",
  yandex: "No position queries were provided.",
  alice: "No Alice answer queries were provided.",
  lighthouse: "No Lighthouse data was collected.",
  priorities: "No confirmed work stages are available.",
  pages: "No checked pages were found.",
  accessGaps: "No additional site owner access is required.",
  diagnostics: "No confirmed loading factors were found.",
  specialistFiles: "No source data links were added.",
};

const RU_COMPONENTS: WgdReportLocalization["components"] = {
  technical: {
    name: "Техническое SEO и индексируемость",
    explanation: "Доступность страниц, сигналы индексирования и внутренняя структура.",
  },
  yandex: {
    name: "Позиции в Яндексе",
    explanation: "Место сайта по выбранным запросам в проверенной части выдачи.",
  },
  lighthouse: {
    name: "Скорость и удобство",
    explanation: "Лабораторные показатели загрузки, доступности и качества страниц.",
  },
  alice: {
    name: "Видимость в ответах Алисы",
    explanation: "Доля проверенных ответов, где сайт использован как источник.",
  },
};

const EN_COMPONENTS: WgdReportLocalization["components"] = {
  technical: {
    name: "Technical SEO and indexability",
    explanation: "Page availability, indexing signals, and internal structure.",
  },
  yandex: {
    name: "Yandex positions",
    explanation: "Site positions for selected queries within the checked results.",
  },
  lighthouse: {
    name: "Speed and usability",
    explanation: "Lab measurements of loading, accessibility, and page quality.",
  },
  alice: {
    name: "Visibility in Alice answers",
    explanation: "Share of checked answers that used the site as a source.",
  },
};

const RU_MARKETS: Record<WgdMarket, string> = { RU: "Россия", AT: "Австрия", DE: "Германия", OTHER: "Другой рынок" };
const EN_MARKETS: Record<WgdMarket, string> = { RU: "Russia", AT: "Austria", DE: "Germany", OTHER: "Other market" };

const RU_CONCLUSIONS: WgdReportLocalization["conclusions"] = {
  assessment: {
    scored: "Оценка рассчитана по достаточному объёму данных.",
    preliminary: "Часть данных не вошла в расчёт, поэтому оценка предварительная.",
    insufficient_data: "Данных пока недостаточно для общей оценки.",
  },
  score: {
    critical: "Подтверждённые ошибки требуют срочного исправления.",
    high_risk: "Сайт теряет видимость из-за подтверждённых проблем.",
    needs_improvement: "Основные данные собраны, но видимость и качество страниц можно улучшить.",
    good: "По собранным данным сайт находится в хорошем состоянии.",
  },
};

const EN_CONCLUSIONS: WgdReportLocalization["conclusions"] = {
  assessment: {
    scored: "The assessment uses a sufficient amount of collected data.",
    preliminary: "Some data was excluded, so the assessment is preliminary.",
    insufficient_data: "There is not enough data for an overall assessment.",
  },
  score: {
    critical: "Confirmed errors require urgent correction.",
    high_risk: "Confirmed problems are limiting search visibility.",
    needs_improvement: "The main data is available, but visibility and page quality can improve.",
    good: "The collected data shows the site is in good condition.",
  },
};

type LocalizationStatic = Omit<WgdReportLocalization,
  "formatDate" | "formatNumber" | "formatScore" | "formatPercent" | "formatCollection"
  | "formatAffectedPages" | "formatYandexSummary" | "formatAliceConclusion" | "formatLimitation">;

function withFormatters(copy: LocalizationStatic): WgdReportLocalization {
  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(copy.localeTag, options).format(value);
  return {
    ...copy,
    formatDate(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return copy.labels.noData;
      return new Intl.DateTimeFormat(copy.localeTag, {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
      }).format(date);
    },
    formatNumber,
    formatScore(value) {
      return value === null ? copy.labels.noData : `${formatNumber(value)} / 100`;
    },
    formatPercent(value) {
      return new Intl.NumberFormat(copy.localeTag, {
        style: "percent", maximumFractionDigits: 0,
      }).format(Math.max(0, Math.min(1, value)));
    },
    formatCollection(collected, requested) {
      return copy.locale === "ru"
        ? `${formatNumber(collected)} из ${formatNumber(requested)}`
        : `${formatNumber(collected)} of ${formatNumber(requested)}`;
    },
    formatAffectedPages(count) {
      if (copy.locale === "en") return `${formatNumber(count)} ${count === 1 ? "page is" : "pages are"} affected`;
      const mod10 = count % 10;
      const mod100 = count % 100;
      const noun = mod10 === 1 && mod100 !== 11
        ? "страница"
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
          ? "страницы"
          : "страниц";
      const verb = noun === "страница" ? "Затронута" : "Затронуты";
      return `${verb} ${formatNumber(count)} ${noun}`;
    },
    formatYandexSummary(requested, checked, found, top10) {
      return copy.locale === "ru"
        ? `Проверенные запросы: ${formatNumber(checked)} из ${formatNumber(requested)}. Сайт найден: ${formatNumber(found)}. В топ-10: ${formatNumber(top10)}.`
        : `Queries checked: ${formatNumber(checked)} of ${formatNumber(requested)}. Site found: ${formatNumber(found)}. Top 10: ${formatNumber(top10)}.`;
    },
    formatAliceConclusion(used, checked) {
      if (checked === 0) return copy.locale === "ru"
        ? "Нет успешно проверенных ответов."
        : "No answers were checked successfully.";
      return copy.locale === "ru"
        ? `Сайт использован как источник в ${formatNumber(used)} из ${formatNumber(checked)} проверенных ответов.`
        : `The site was used as a source in ${formatNumber(used)} of ${formatNumber(checked)} checked answers.`;
    },
    formatLimitation(kind, values = {}) {
      return Object.entries(values).reduce((text, [key, value]) => {
        const formatted = typeof value === "number" ? formatNumber(value) : value;
        return text.split(`{${key}}`).join(formatted);
      }, copy.limitations[kind]);
    },
  };
}

const RU = withFormatters({
  locale: "ru",
  localeTag: "ru-RU",
  headings: RU_HEADINGS,
  assessmentStates: RU_ASSESSMENT_STATES,
  scoreStatuses: RU_SCORE_STATUSES,
  severities: RU_SEVERITIES,
  deliveryStages: RU_DELIVERY_STAGES,
  findings: RU_FINDINGS,
  sourceStates: RU_SOURCE_STATES,
  sourceNames: RU_SOURCE_NAMES,
  limitations: RU_LIMITATIONS,
  lighthouseCategories: RU_CATEGORIES,
  lighthouseFieldDataStates: RU_LIGHTHOUSE_FIELD_DATA_STATES,
  lighthouseDiagnostics: RU_DIAGNOSTICS,
  pageIndexability: RU_PAGE_STATES,
  emptyStates: RU_EMPTY,
  components: RU_COMPONENTS,
  markets: RU_MARKETS,
  conclusions: RU_CONCLUSIONS,
  labels: {
    noData: "Нет данных",
    notScored: "Без отдельной оценки",
    searchEngine: "Яндекс",
    completeness: "Полнота данных",
    siteLevelProblem: "Проблема уровня сайта",
    siteFound: "Сайт найден",
    notFoundFirst20: "Не найден среди первых 20 результатов",
    incompleteFirst20: "Проверены не все первые 20 результатов",
    depthUnavailable: "Глубина проверки не подтверждена",
    invalidYandexObservation: "Результат проверки не подтверждён",
    checkFailed: "Проверка не выполнена",
    pageNotProvided: "Страница не определена",
    aliceUsed: "Сайт использован как источник",
    aliceNotUsed: "Сайт не использован как источник",
    aliceNote: "Проверка выполнена по выбранным запросам. Это не официальная статистика Яндекс.Вебмастера.",
    lighthouseNote: "Lighthouse моделирует загрузку в лабораторных условиях и не заменяет данные реальных посетителей.",
    lighthouseRoundingNote: "Средние значения при показе могут быть округлены.",
    methodologyData: "В отчёт вошли данные обхода сайта, позиции в Яндексе, проверки Lighthouse и выбранные запросы к Алисе.",
    methodologyScoring: "Оценки рассчитаны только по измеренным показателям с видимой полнотой данных.",
    ownerAccessNote: "Отсутствие доступа к Яндекс.Вебмастеру или Google Search Console не снижает оценку сайта.",
    specialistNote: "Исходные данные и подробный JSON сохранены для технической проверки.",
    noMainProblem: "Основная подтверждённая проблема не найдена",
    query: "Запрос",
    position: "Позиция",
    page: "Страница",
    result: "Результат",
    priority: "Приоритет",
    affected: "Затронутые страницы",
    impact: "Почему это важно",
    action: "Что сделать",
    componentScore: "Оценка составляющей",
    collection: "Собрано данных",
    coverage: "Полнота",
    mobileAverage: "Средняя оценка на мобильных устройствах",
    desktopAverage: "Средняя оценка на компьютерах",
    worstMobilePage: "Страница с самой низкой мобильной оценкой",
    scoreInputs: "Показатели, входящие в оценку",
    supplementaryResults: "Дополнительные результаты Lighthouse",
    weight: "Вес в оценке",
    pageScore: "Оценка страницы",
    indexability: "Индексируемость",
    mainProblem: "Основная проблема",
    httpStatus: "Статус HTTP",
    mobilePerformance: "Производительность на мобильных устройствах",
    desktopPerformance: "Производительность на компьютерах",
    source: "Источник",
    state: "Состояние",
    diagnostics: "Факторы замедления",
    requestedQueries: "Заданные запросы",
    checkedQueries: "Проверенные запросы",
    foundQueries: "Запросы, по которым сайт найден",
    top10Queries: "Запросы в топ-10",
    usedAnswers: "Ответы, где сайт использован как источник",
    cruxFieldData: "Данные CrUX",
    confirmedProblems: "Подтверждённые проблемы и рекомендации",
    excludedFromSpeedScore: "Не входит в оценку скорости и удобства",
  },
});

const EN = withFormatters({
  locale: "en",
  localeTag: "en-US",
  headings: EN_HEADINGS,
  assessmentStates: EN_ASSESSMENT_STATES,
  scoreStatuses: EN_SCORE_STATUSES,
  severities: EN_SEVERITIES,
  deliveryStages: EN_DELIVERY_STAGES,
  findings: EN_FINDINGS,
  sourceStates: EN_SOURCE_STATES,
  sourceNames: EN_SOURCE_NAMES,
  limitations: EN_LIMITATIONS,
  lighthouseCategories: EN_CATEGORIES,
  lighthouseFieldDataStates: EN_LIGHTHOUSE_FIELD_DATA_STATES,
  lighthouseDiagnostics: EN_DIAGNOSTICS,
  pageIndexability: EN_PAGE_STATES,
  emptyStates: EN_EMPTY,
  components: EN_COMPONENTS,
  markets: EN_MARKETS,
  conclusions: EN_CONCLUSIONS,
  labels: {
    noData: "No data",
    notScored: "No separate score",
    searchEngine: "Yandex",
    completeness: "Data completeness",
    siteLevelProblem: "Site-wide problem",
    siteFound: "Site found",
    notFoundFirst20: "Not found in the first 20 results",
    incompleteFirst20: "Not all of the first 20 results were checked",
    depthUnavailable: "The checked depth is unavailable",
    invalidYandexObservation: "The check result could not be confirmed",
    checkFailed: "Check not completed",
    pageNotProvided: "Page not determined",
    aliceUsed: "Site used as a source",
    aliceNotUsed: "Site not used as a source",
    aliceNote: "The check covers selected queries. It is not official Yandex Webmaster statistics.",
    lighthouseNote: "Lighthouse models page loading in lab conditions and does not replace real visitor data.",
    lighthouseRoundingNote: "Displayed averages may be rounded.",
    methodologyData: "The report uses site crawl data, Yandex positions, Lighthouse checks, and selected Alice queries.",
    methodologyScoring: "Scores use measured indicators only and show data completeness.",
    ownerAccessNote: "Missing access to Yandex Webmaster or Google Search Console does not reduce the site score.",
    specialistNote: "Source data and the detailed JSON are retained for technical review.",
    noMainProblem: "No confirmed main problem was selected",
    query: "Query",
    position: "Position",
    page: "Page",
    result: "Result",
    priority: "Priority",
    affected: "Affected pages",
    impact: "Why it matters",
    action: "What to do",
    componentScore: "Component score",
    collection: "Data collected",
    coverage: "Coverage",
    mobileAverage: "Average mobile score",
    desktopAverage: "Average desktop score",
    worstMobilePage: "Page with the lowest mobile score",
    scoreInputs: "Inputs included in the score",
    supplementaryResults: "Supplementary Lighthouse results",
    weight: "Score weight",
    pageScore: "Page score",
    indexability: "Indexability",
    mainProblem: "Main problem",
    httpStatus: "HTTP status",
    mobilePerformance: "Mobile performance",
    desktopPerformance: "Desktop performance",
    source: "Source",
    state: "State",
    diagnostics: "Loading factors",
    requestedQueries: "Requested queries",
    checkedQueries: "Checked queries",
    foundQueries: "Queries where the site was found",
    top10Queries: "Top 10 queries",
    usedAnswers: "Answers that used the site as a source",
    cruxFieldData: "CrUX data",
    confirmedProblems: "Confirmed problems and recommendations",
    excludedFromSpeedScore: "Excluded from the speed and usability score",
  },
});

export function resolveReportLocale(language: string | undefined): WgdReportLocale {
  return /^ru(?:-|$)/i.test((language || "").trim()) ? "ru" : "en";
}

export function getReportLocalization(language: string | undefined): WgdReportLocalization {
  return resolveReportLocale(language) === "ru" ? RU : EN;
}
