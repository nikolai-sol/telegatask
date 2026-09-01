import { describe, expect, test } from "vitest";
import { analyzeHtmlPage } from "./htmlAnalyzer";

describe("analyzeHtmlPage", () => {
  test("extracts indexability, metadata, structure, links, media, and schema", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/ru",
      status: 200,
      headers: { "content-type": "text/html", "x-robots-tag": "" },
      html: `<html lang="ru"><head>
        <title>Курс</title><meta name="description" content="Описание">
        <meta name="robots" content="noindex,nofollow">
        <link rel="canonical" href="https://example.com/ru">
        <link rel="alternate" hreflang="ru" href="https://example.com/ru">
        <meta property="og:title" content="Курс">
        <script type="application/ld+json">{"@type":"Organization"}</script>
      </head><body><h1>Курс</h1><h2>Программа</h2>
        <a href="/courses/1">Подробнее</a><img src="/hero.jpg" alt="">
      </body></html>`,
    });
    expect(page.indexable).toBe(false);
    expect(page.robots).toContain("noindex");
    expect(page.headings?.h1).toEqual(["Курс"]);
    expect(page.schemaTypes).toEqual(["Organization"]);
    expect(page.images).toEqual({ total: 1, missingAlt: 1 });
    expect(page.internalLinks).toEqual(["https://example.com/courses/1"]);
  });

  test("accepts reversed metadata attributes and decodes common entities", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/about",
      status: 200,
      headers: { "Content-Type": "text/html" },
      html: `<html><head>
        <meta content="About &amp; team" property="og:description">
        <meta content="A &amp; page" name="description">
        <link href="/about" rel="canonical">
      </head><body><h1>About &amp; team</h1><p>Hello world</p></body></html>`,
    });
    expect(page.description).toBe("A & page");
    expect(page.openGraph).toEqual({ "og:description": "About & team" });
    expect(page.canonical).toBe("https://example.com/about");
    expect(page.headings?.h1).toEqual(["About & team"]);
    expect(page.wordCount).toBe(4);
  });

  test("combines X-Robots-Tag with meta robots and makes noindex non-indexable", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: { "X-Robots-Tag": "noindex, nofollow" },
      html: "<html><head><meta name=robots content='index, follow'><link rel=canonical href='/different'></head><body>Text</body></html>",
    });
    expect(page.metaRobots).toBe("index, follow");
    expect(page.xRobotsTag).toBe("noindex, nofollow");
    expect(page.robots).toBe("index, follow, noindex, nofollow");
    expect(page.indexable).toBe(false);
    expect(page.indexabilityConflicts).toEqual(expect.arrayContaining([
      "Meta robots and X-Robots-Tag disagree on index/noindex.",
      "Meta robots and X-Robots-Tag disagree on follow/nofollow.",
      "Canonical points away from the crawled final URL.",
    ]));
  });

  test("emits structured conflicts without parsing English prose", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: { "content-type": "text/html", "x-robots-tag": "noindex" },
      html: `<meta name="robots" content="index"><link rel="canonical" href="/other">`,
    });

    expect(page.signalConflicts).toEqual(expect.arrayContaining([
      { code: "robots_index_disagreement", category: "robots" },
      { code: "canonical_differs_from_final", category: "canonical" },
    ]));
  });

  test("compares canonical query variants before sanitizing persisted URLs", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/page?a",
      finalUrl: "https://example.com/page?a",
      status: 200,
      headers: { "content-type": "text/html" },
      html: `<link rel="canonical" href="/page?b"><link rel="canonical" href="/page?c">`,
    });

    expect(page.signalConflicts).toEqual(expect.arrayContaining([
      { code: "canonical_differs_from_final", category: "canonical" },
      { code: "multiple_canonical_targets", category: "canonical" },
    ]));
    expect(page.finalUrl).toBe("https://example.com/page");
    expect(page.canonical).toBe("https://example.com/page");
    expect(JSON.stringify(page)).not.toMatch(/[?&][abc](?:[=&"#]|$)/);
  });

  test("compares hreflang query variants before sanitizing persisted URLs", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      status: 200,
      headers: { "content-type": "text/html" },
      html: `<link rel="alternate" hreflang="de" href="/de?a">
        <link rel="alternate" hreflang="de" href="/de?b">`,
    });

    expect(page.signalConflicts).toContainEqual({
      code: "hreflang_language_has_multiple_targets",
      category: "hreflang",
    });
    expect(page.hreflang).toEqual([
      { language: "de", url: "https://example.com/de" },
      { language: "de", url: "https://example.com/de" },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/[?&][ab](?:[=&"#]|$)/);
  });

  test("records title and description lengths as normalized character counts", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: "<title>SEO &amp; UX</title><meta name=description content='Clear page summary'>",
    });

    expect(page.title).toBe("SEO & UX");
    expect(page.titleLength).toBe(8);
    expect(page.description).toBe("Clear page summary");
    expect(page.descriptionLength).toBe(18);
  });

  test("measures only explicit keyword token alignment against title, description, and H1", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<title>Technical SEO audit</title>
        <meta name="description" content="Vienna consulting team">
        <h1>SEO audit services</h1>`,
    }, { keywords: ["technical seo", "vienna consulting", "unrelated phrase"] });

    expect(page.keywordAlignment).toMatchObject({
      state: "measured",
      checkedKeywords: 3,
      matches: [
        { keyword: "technical seo", fields: ["title"] },
        { keyword: "vienna consulting", fields: ["description"] },
      ],
      unmatchedKeywords: ["unrelated phrase"],
    });
    expect(page.keywordAlignment?.note).toContain("heuristic");
    expect(page.keywordAlignment?.note).toContain("not a relevance judgment");
  });

  test("uses explicit no-keyword and not-measured alignment states", () => {
    const input = {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: "<body>Content without measured head fields</body>",
    };

    expect(analyzeHtmlPage(input, { keywords: [] }).keywordAlignment).toMatchObject({ state: "no_keywords", checkedKeywords: 0 });
    expect(analyzeHtmlPage(input, { keywords: ["seo audit"] }).keywordAlignment).toMatchObject({ state: "not_measured", checkedKeywords: 1 });
  });

  test("reports malformed JSON-LD without aborting page analysis", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<script type="application/ld+json">{"@type":"Article"</script><body>Readable text</body>`,
    });
    expect(page.schemaTypes).toEqual([]);
    expect(page.schemaErrors).toHaveLength(1);
    expect(page.schemaErrors?.[0]).toContain("JSON-LD parse error");
    expect(page.wordCount).toBe(2);
  });

  test("normalizes and de-duplicates same-origin links while excluding non-http schemes and subdomains", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/ru",
      status: 200,
      headers: {},
      html: `<a href="/courses/1#intro">one</a><a href="https://example.com/courses/1">duplicate</a>
        <a href="#section">fragment</a><a href="mailto:test@example.com">mail</a>
        <a href="https://cdn.example.com/file">subdomain</a><a href="https://other.test/x">external</a>`,
    });
    expect(page.links).toEqual([
      "https://example.com/courses/1",
      "https://example.com/ru",
      "https://cdn.example.com/file",
      "https://other.test/x",
    ]);
    expect(page.internalLinks).toEqual(["https://example.com/courses/1", "https://example.com/ru"]);
    expect(page.externalLinks).toEqual(["https://cdn.example.com/file", "https://other.test/x"]);
  });

  test("redacts credentials, query strings, and fragments from every persisted evidence URL", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://user:password@example.com/start?access_token=secret#private",
      finalUrl: "https://user:password@example.com/final?ordinary=query#private",
      status: 200,
      headers: {},
      html: `<link rel="canonical" href="https://canon:secret@example.com/canonical?utm_source=private#x">
        <link rel="alternate" hreflang="en" href="/en?access_token=secret#x">
        <a href="/internal?ordinary=query#x">internal</a>
        <a href="https://external:secret@other.test/out?access_token=secret#x">external</a>`,
    });
    expect(page.requestedUrl).toBe("https://example.com/start");
    expect(page.finalUrl).toBe("https://example.com/final");
    expect(page.canonical).toBe("https://example.com/canonical");
    expect(page.hreflang).toEqual([{ language: "en", url: "https://example.com/en" }]);
    expect(page.internalLinks).toEqual(["https://example.com/internal"]);
    expect(page.externalLinks).toEqual(["https://other.test/out"]);
    expect(JSON.stringify(page)).not.toMatch(/password|access_token|ordinary=query|secret|#private/);
  });

  test("ignores comments and raw-text blocks for extraction while retaining valid JSON-LD", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<!-- <a href="/comment-link">comment link</a><meta name="robots" content="noindex">
        <link rel="canonical" href="/comment-canonical"> -->
        <script> <a href="/script-link">script link</a><meta name="robots" content="noindex">
          <link rel="canonical" href="/script-canonical"> </script>
        <style>.ghost { background: url('/style-link') }</style>
        <template><a href="/template-link">template link</a><h1>Ghost heading</h1></template>
        <script type="application/ld+json">{"@type":"Organization"}</script>
        <body><h1>Visible heading</h1><a href="/visible-link">Visible link</a>Visible copy</body>`,
    });
    expect(page.robots).toBeUndefined();
    expect(page.canonical).toBeUndefined();
    expect(page.headings?.h1).toEqual(["Visible heading"]);
    expect(page.internalLinks).toEqual(["https://example.com/visible-link"]);
    expect(page.schemaTypes).toEqual(["Organization"]);
    expect(page.wordCount).toBe(6);
  });

  test("sanitizes URL-valued OG and Twitter metadata without changing text metadata", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/articles/seo?session=private",
      status: 200,
      headers: {},
      html: `<meta property="og:title" content="SEO &amp; strategy">
        <meta property="og:url" content="https://user:password@example.com/articles/seo?access_token=secret#top">
        <meta property="og:image" content="/images/hero.jpg?utm_source=private#hero">
        <meta property="og:video:secure_url" content="https://cdn.example.com/video.mp4?token=secret">
        <meta name="twitter:description" content="Read this text? yes">
        <meta name="twitter:image" content="https://user:password@cdn.example.com/card.png?query=private">
        <meta name="twitter:player" content="/player?access_token=secret">
        <meta name="twitter:app:url:iphone" content="https://app.example.com/open?token=secret">`,
    });
    expect(page.openGraph).toEqual({
      "og:title": "SEO & strategy",
      "og:url": "https://example.com/articles/seo",
      "og:image": "https://example.com/images/hero.jpg",
      "og:video:secure_url": "https://cdn.example.com/video.mp4",
    });
    expect(page.twitterCards).toEqual({
      "twitter:description": "Read this text? yes",
      "twitter:image": "https://cdn.example.com/card.png",
      "twitter:player": "https://example.com/player",
      "twitter:app:url:iphone": "https://app.example.com/open",
    });
    expect(JSON.stringify(page.openGraph)).not.toMatch(/password|access_token|private|secret/);
    expect(JSON.stringify(page.twitterCards)).not.toMatch(/password|access_token|private|secret/);
  });

  test("sanitizes and de-duplicates absolute HTTP JSON-LD type IRIs", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<script type="application/ld+json">[
        {"@type":"https://user:password@example.com/Schema?access_token=secret"},
        {"@type":"https://example.com/Schema?ordinary=query"},
        {"@type":"Organization"}
      ]</script>`,
    });
    expect(page.schemaTypes).toEqual(["https://example.com/Schema", "Organization"]);
    expect(JSON.stringify(page.schemaTypes)).not.toMatch(/password|access_token|ordinary=query|secret/);
  });

  test("rejects non-http URI-scheme JSON-LD types while preserving names and CURIEs", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<script type="application/ld+json">[
        {"@type":"ftp://user:password@example.com/Type"},
        {"@type":"Organization"},
        {"@type":"schema:Organization"},
        {"@type":"Organization"}
      ]</script>`,
    });
    expect(page.schemaTypes).toEqual(["Organization", "schema:Organization"]);
    expect(JSON.stringify(page.schemaTypes)).not.toMatch(/ftp|password/);
  });

  test("optionally caps link evidence during extraction without changing default callers", () => {
    const html = Array.from({ length: 10 }, (_, index) => `<a href="/page-${index}">${index}</a>`).join("");
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html,
    }, { maxLinks: 2 });

    expect(page.links).toEqual(["https://example.com/page-0", "https://example.com/page-1"]);
    expect(page.internalLinks).toHaveLength(2);
    expect(page.externalLinks).toEqual([]);
  });

  test("uses separate internal and external link budgets with deterministic truncation evidence", () => {
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<a href="https://one.test/a">One</a><a href="https://two.test/b">Two</a><a href="/about">About</a><a href="/team">Team</a>`,
    }, { maxLinks: 4, maxInternalLinks: 1, maxExternalLinks: 2 });

    expect(page.externalLinks).toEqual(["https://one.test/a", "https://two.test/b"]);
    expect(page.internalLinks).toEqual(["https://example.com/about"]);
    expect(page.links).toEqual(["https://one.test/a", "https://two.test/b", "https://example.com/about"]);
    expect(page.linksTruncated).toBe(true);
    expect(page.omittedLinkCount).toBe(1);
  });

  test("observes unique internal URLs before evidence retention", () => {
    const observed: string[] = [];
    const page = analyzeHtmlPage({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      headers: {},
      html: `<a href="/a">A</a><a href="/b">B</a><a href="/b">B again</a>`,
    }, { maxInternalLinks: 1, onDiscoveredInternalUrl: (url) => observed.push(url) });

    expect(page.internalLinks).toEqual(["https://example.com/a"]);
    expect(observed).toEqual(["https://example.com/a", "https://example.com/b"]);
  });
});
