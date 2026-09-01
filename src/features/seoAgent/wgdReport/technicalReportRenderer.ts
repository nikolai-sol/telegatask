import type { WgdManagerNormalizedPayload } from "./managerPresentation";
import type { LighthouseEvidence, PageEvidence, WgdManagerPresentation } from "./types";
import { getReportLocalization, type WgdReportLocalization } from "./reportLocalization";
import {
  details,
  htmlText,
  relativeLink,
  safeDisplayUrl,
  safeRelativeReportPath,
  table,
} from "./reportHtml";

type TechnicalCopy = {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  headings: string;
  words: string;
  inboundLinks: string;
  images: string;
  imagesWithoutText: string;
  structuredData: string;
  pageMeasurements: string;
  lighthouseMeasurements: string;
  device: string;
  mobile: string;
  desktop: string;
  performance: string;
  accessibility: string;
  bestPractices: string;
  lighthouseSeo: string;
  completed: string;
  failed: string;
  status: string;
  metric: string;
  value: string;
  attemptedPages: string;
  eligiblePages: string;
  omittedPages: string;
  crawlLimited: string;
  discoveredUrls: string;
  excludedUrls: string;
  brokenUrls: string;
  redirects: string;
  duplicateTitles: string;
  duplicateDescriptions: string;
  robots: string;
  declaredSitemaps: string;
  sitemap: string;
  urls: string;
  yes: string;
  no: string;
  unavailable: string;
  failedAuditCount: string;
  manualQueries: string;
  redirectFrom: string;
  redirectTo: string;
  redirectPath: string;
};

const TECHNICAL_COPY: Record<WgdManagerPresentation["locale"], TechnicalCopy> = {
  ru: {
    title: "Заголовок страницы",
    description: "Описание страницы",
    canonical: "Канонический адрес",
    h1: "Основной заголовок H1",
    headings: "Заголовки H2-H6",
    words: "Слов на странице",
    inboundLinks: "Входящие внутренние ссылки",
    images: "Изображения",
    imagesWithoutText: "без текстового описания",
    structuredData: "Типы структурированных данных",
    pageMeasurements: "Лабораторные измерения страницы",
    lighthouseMeasurements: "Лабораторные измерения Lighthouse",
    device: "Устройство",
    mobile: "Мобильное устройство",
    desktop: "Компьютер",
    performance: "Производительность",
    accessibility: "Доступность",
    bestPractices: "Лучшие практики",
    lighthouseSeo: "Поисковая оптимизация",
    completed: "Данные получены",
    failed: "Проверка не выполнена",
    status: "Состояние",
    metric: "Показатель",
    value: "Значение",
    attemptedPages: "Проверенные адреса",
    eligiblePages: "Найденные адреса для проверки",
    omittedPages: "Адреса вне лимита",
    crawlLimited: "Обход ограничен",
    discoveredUrls: "Найденные адреса",
    excludedUrls: "Исключённые адреса",
    brokenUrls: "Недоступные внутренние адреса",
    redirects: "Цепочки перенаправлений",
    duplicateTitles: "Группы одинаковых заголовков",
    duplicateDescriptions: "Группы одинаковых описаний",
    robots: "Файл robots.txt",
    declaredSitemaps: "Карты сайта из robots.txt",
    sitemap: "Карта сайта",
    urls: "Адресов",
    yes: "Да",
    no: "Нет",
    unavailable: "Нет данных",
    failedAuditCount: "Отклонённые проверки Lighthouse",
    manualQueries: "Запросы для ручной проверки",
    redirectFrom: "Начальный адрес",
    redirectTo: "Конечный адрес",
    redirectPath: "Путь перенаправления",
  },
  en: {
    title: "Page title",
    description: "Page description",
    canonical: "Canonical address",
    h1: "Main H1 heading",
    headings: "H2-H6 headings",
    words: "Words on page",
    inboundLinks: "Inbound internal links",
    images: "Images",
    imagesWithoutText: "without text alternatives",
    structuredData: "Structured data types",
    pageMeasurements: "Page lab measurements",
    lighthouseMeasurements: "Lighthouse lab measurements",
    device: "Device",
    mobile: "Mobile",
    desktop: "Desktop",
    performance: "Performance",
    accessibility: "Accessibility",
    bestPractices: "Best practices",
    lighthouseSeo: "Search optimization",
    completed: "Data collected",
    failed: "Check not completed",
    status: "State",
    metric: "Metric",
    value: "Value",
    attemptedPages: "Checked addresses",
    eligiblePages: "Eligible discovered addresses",
    omittedPages: "Addresses outside the limit",
    crawlLimited: "Crawl limited",
    discoveredUrls: "Discovered addresses",
    excludedUrls: "Excluded addresses",
    brokenUrls: "Unavailable internal addresses",
    redirects: "Redirect chains",
    duplicateTitles: "Duplicate heading groups",
    duplicateDescriptions: "Duplicate description groups",
    robots: "robots.txt file",
    declaredSitemaps: "Sitemaps declared in robots.txt",
    sitemap: "Sitemap",
    urls: "Addresses",
    yes: "Yes",
    no: "No",
    unavailable: "No data",
    failedAuditCount: "Failed Lighthouse checks",
    manualQueries: "Queries for manual checking",
    redirectFrom: "Starting address",
    redirectTo: "Final address",
    redirectPath: "Redirect path",
  },
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function displayNumber(value: unknown, locale: WgdManagerPresentation["locale"]): string {
  if (!finite(value)) return TECHNICAL_COPY[locale].unavailable;
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 2,
  }).format(value).replace(/[\u00a0\u202f]/g, " ");
}

