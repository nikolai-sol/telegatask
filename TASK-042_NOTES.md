# TASK-042 — Target-Class SERP URL Evidence Refresh + Quality Gate Rerun

## Scope

Ran an opt-in local SERP refresh using only target-class queries from the TASK-041 intent-filtered review, then reran the unchanged TASK-040 quality gate against the filtered set.

This task did not change gate thresholds, Opportunity Engine thresholds, production pipeline defaults, storage, Telegram, scheduler, providers, or LLM behavior.

## Changed Files

- `scripts/runYandexTargetClassSerpEvidenceRefresh.ts`
  - Local opt-in script.
  - Reads:
    - TASK-038 Yandex 28d query history review artifact;
    - TASK-041 intent-filtered review artifact.
  - Runs live Yandex SERP checks only for target-class queries from TASK-041.
  - Applies the existing TASK-039 query-to-URL mapper.
  - Reruns the existing TASK-040 quality gate with unchanged config.
- `TASK-042_NOTES.md`
- `reports/task-042-zaruku-target-class-serp-evidence-refresh-2026-07-06.json`

No new pure logic was introduced, so no new unit fixture was required for TASK-042.

## Command

```bash
node -r ts-node/register/transpile-only scripts/runYandexTargetClassSerpEvidenceRefresh.ts \
  --history-review reports/task-038-zaruku-yandex-28d-query-history-review-2026-07-05.json \
  --intent-review reports/task-041-zaruku-yandex-intent-filtered-opportunity-review-2026-07-06.json \
  --out reports/task-042-zaruku-target-class-serp-evidence-refresh-2026-07-06.json \
  --enable-serp-query-url-evidence
```

## Run Result

- Target-class keyword requests: 15
- Rank checks returned: 15
- Target domain found: 7
- Matched URL records: 7
- Missing URL records: 8
- Opportunities after filtered SERP evidence: 2
- Opportunities with `targetUrl`: 1
- Failed SERP requests: 0
- Side effects:
  - persisted: false
  - sent: false
  - productionPipelineRun: false
  - liveApiCalls: true

Cost:

- Request count: 15
- Estimated unit cost: not configured (`null`)
- Estimated total cost: not calculated

## Quality Gate Result

Gate status: `review_required`

Checks:

- `record_url_coverage`: fail
  - actual: 0.4667
  - expected: 0.5
- `opportunity_url_coverage`: fail
  - actual: 0.5
  - expected: 0.8
- `matched_url_domain`: pass
  - actual: 0
  - expected: 0

Filtered gate summary:

- Eligible query records: 15
- Matched URL records: 7
- Missing URL records: 8
- Record URL coverage: 0.4667
- Opportunities: 2
- Opportunities with target URL: 1
- Opportunity URL coverage: 0.5
- Mismatched domains: 0
- Page type counts:
  - homepage: 0
  - map_directory: 3
  - content_page: 4
  - other: 0
  - invalid_url: 0

Interpretation:

- Domain safety is good: no mismatched target-domain URLs.
- Evidence is still not automation-ready.
- The record coverage is close to the 0.5 threshold but still below it.
- The opportunity URL coverage remains too low for automated task generation.
- Status is `review_required`, not `blocked`.

## Opportunity URL Coverage

Surviving opportunities:

1. `подногтевая меланома фото`
   - `targetUrl`: null
   - Reason: Yandex SERP check did not find `zaruku.ru` in the checked result window.
   - Top observed domains included oncology/clinic competitors such as `oncology-centr.ru`, `yusupovs.com`, `euroonco.ru`, `melanomaunit.moscow`, `oncology-spb.ru`.
2. `онкологический центр в сколково адрес`
   - `targetUrl`: `https://zaruku.ru/map/moskva/organization_1425/`
   - Page type: `map_directory`
   - SERP position: 12
   - Webmaster average position remains separate: 9.57943925233645

## Matched URL Mix

Matched target-class URLs:

- `content_page`: 4
- `map_directory`: 3
- `homepage`: 0

This is materially cleaner than the unfiltered TASK-040 mix, but still not enough to clear the gate.

## Intentionally Not Changed

- No gate threshold changes.
- No Opportunity Engine threshold changes.
- No classifier changes.
- No production pipeline default changes.
- No Firestore writes.
- No storage/schema changes.
- No Telegram, scheduler or auto-approval changes.
- No GSC, DataForSEO, Metrica or LLM changes.
- No heuristic query-to-page branch resumed.
- No SERP position merge into Yandex Webmaster average position.

## Recommended TASK-043

Manual evidence review for the two surviving opportunities before any automation:

- decide whether `онкологический центр в сколково адрес` should become a directory/map optimization task;
- investigate why `подногтевая меланома фото` has opportunity-level evidence but no matching Zaruku SERP URL;
- only after manual acceptance, define the section-level rank tracking cron contract from Chapter 6.2.
