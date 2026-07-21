# TASK-056 - Forum/TG Thread Discovery by Cluster

## Scope

Implemented the read-only recon boundary for public forum/thread discovery by semantic cluster.

This task does not create answers, drafts, Hermes calls, account actions, scheduler jobs, storage writes, or production pipeline changes.

## Added

- `src/features/seoAgent/forumThreadDiscovery.ts`
  - Pure query builder for cluster + forum modifiers.
  - Pure thread result filtering and report assembly.
  - Deterministic Chapter 6 intent classification via the existing semantic classifier.
  - Deterministic coverage verdict against configured Zaruku coverage pages.
  - PII sanitization for likely phone numbers, emails, and Telegram-style handles.
  - Domain frequency roll-up.
- `src/features/seoAgent/forumThreadDiscovery.test.ts`
  - Fixture-based coverage for query building.
  - PII exclusion.
  - Coverage mapping.
  - Drug `never_answerable` flagging.
  - Competitor exclusion from answerable set.
- `scripts/runForumThreadDiscovery.ts`
  - Opt-in local read-only recon script using Yandex Search API.
  - Writes a JSON artifact.
  - Sends an optional plain Telegram summary with `--send-telegram`.
  - No reply buttons.

## Live Recon

Command:

```bash
npx ts-node scripts/runForumThreadDiscovery.ts --out reports/task-056-zaruku-forum-thread-discovery-2026-07-17.json --send-telegram
```

Result:

- Clusters: 5
- Raw search results: 150
- Accepted thread-like candidates: 144
- Covered: 116
- Gaps: 28
- `never_answerable`: 0 in this live run
- `competitor_excluded`: 0 in this live run
- Search API errors: 0
- Telegram read-only batch: sent to dev chat

Top domains:

| Domain | Threads | Answerable | Gaps |
| --- | ---: | ---: | ---: |
| sprosivracha.com | 34 | 34 | 2 |
| dzen.ru | 19 | 19 | 7 |
| krasnozhon.ru | 8 | 8 | 0 |
| niioncologii.ru | 8 | 8 | 1 |
| doctu.ru | 6 | 6 | 2 |

Primary uncovered theme from the first run:

- `санаторно-курортное лечение онкобольным` has multiple public candidates and no mapped Zaruku coverage page in this boundary.

Artifact:

- `reports/task-056-zaruku-forum-thread-discovery-2026-07-17.json`

## Intentional Non-Changes

- No production WGD runner changes.
- No weekly rhythm changes.
- No Firestore writes.
- No MySQL writes.
- No event/outbox changes.
- No Hermes or LLM draft generation.
- No Telegram approval/reject buttons.
- No forum/TG posting or account actions.
- No scraping behind login.
- No changes to Yandex, GSC, Metrika, or Webmaster providers.

## Risks / Notes

- The first run is broad because it relies on open SERP snippets. TASK-057 should review an allow-list/deny-list before any operational use.
- `dzen.ru`, `vk.com`, and medical/clinic domains appear in open search results; they should not be treated as approved communities until compliance reviews the domain map.
- Drug and competitor flags are covered by fixtures, but the selected first-run clusters did not produce live drug/competitor exclusions.
- The artifact stores sanitized title/snippet text only; no author names, profiles, or usernames are collected.

## Recommended TASK-057

Client compliance review for the forum/domain allow-list and answerability policy:

- approve/deny candidate domains;
- define which public platforms are allowed for monitoring only;
- confirm no posting/account action until written approval;
- decide whether `санаторно-курортное лечение онкобольным` should become a content gap candidate.