function displayList(values: readonly unknown[] | undefined, fallback: string): string {
  const items = (values || []).filter((value) => value !== undefined && value !== null && value !== "");
  return items.length ? items.join(" · ") : fallback;
}

function normalizedUrl(value: unknown): string | null {
  return safeDisplayUrl(value);
}

function sameUrl(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizedUrl(left);
  return Boolean(normalizedLeft && normalizedLeft === normalizedUrl(right));
}

function pageUrl(page: PageEvidence): string | null {
  return normalizedUrl(page.finalUrl) || normalizedUrl(page.requestedUrl);
}

function fact(label: string, value: unknown, fallback: string): string {
  const shown = value === undefined || value === null || value === "" ? fallback : value;
  return `<div><dt>${htmlText(label)}</dt><dd>${htmlText(shown)}</dd></div>`;
}

function headingCount(page: PageEvidence): number {
  return (["h2", "h3", "h4", "h5", "h6"] as const)
    .reduce((sum, level) => sum + (page.headings?.[level]?.length || 0), 0);
}

function isParsedHtmlPage(page: PageEvidence): boolean {
  const contentType = (page.contentType || "").trim();
  return !page.error
    && finite(page.status)
    && page.status > 0
    && (!contentType || /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType));
}

function displayUrlList(values: readonly unknown[] | undefined): string[] {
  return (values || []).map(safeDisplayUrl).filter((value): value is string => Boolean(value));
}

function fieldDataState(
  profile: LighthouseEvidence,
  copy: TechnicalCopy,
  localization: WgdReportLocalization
): string {
  const state = profile.fieldData?.state;
  return state && Object.prototype.hasOwnProperty.call(localization.lighthouseFieldDataStates, state)
    ? localization.lighthouseFieldDataStates[state]
    : copy.unavailable;
}

function lighthouseRows(
  profiles: readonly LighthouseEvidence[],
  copy: TechnicalCopy,
  locale: WgdManagerPresentation["locale"],
  localization: WgdReportLocalization,
  includeUrl = false
): unknown[][] {
  return profiles.map((profile) => {
    const values: unknown[] = [
    profile.device === "mobile" ? copy.mobile : copy.desktop,
    profile.status === "failed" ? copy.failed : copy.completed,
    fieldDataState(profile, copy, localization),
    displayNumber(profile.categoryScores?.performance, locale),
    displayNumber(profile.categoryScores?.accessibility, locale),
    displayNumber(profile.categoryScores?.["best-practices"], locale),
    displayNumber(profile.categoryScores?.seo, locale),
    displayNumber(profile.metrics?.largestContentfulPaintMs, locale),
    displayNumber(profile.metrics?.cumulativeLayoutShift, locale),
    displayNumber(profile.failedAudits?.length ?? 0, locale),
    ];
    return includeUrl
      ? [safeDisplayUrl(profile.finalUrl) || safeDisplayUrl(profile.requestedUrl) || safeDisplayUrl(profile.url) || copy.unavailable, ...values]
      : values;
  });
}

