# TASK-065 - Content Gap Discovery

## Scope

Repurposed TASK-056 public-search recon mechanics into a read-only content-gap backlog generator.

This task did not add posting, answer drafts, Hermes calls, cron wiring, weekly rhythm changes, Firestore writes, or MySQL writes.

## Added

- `src/features/seoAgent/contentGapDiscovery.ts`
  - Builds a theme-level content-gap report from public search recon output.
  - Includes only `gap` and `partial` coverage verdicts.
  - Groups by question theme/cluster, not source domain.
  - Ranks themes by frequency plus optional Yandex signal evidence.
- `src/features/seoAgent/contentGapDiscovery.test.ts`
  - Fixture-based theme grouping.
  - Signal ranking.
  - Sanatorium gap with CTR evidence.
  - No side effects contract.
- `scripts/runContentGapDiscovery.ts`
  - Opt-in local read-only runner.
  - Uses Semantic Profile seed clusters from Zaruku production config, plus the TASK-065 sanatorium cluster.
  - Runs Yandex Search API reads only.
  - Writes a JSON artifact and optional plain Telegram batch.

## Coverage Rule Change

`forumThreadDiscovery` coverage now has three verdicts:

- `covered`: same section and at least two question-intent tokens match the article title/H1 tokens.
- `partial`: same section and keyword overlap exists, but title/H1 intent-token match is insufficient.
- `gap`: no configured coverage page with enough same-section evidence.

This replaces the TASK-056 over-broad rule where section + keyword overlap was enough to mark a row `covered`.

## Live Run

Command:

```bash
npx ts-node scripts/runContentGapDiscovery.ts --out reports/task-065-zaruku-content-gap-discovery-2026-07-18.json --send-telegram --max-queries-per-cluster 2
```

Result:

- Clusters: 21
- Search queries: 42
- Raw results: 420
- Accepted public/thread-like results: 414
- Covered: 231
- Partial: 19
- Gap: 164
- Content-gap themes: 12
- Gap themes: 9
- Partial themes: 3
- Public question examples in artifact: 56
- Search errors: 0
- Telegram read-only batch: sent

Top ranked themes:

| Theme | Verdict | Frequency | Signal |
| --- | --- | ---: | --- |
| санаторно-курортное лечение онкобольным | gap | 18 | CTR 14.29% |
| как проверить себя на признаки рака | gap | 20 | n/a |
| комплексное геномное профилирование опухоли что это | gap | 20 | n/a |
| кому нужно комплексное геномное профилирование опухоли | gap | 20 | n/a |
| онкологический центр в сколково адрес | gap | 20 | n/a |
| поддержка онкопациентов | gap | 20 | n/a |
| цаоп пушкинского района спб | gap | 20 | n/a |
| инвалидность при раке легкого | gap | 18 | n/a |

Artifact:

- `reports/task-065-zaruku-content-gap-discovery-2026-07-18.json`

## TASK-056 Covered Sample Re-Evaluation

Sampled 10 previously `covered` rows from TASK-056:

- Still covered: 9
- Downgraded to partial: 1
- Downgraded to gap: 0

The downgraded row was a breast-rehab / chemotherapy-recovery question. The stricter rule keeps it as `partial` because the existing article is related but the title/H1 evidence is not strong enough to say the specific question is answered.

## PII Check

Checked stored example `title` and `questionText` fields in the TASK-065 artifact:

- Example questions: 56
- Email/phone/handle pattern hits: 0

The generic whole-file regex also matches timestamps and numeric map URLs, so the meaningful PII check is scoped to stored public-question text fields.

## Sanatorium Caveat

TASK-065 acceptance requires `санаторно-курортное лечение онкобольным` to appear as a ranked gap with CTR evidence, and it does.

One caveat: the current WGD sitemap sample contains a possible Zaruku page candidate:

- `https://zaruku.ru/obshie-temy/sanatorno-kurortnoe-lechenie-kak-metod-reabilitacii-posle-onkologii/`

The TASK-065 coverage map intentionally did not treat that page as automatic coverage. It should be manually reviewed before deciding whether the real action is a new page, a rewrite, or a stronger answer block.

## Intentional Non-Changes

- No production WGD runner changes.
- No weekly rhythm changes.
- No cron changes.
- No Firestore writes.
- No MySQL writes.
- No Hermes/LLM calls.
- No Telegram approval buttons.
- No answer drafts.
- No posting/account actions.
- No GSC/Yandex/Metrika/Webmaster provider changes.

## Recommended Next

Manual content decision for the sanatorium theme:

- inspect the existing sitemap candidate;
- decide whether it answers the real public questions;
- if not, route through normal content flow: content brief -> medical review -> publish -> measure.
