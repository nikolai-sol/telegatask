# TASK-052 - Hermes Advisory Enrichment for Digest

## Scope Completed

- Added pure advisory enrichment module:
  - `src/features/seoAgent/weeklyTop10DigestAdvisoryEnrichment.ts`
- Added advisory block to `SeoOpportunity`:
  - source: `hermes`
  - recommendation text
  - covered intents
  - internal-link suggestions
  - medical-review text
  - token usage
- Added digest rendering for advisory text, explicitly marked:
  - `LLM advisory (Hermes): ...`
- Wired weekly rhythm script behind:
  - `SEO_DIGEST_LLM_ENRICHMENT=1`
  - or `--digest-llm-enrichment`
- Added graceful degradation:
  - empty/error response keeps deterministic digest;
  - compliance rejection keeps deterministic digest.
- Added drug compliance post-check:
  - advisory text containing configured `drugComplianceTokens` is rejected.

## Boundary

Hermes is advisory-only.

It does not create, filter, score, reprioritize, dedupe or bind opportunities.

Deterministic fields remain owned by the existing system:

- opportunity existence
- opportunity type
- priority
- confidence
- targetUrl
- evidence
- digest inclusion

The enrichment step only adds:

```text
opportunity.advisory
```

## Local Artifact

Generated:

- `reports/task-052-zaruku-hermes-advisory-review-2026-W28.json`

Mode:

- mocked Hermes fixture
- no live LLM call
- no Telegram send
- no Firestore write
- no live SERP call

Summary:

- requested: `5`
- enriched: `5`
- degraded: `0`
- complianceRejected: `0`
- inputTokens: `500`
- outputTokens: `300`
- totalTokens: `800`
- digest messages: `3`

Example W28 melanoma advisory:

```text
LLM advisory (Hermes): Доработать существующую страницу https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/: уточнить блок под меланома на ногте фото и добавить внутренние ссылки.
```

The deterministic facts above it remain unchanged:

- section: `/melanoma/`
- target URL: `https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/`
- URL binding source query: `меланома ногтя фото`
- URL binding SERP position: `19`

## Tests

Focused + golden:

```bash
npx vitest run \
  src/features/seoAgent/weeklyTop10DigestAdvisoryEnrichment.test.ts \
  src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2.test.ts \
  src/features/seoAgent/sectionRankingGapOpportunityEngine.test.ts \
  src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts \
  src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
```

Result:

- `5` test files passed
- `20` tests passed

Build:

```bash
npm run build
```

Result: passed.

Full suite:

```bash
npm test -- --run
```

Result:

- `56` test files passed
- `185` tests passed

## Intentionally Not Changed

- No LLM influence on opportunity existence/type/priority/confidence/targetUrl.
- No approval execution.
- No production WGD pipeline changes.
- No GSC/DataForSEO/Metrika changes.
- No rhythm-chain structural changes.
- No Telegram sends in the local TASK-052 run.
- No Firestore writes.
- No live LLM call in tests or local artifact generation.

## Recommended Next Task

TASK-053 - approval command execution:

```text
approved decision -> actual draft task creation with evidence + advisory + mandatory medical-review field
```