function lighthouseHeaders(
  presentation: WgdManagerPresentation,
  copy: TechnicalCopy,
  includeUrl = false
): string[] {
  const headers = [
    copy.device, copy.status, presentation.labels.cruxFieldData, copy.performance, copy.accessibility,
    copy.bestPractices, copy.lighthouseSeo, "LCP", "CLS", copy.failedAuditCount,
  ];
  return includeUrl ? [presentation.labels.page, ...headers] : headers;
}

function pageProblemList(page: WgdManagerPresentation["pages"][number], presentation: WgdManagerPresentation): string {
  if (!page.problems.length) return "";
  return `<h3>${htmlText(presentation.labels.confirmedProblems)}</h3><div class="page-problems">${page.problems
    .map((problem) => `<article class="page-problem"><h4>${htmlText(problem.title)}</h4><p><strong>${htmlText(presentation.labels.priority)}:</strong> ${htmlText(problem.priority)}</p><p><strong>${htmlText(presentation.labels.action)}:</strong> ${htmlText(problem.action)}</p></article>`)
    .join("")}</div>`;
}

function pageDetails(
  normalized: WgdManagerNormalizedPayload,
  presentation: WgdManagerPresentation
): string {
  const copy = TECHNICAL_COPY[presentation.locale];
  const localization = getReportLocalization(presentation.locale);
  const rawPages = normalized.pages || normalized.crawl?.pages || [];
  const profiles = normalized.lighthouse || [];
  const items = presentation.pages.map((page) => {
    const raw = rawPages.find((candidate) => sameUrl(page.url, pageUrl(candidate)));
    const pageProfiles = profiles.filter((profile) => sameUrl(
      page.url,
      safeDisplayUrl(profile.requestedUrl) || safeDisplayUrl(profile.url)
    ));
    const title = `${page.name} · ${page.scoreText} · ${page.indexability} · ${page.mainProblem}`;
    const coreFacts = `<dl class="technical-facts">
      ${fact(presentation.labels.page, safeDisplayUrl(page.url), copy.unavailable)}
      ${fact(presentation.labels.pageScore, page.scoreText, copy.unavailable)}
      ${fact(presentation.labels.indexability, page.indexability, copy.unavailable)}
      ${fact(presentation.labels.httpStatus, page.httpStatus, copy.unavailable)}
    </dl>`;
    const parsedFacts = raw && isParsedHtmlPage(raw) ? `<dl class="technical-facts">
      ${fact(copy.title, raw.title, copy.unavailable)}
      ${fact(copy.description, raw.description, copy.unavailable)}
      ${fact(copy.canonical, safeDisplayUrl(raw.canonical), copy.unavailable)}
      ${raw.headings ? fact(copy.h1, displayList(raw.headings.h1, copy.unavailable), copy.unavailable) : ""}
      ${raw.headings ? fact(copy.headings, displayNumber(headingCount(raw), presentation.locale), copy.unavailable) : ""}
      ${finite(raw.wordCount) ? fact(copy.words, displayNumber(raw.wordCount, presentation.locale), copy.unavailable) : ""}
      ${finite(raw.inboundInternalLinks) ? fact(copy.inboundLinks, displayNumber(raw.inboundInternalLinks, presentation.locale), copy.unavailable) : ""}
      ${raw.images ? fact(copy.images, `${displayNumber(raw.images.total, presentation.locale)} · ${displayNumber(raw.images.missingAlt, presentation.locale)} ${copy.imagesWithoutText}`, copy.unavailable) : ""}
      ${raw.schemaTypes ? fact(copy.structuredData, displayList(raw.schemaTypes, copy.unavailable), copy.unavailable) : ""}
    </dl>` : "";
    const measurements = raw && isParsedHtmlPage(raw) && pageProfiles.length ? `<h3>${htmlText(copy.pageMeasurements)}</h3>${table(
      lighthouseHeaders(presentation, copy),
      lighthouseRows(pageProfiles, copy, presentation.locale, localization),
      copy.unavailable
    )}<p class="note">${htmlText(presentation.lighthouse.note)}</p>` : "";
    return details(page.id, title, `${coreFacts}${parsedFacts}${pageProblemList(page, presentation)}${measurements}`, "page-detail");
  }).join("");
  return items;
}

