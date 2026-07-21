import { describe, expect, test } from "vitest";
import {
  DEFAULT_PAGE_INVENTORY_COVERAGE_CONFIG,
  resolvePageInventoryCoverage,
  type SeoPageInventoryItem,
} from "./pageInventoryCoverageResolver";

const inventory: SeoPageInventoryItem[] = [
  {
    url: "https://zaruku.ru/map/moskva/organization_1425/",
    title: "Онкологический центр в Сколково",
    h1: "Онкологический центр в Сколково",
  },
  {
    url: "https://zaruku.ru/map/sankt_peterburg/organization_959/",
    title: "ЦАОП Пушкинского района СПб",
    h1: "ЦАОП Пушкинского района",
  },
  {
    url: "https://zaruku.ru/kompleksnoe_genomnoe_profilirovanie/",
    title: "Комплексное геномное профилирование",
    h1: "Комплексное геномное профилирование опухоли",
  },
  {
    url: "https://zaruku.ru/vnimatelney_k_sebe/",
    title: "Внимательней к себе: как проверить себя на признаки рака",
    h1: "Как проверить себя на признаки рака",
  },
  {
    url: "https://zaruku.ru/rak-lyogkogo/lechenie/",
    title: "Лечение рака легкого",
    h1: "Лечение рака легкого",
  },
];

describe("pageInventoryCoverageResolver", () => {
  test("resolves proven sitemap inventory pages by section prefix and title/H1 token overlap", () => {
    expect(resolvePageInventoryCoverage({
      cluster: {
        clusterId: "map_skolkovo",
        query: "онкологический центр в сколково адрес",
        section: "/map/",
      },
      inventory,
      config: DEFAULT_PAGE_INVENTORY_COVERAGE_CONFIG,
    })).toMatchObject({
      verdict: "covered",
      matchingArticleUrl: "https://zaruku.ru/map/moskva/organization_1425/",
      matchedTitleTokens: expect.arrayContaining(["онкологический", "центр", "сколково"]),
    });

    expect(resolvePageInventoryCoverage({
      cluster: {
        clusterId: "kgp",
        query: "комплексное геномное профилирование опухоли что это",
        section: "/kompleksnoe_genomnoe_profilirovanie/",
      },
      inventory,
    }).matchingArticleUrl).toBe("https://zaruku.ru/kompleksnoe_genomnoe_profilirovanie/");

    expect(resolvePageInventoryCoverage({
      cluster: {
        clusterId: "self_check",
        query: "как проверить себя на признаки рака",
        section: "/vnimatelney_k_sebe/",
      },
      inventory,
    }).matchingArticleUrl).toBe("https://zaruku.ru/vnimatelney_k_sebe/");
  });

  test("does not lemmatize and keeps weaker same-section matches partial", () => {
    const result = resolvePageInventoryCoverage({
      cluster: {
        clusterId: "lung_gap",
        query: "рак легкого симптомы",
        section: "/rak-lyogkogo/",
      },
      inventory,
    });

    expect(result).toMatchObject({
      verdict: "partial",
      matchingArticleUrl: "https://zaruku.ru/rak-lyogkogo/lechenie/",
      matchedTitleTokens: ["легкого"],
    });
  });
});
