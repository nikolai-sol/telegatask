# TASK-050 - Tracking Coverage Alignment with Live Traffic

## Scope Completed

- Classified the `/content/` Metrika bucket using the live TASK-049 raw Metrika snapshot.
- Added explicit Metrika section URL patterns for sections that were previously falling into `/content/`.
- Added traffic-aligned seed clusters for:
  - `/rak-molochnoj-zhelezy/`
  - `/rak-lyogkogo/`
- Verified the production tracking list includes both sections and remains inside the existing weekly cap.
- Regenerated a credentialed Metrika Global Report artifact with the updated section mapping.

## `/content/` Decision

`/content/` is not a coherent semantic section.

The live raw Metrika snapshot showed it was a fallback bucket containing:

- `/limfoma/`
- `/rak-mochevogo-puzyrya/`
- `/obshie-temy/`
- `/pitanie/`
- `/neudobnye-voprosy/`
- homepage and residual media/legacy URLs

Decision:

- Do not add `/content/` as a target rank-tracking section.
- Keep `/content/` only as a residual fallback in Metrika reporting.
- Add explicit URL patterns for the real content sections above.

After remapping, `/content/` dropped to a residual bucket:

- before: `696` visits in TASK-049 live Global Report;
- after: `52` visits in TASK-050 coverage-aligned Global Report.

## Config Changes

Updated:

- `src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.ts`

Added/confirmed section priorities:

- `/rak-lyogkogo/`: priority 1
- `/limfoma/`: priority 1
- `/rak-mochevogo-puzyrya/`: priority 1
- `/obshie-temy/`: priority 3
- `/pitanie/`: priority 3
- `/neudobnye-voprosy/`: priority 3
- `/content/`: priority 4 residual fallback

Added Metrika URL patterns:

- `/limfoma/`
- `/rak-mochevogo-puzyrya/`
- `/obshie-temy/`
- `/pitanie/`
- `/neudobnye-voprosy/`

## Seed Clusters

`/rak-molochnoj-zhelezy/` now has `6` seed clusters:

- `восстановление после рмж`
- `инвалидность при раке молочной железы`
- `рак молочной железы симптомы`
- `рак молочной железы диагностика`
- `рак молочной железы лечение`
- `стадии рака молочной железы`

`/rak-lyogkogo/` now has `6` seed clusters:

- `рак легкого симптомы`
- `рак легкого диагностика`
- `рак легкого лечение`
- `стадии рака легкого`
- `инвалидность при раке легкого`
- `восстановление после рака легкого`

Drug compliance:

- No new seed query contains a configured drug-name token.
- New clusters use nosology, symptom, diagnosis, treatment, stage, disability and recovery patterns.

## Expected Weekly Request Count

The expanded production tracking list is:

- expected SERP requests: `17`
- configured weekly cap: `50`

By section:

- `/rak-lyogkogo/`: `6`
- `/rak-molochnoj-zhelezy/`: `6`
- `/rak-pecheni/`: `1`
- `/melanoma/`: `1`
- `/map/`: `2`
- `/obraz_zhizni_pri_onkologii/`: `1`

No live SERP/rhythm run was executed for TASK-050.

## Coverage-Aligned Metrika Artifact

Command:

```bash
npx ts-node --transpile-only scripts/runSeoGlobalReport.ts \
  --week-key 2026-W28 \
  --weekly-artifact reports/task-048-zaruku-weekly-seo-rhythm-2026-W28.json \
  --out reports/task-050-zaruku-global-report-2026-W28-coverage-aligned.json \
  --raw-out reports/raw/task-050-zaruku-metrika-raw-2026-W28-coverage-aligned.json
```

Result:

- Metrika status: `available`
- Metrika API requests: `1`
- Sections with traffic: `11`
- Firestore writes: `false`
- Telegram messages: `false`
- Production pipeline run: `false`
- Actions generated from Metrika: `false`

Top sections after remapping:

- `/rak-molochnoj-zhelezy/`: `520`
- `/rak-lyogkogo/`: `379`
- `/rak-mochevogo-puzyrya/`: `296`
- `/obshie-temy/`: `200`
- `/melanoma/`: `164`
- `/map/`: `161`
- `/limfoma/`: `94`
- `/rak-pecheni/`: `65`
- `/content/`: `52`
- `/neudobnye-voprosy/`: `32`
- `/pitanie/`: `23`

## Tests

Focused + golden:

```bash
npx vitest run \
  src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig.test.ts \
  src/features/seoAgent/sectionRankTracking.test.ts \
  src/features/seoAgent/metrikaSectionTraffic.test.ts \
  src/features/seoAgent/globalReportAssembler.test.ts \
  src/features/seoAgent/baseline/wgdZarukuGoldenRegression.test.ts
```

Result:

- `5` test files passed
- `15` tests passed

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

- `55` test files passed
- `178` tests passed

## Intentionally Not Changed

- No Engine changes.
- No digest/approval changes.
- No rhythm chain changes.
- No budget cap changes.
- No Metrika collector logic changes.
- No classifier logic changes.
- No Firestore writes.
- No Telegram sends.
- No production WGD pipeline run.
- No live SERP/rank-tracking run.

## Recommended Next Task

After the real W29 cycle confirms the expanded tracking list in live RankHistory, proceed to approval command execution:

```text
approved decision -> actual draft task creation
```

That is the remaining Level 1 loop segment before measurement work.