function siteTechnicalDetails(
  normalized: WgdManagerNormalizedPayload,
  presentation: WgdManagerPresentation
): string {
  const copy = TECHNICAL_COPY[presentation.locale];
  const localization = getReportLocalization(presentation.locale);
  const crawl = normalized.crawl;
  const pages = normalized.pages || crawl?.pages || [];
  const rows: unknown[][] = [
    [copy.attemptedPages, displayNumber(crawl?.attemptedUrlCount ?? pages.length, presentation.locale)],
    [copy.eligiblePages, displayNumber(crawl?.eligibleDiscoveredCount, presentation.locale)],
    [copy.omittedPages, displayNumber(crawl?.droppedEligibleCount, presentation.locale)],
    [copy.crawlLimited, crawl ? (crawl.truncated ? copy.yes : copy.no) : copy.unavailable],
    [copy.discoveredUrls, displayNumber(crawl?.discoveredUrls?.length, presentation.locale)],
    [copy.excludedUrls, displayNumber(crawl?.excludedUrls?.length, presentation.locale)],
    [copy.brokenUrls, displayNumber(crawl?.brokenUrls?.length, presentation.locale)],
    [copy.redirects, displayNumber(crawl?.redirectChains?.length, presentation.locale)],
    [copy.duplicateTitles, displayNumber(Object.keys(crawl?.duplicateTitles || {}).length, presentation.locale)],
    [copy.duplicateDescriptions, displayNumber(Object.keys(crawl?.duplicateDescriptions || {}).length, presentation.locale)],
  ];
  const robots = crawl?.robots;
  const declaredSitemaps = displayUrlList(robots?.sitemapUrls);
  const robotsFacts = `<dl class="technical-facts">
    ${fact(copy.robots, safeDisplayUrl(robots?.url), copy.unavailable)}
    ${fact(presentation.labels.httpStatus, finite(robots?.status) ? displayNumber(robots?.status, presentation.locale) : copy.unavailable, copy.unavailable)}
    ${fact(copy.declaredSitemaps, declaredSitemaps.length ? declaredSitemaps.join(" · ") : copy.unavailable, copy.unavailable)}
  </dl>`;
  const sitemapRows = (crawl?.sitemapCandidates || []).flatMap((item) => {
    const url = safeDisplayUrl(item.url);
    return url ? [[
      url,
      finite(item.status) ? displayNumber(item.status, presentation.locale) : copy.unavailable,
      displayNumber(item.urls?.length, presentation.locale),
    ]] : [];
  });
  const brokenUrls = displayUrlList(crawl?.brokenUrls);
  const brokenEvidence = brokenUrls.length
    ? `<h3>${htmlText(copy.brokenUrls)}</h3><ul>${brokenUrls.map((url) => `<li>${htmlText(url)}</li>`).join("")}</ul>`
    : "";
  const redirectRows = (crawl?.redirectChains || []).flatMap((chain) => {
    const requested = safeDisplayUrl(chain.requestedUrl);
    const final = safeDisplayUrl(chain.finalUrl);
    const path = displayUrlList(chain.urls);
    return requested || final || path.length
      ? [[requested || copy.unavailable, final || copy.unavailable, path.length ? path.join(" → ") : copy.unavailable]]
      : [];
  });
  const redirectEvidence = redirectRows.length
    ? `<h3>${htmlText(copy.redirects)}</h3>${table(
      [copy.redirectFrom, copy.redirectTo, copy.redirectPath],
      redirectRows,
      copy.unavailable
    )}`
    : "";
  const lighthouse = normalized.lighthouse || [];
  const lighthouseEvidence = lighthouse.length
    ? `<h3>${htmlText(copy.lighthouseMeasurements)}</h3>${table(
      lighthouseHeaders(presentation, copy, true),
      lighthouseRows(lighthouse, copy, presentation.locale, localization, true),
      copy.unavailable
    )}<p class="note">${htmlText(presentation.lighthouse.note)}</p>`
    : "";
  const body = `${table([copy.metric, copy.value], rows, copy.unavailable)}${robotsFacts}${table(
    [copy.sitemap, presentation.labels.httpStatus, copy.urls],
    sitemapRows,
    copy.unavailable
  )}${brokenEvidence}${redirectEvidence}${lighthouseEvidence}`;
  return details("site-technical", presentation.headings.siteTechnical, body);
}

function methodologyDetails(presentation: WgdManagerPresentation): string {
  const methodology = presentation.methodology;
  const summary = `<ul>${methodology.summary.map((item) => `<li>${htmlText(item)}</li>`).join("")}</ul>`;
  const sources = table(
    [presentation.labels.source, presentation.labels.state],
    methodology.sources.map((item) => [item.source, item.state]),
    methodology.accessNote
  );
  const gaps = methodology.accessGaps.length
    ? `${table(
      [presentation.labels.source, presentation.labels.state],
      methodology.accessGaps.map((item) => [item.source, item.state]),
      methodology.accessNote
    )}<p class="note">${htmlText(methodology.accessNote)}</p>`
    : `<p class="note">${htmlText(methodology.accessNote)}</p>`;
  const limitations = methodology.limitations.length
    ? `<ul>${methodology.limitations.map((item) => `<li>${htmlText(item)}</li>`).join("")}</ul>`
    : "";
  return details("methodology", presentation.headings.methodology, `${summary}${sources}${gaps}${limitations}`);
}

function specialistDetails(
  normalized: WgdManagerNormalizedPayload,
  presentation: WgdManagerPresentation
): string {
  const copy = TECHNICAL_COPY[presentation.locale];
  const configured = presentation.specialist.links.map((item) => item.href);
  const lighthousePaths = (normalized.lighthouse || []).map((item) => item.rawPath);
  const paths = [...new Set([...configured, ...lighthousePaths]
    .map(safeRelativeReportPath)
    .filter((path): path is string => Boolean(path)))];
  const links = paths.length
    ? `<ul class="file-links">${paths.map((path) => `<li>${relativeLink(path)}</li>`).join("")}</ul>`
    : `<p class="empty">${htmlText(presentation.specialist.empty)}</p>`;
  const manualQueries = normalized.yandex?.manualQueries || [];
  const queryList = manualQueries.length
    ? `<h3>${htmlText(copy.manualQueries)}</h3><ul>${manualQueries.map((item) => `<li>${htmlText(item.query)}</li>`).join("")}</ul>`
    : "";
  return details(
    "specialist-data",
    presentation.headings.specialist,
    `<p>${htmlText(presentation.specialist.note)}</p>${links}${queryList}`
  );
}

export type RenderedTechnicalSections = {
  pageDetailsHtml: string;
  closedDetailsHtml: string;
};

/** Render normalized evidence only inside native details that are closed by default. */
export function renderTechnicalSections(
  normalized: WgdManagerNormalizedPayload,
  presentation: WgdManagerPresentation
): RenderedTechnicalSections {
  return {
    pageDetailsHtml: pageDetails(normalized, presentation),
    closedDetailsHtml: [
      siteTechnicalDetails(normalized, presentation),
      methodologyDetails(presentation),
      specialistDetails(normalized, presentation),
    ].join("\n"),
  };
}
