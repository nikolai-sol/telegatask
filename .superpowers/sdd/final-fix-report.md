# Final whole-branch review fix report

Date: 2026-09-01

Branch: `feature/seo-report-skill`

Review range: `fc017d4..588f26d`, followed by the final fix commits below

## Outcome

All Important findings and the Minor finding from the final review package were implemented and verified. The final fix wave is split into two cohesive code commits:

- `cf0745a` — `fix(seo): harden final WGD report pipeline`
- `f2dca9c` — `fix(seo): close final WGD security gaps`

The expensive Flowerlife live audit was intentionally not run; the controller owns that rerun after review.

## Inputs reviewed

- `docs/superpowers/specs/2026-08-31-universal-wgd-seo-report-skill-design.md`
- `docs/superpowers/plans/2026-08-31-universal-wgd-seo-report-skill.md`
- `.superpowers/sdd/review-fc017d4..588f26d.diff`
- `.superpowers/sdd/task-1-report.md` through `.superpowers/sdd/task-9-report.md`, as relevant
- Current implementation and tests across the WGD report, owner-provider, Yandex, CLI, renderer, and artifact boundaries
- An independent final code review of `cf0745a`, followed by a second hardening pass in `f2dca9c`

## Fix coverage

### 1. Public-only network and SSRF boundary

- Added injected DNS resolution with a strict public-unicast allowlist for IPv4 and IPv6.
- Rejects loopback, RFC1918, carrier-grade NAT, link-local, documentation, benchmark, multicast, reserved/unspecified ranges, metadata names, `localhost`, and `.local` names.
- Validates every DNS answer, every redirect destination, response final URLs, the initial runner URL, and every Lighthouse target before process handoff.
- The crawler pins each outbound socket to the already validated address and manually validates redirects.
- Lighthouse now runs behind a loopback-only validating proxy. Each HTTP or CONNECT destination is resolved, fully validated, and pinned immediately before the outbound connection. QUIC and non-proxied WebRTC UDP are disabled.
- Added literal-private, resolved-private, redirect, final-URL rebinding, metadata-name, proxy subresource, and IPv6 resolver-rule coverage. DNS/provider errors are mapped to fixed evidence.

Primary files: `networkSafety.ts`, `siteCrawler.ts`, `lighthouseCollector.ts`, `runWgdReport.ts`, and their tests.

### 2. Bounded downloads

- Removed unbounded body reads from crawler and affected provider paths.
- HTML, robots, sitemap, Yandex, GSC, and owner-provider responses enforce declared `Content-Length` and streaming byte limits.
- One deadline remains active from request start through body consumption.
- Timeout/body-limit cleanup is best effort and non-blocking, including hostile readers whose cancellation promise never settles or whose destroy hook throws.
- Oversized responses produce deterministic fixed classifications and crawler limitations.

Primary files: `siteCrawler.ts`, `boundedProviderHttp.ts`, `yandexSerpRankSource.ts`, `yandexGenSearchProbeCollector.ts`, `googleSearchConsoleSeoSource.ts`, and `yandexWebmasterSeoSource.ts`.

### 3. Safe Lighthouse process

- Added exact local dependency `lighthouse@13.4.1`; the lockfile resolves the same version.
- Invokes the local CLI with the current Node executable. No `npx`, download-at-runtime behavior, or default `--no-sandbox` remains.
- Enforces a 120-second timeout and 40 MiB stdout ceiling for every profile.
- Uses a detached POSIX process group, SIGTERM grace period, and SIGKILL fallback so Chrome-like descendants cannot survive a timeout, output limit, failure, or completed wrapper.
- On Windows, where the implementation cannot guarantee equivalent process-tree isolation, default collection returns fixed unavailable evidence instead of running unsafely.
- Declares Node `>=22.19.0`, matching Lighthouse 13.4.1's runtime requirement.

Primary files: `package.json`, `package-lock.json`, `lighthouseCollector.ts`, and `lighthouseCollector.test.ts`.

### 4. Lighthouse 13 normalization

- Supports current insight IDs (`cache-insight`, `font-display-insight`, `image-delivery-insight`, `render-blocking-insight`) plus legacy audit IDs.
- Derives failed audits from the performance, accessibility, best-practices, and SEO category `auditRefs` and retains category provenance.
- Normalizes category scores, FCP, LCP, CLS, TBT, Speed Index, INP, transfer size, unused JavaScript, unused CSS, insights, and detailed failed audits.
- Added representative Lighthouse 13 fixture coverage in which failed category audits and insights remain non-empty.

### 5. Provider budgets and deadlines

- CLI deduplicates keyword/AI inputs case-insensitively and caps them at 50 × 200 characters and 20 × 1000 characters, respectively, with deterministic usage errors.
- Yandex Search requests/polling and generative calls have per-request body/deadline limits and overall collection deadlines.
- Owner-provider calls have 15-second per-request deadlines and 2 MiB response caps; preflight has a 30-second bounded access check.
- Optional timeouts and provider failures become partial/manual evidence rather than hanging or exposing raw failures.
- Raw owner-provider error bodies are not retained in `SeoProviderError` instances.

### 6. Exact owner provenance and classification

- GSC URL-prefix properties preserve scheme, host, port, and path scope; `sc-domain:` uses domain/subdomain semantics.
- Yandex requires an explicit audited HTTP(S) origin and an exact verified origin match. A configured host ID only narrows candidates and cannot bypass verification/provenance.
- The general SEO service retains an explicit audited origin before normalizing provider domains; a scheme-less target is not guessed unless a matching URL-prefix GSC property supplies the origin.
- Missing matching verified properties/hosts map to `owner_access_required`; auth, transport, invalid-data, timeout, and body-limit failures remain `unavailable`.
- Snapshot provenance is rechecked before evidence publication.

### 7. Complete report design and Alice safety

- HTML includes executive top ten, detailed page/indexability/headings/metadata, internal architecture/crawl/sitemaps/redirects/duplicates, media/schema/social, all Lighthouse metrics, failed audits with provenance, Yandex SERP context, Alice controlled-sample evidence, owner snapshots, backlog, limitations, and evidence links.
- Alice retains only a bounded, allowlisted natural-language answer. JSON/error payloads, credential URLs, private-key material, and recognized secret forms are omitted or redacted.
- Source URLs are HTTP(S)-allowlisted, stripped of credentials/query/fragment data, length-capped, and count-capped; source positions and target-use state remain available.
- The report labels Alice as a controlled sample and explicitly does not present it as official share of voice.

### 8. Manual evidence in HTML

- Manual query rows render in the HTML report.
- When rows exist, the artifact writer assigns the fixed safe relative path `manual-query-pack.md` before HTML/JSON rendering, writes the pack atomically, and exposes the published artifact path.
- The runtime schema and one-row live behavior remain unchanged.

## Additional independent-review hardening

The independent review of the first fix commit found four cross-cutting edge cases, all addressed in `f2dca9c`:

- Lighthouse child-process cleanup now covers Chrome grandchildren and normal wrapper exit.
- Lighthouse subresources and redirects use the validating/pinning proxy, not only the initial URL check.
- Cancellation hooks can neither hang nor replace deterministic byte-limit results.
- Owner-source transports are bounded and receive the preflight abort signal.
- The crawler uses one absolute deadline across DNS, redirects, transport, body consumption, and final revalidation.
- Runner tests inject deterministic public DNS rather than consulting live `example.com` DNS.
- Chrome host-resolver rules are quoted so Lighthouse 13 parses the entire rule as one value.

## TDD evidence

Representative RED evidence recorded during the fix wave:

- Network/CLI tests initially failed because public-network validation was absent and private/resolved-private targets were accepted.
- Crawler tests initially failed for private resolution, redirect rebinding, declared oversized bodies, and streamed oversized bodies.
- Lighthouse tests initially failed for local fixed-version invocation, timeout evidence, current insight IDs, category provenance, and complete metrics.
- Owner tests initially failed for exact Yandex/GSC matching and owner-access classification.
- Provider tests initially failed for hanging requests, oversized bodies, count/length limits, and deduplication.
- Renderer/writer tests initially failed because executive/manual sections and the safe manual-pack link were absent.
- Independent-review RED run: 5 failures covering Lighthouse descendant cleanup/proxy egress, non-settling provider cancellation, and preflight timeout/abort behavior.
- Owner-signal RED check observed `transportAborted === false` before signal propagation.
- Raw owner-provider body RED run: 2 failures in 10 tests; both serialized errors retained a test secret.
- Chrome resolver quoting RED run: 1 failure in 12 Lighthouse tests.
- Hostile async-iterator cleanup RED run: 1 focused crawler failure (`fetch failed` instead of deterministic `response too large`).

GREEN evidence:

- Focused security/provider set: `8 passed` files, `74 passed` tests.
- Broad WGD/provider set after final hardening: `17 passed` files, `169 passed` tests.
- Raw owner-provider body/cancellation set: `3 passed` files, `12 passed` tests.
- Lighthouse collector: `1 passed` file, `12 passed` tests.
- Hostile crawler cleanup focus: `1 passed` test (`25 skipped` by the test filter).

## Final verification

All commands ran from `/Volumes/Elements/telegatask/.worktrees/seo-report-skill`.

```text
npm test
PASS — 87 test files, 424 tests

npm run build
PASS — TypeScript build exited 0

npm run seo:report -- --help
PASS — exited 0; documents query count/length caps and all report options

npm run seo:report -- --url file:///tmp/a
PASS — exited 1 with fixed message: "Invalid SEO report options. Run with --help for usage."

npm ls lighthouse --depth=0
PASS — lighthouse@13.4.1

git diff --check fc017d4..HEAD
PASS — no whitespace errors
```

The installed `seo-report` skill instructions did not need modification in this fix wave, so `quick_validate.py` was not rerun.

## Files changed in the final fix wave

- Runtime/dependency: `package.json`, `package-lock.json`
- CLI/orchestration: `scripts/runSeoReport.ts`, `cliOptions.ts`, `runWgdReport.ts`
- Public-network/crawl: `networkSafety.ts`, `siteCrawler.ts`
- Lighthouse: `lighthouseCollector.ts`, WGD types
- Providers: `boundedProviderHttp.ts`, `yandexSerpRankSource.ts`, `yandexWebmasterSeoSource.ts`, `googleSearchConsoleSeoSource.ts`, `seoDataProvider.ts`, `seoAgentService.ts`, Yandex generative collector
- Evidence/reporting: `yandexEvidence.ts`, `reportRenderer.ts`, `artifactWriter.ts`
- Focused tests for every area above

## Final self-review

- No secrets, provider bodies, raw DNS errors, or credential-bearing URLs are placed in report evidence or user-facing failures.
- No `response.text()`/`response.json()` remains in the bounded WGD/provider paths reviewed here.
- No `npx`, `--no-sandbox`, website mutation implementation, ownership verification mutation, Telegram send, real-task creation, or execution-plan write was added.
- Crawl requests are read-only and mutation-like URLs are excluded before request, redirect follow-up, final acceptance, and Lighthouse selection.
- Lighthouse executes audited-page JavaScript as required for valid lab measurements; the reporter itself performs no form submission or site mutation. Its browser egress is restricted to freshly validated, pinned public HTTP(S) destinations. Opaque HTTPS page traffic cannot be method-inspected by the validating CONNECT proxy, which is an operational property of browser-based Lighthouse rather than an added mutation path.
- Atomic publication, collision locks, symlink checks, deep artifact sanitation, safe relative evidence paths, and output-boundary checks remain covered and unchanged in behavior.
- No expensive Flowerlife live audit was run.

## Remaining controller action

Rerun the approved Flowerlife live audit against these commits and inspect that real Lighthouse 13 evidence contains non-empty failed audits/insights whenever the live category data reports failures.

---

## Follow-up final-review fix wave

The subsequent whole-branch review findings were implemented in two additional cohesive commits:

- `efcd38d` — `fix(deploy): require Node 22 runtime`
- `e8afd84` — `fix(seo): preserve priority crawl evidence`

The expensive Flowerlife live audit was again intentionally not run; it remains the controller's post-review action.

### Runtime/deployment contract

- `scripts/deploy.sh` now installs NodeSource 22.x when the installed runtime is absent or older than Node 22.19, then verifies the version before any npm install/build step.
- Deployment stops with a fixed error if the required runtime is still unavailable.
- A deterministic contract test ties the deploy script to `package.json`'s `>=22.19.0` engine and guards against reintroducing Node 20.
- A repository-wide runtime declaration search found no other production Node version declaration requiring adjustment.

### Explicit priority crawl coverage

- `priorityUrls` now enter the crawler as first-class seeds after the audited start URL, preserve argument order, deduplicate by sanitized identity, and consume the same bounded page budget as all other pages.
- Invalid, cross-origin, mutation-like, literal-private, resolved-private/rebound, and unsafe redirect targets are rejected through the existing pinned public-network transport boundary.
- Unlinked safe landing pages are collected as page evidence. Lighthouse selection uses only successful crawl-validated final URLs and records deterministic skip limitations for missing or unsafe evidence.
- Tests cover unlinked priorities, ordering, crawl caps, mutation/cross-origin/private exclusions, DNS rebinding, safe and unsafe redirects, and orchestration propagation.

### Observed crawl graph and page analysis

- Page evidence now records ordered discovery sources, unique observed inbound internal-linking pages, minimum internal-link depth from the audited start page, and an explicit orphan-candidate flag.
- Sitemap/priority seeds no longer receive a false depth of zero. A page with no observed path from the start reports depth as not measured.
- Exact requested URL identity takes precedence over redirect final-URL aliases when calculating depth and inbound evidence.
- Meta robots and `X-Robots-Tag` remain separate while the compatibility combined field is retained. Explicit directive disagreements, canonical-away signals, and canonical-on-non-2xx signals are recorded.
- Normalized title and description lengths are retained.
- Requested keywords receive a bounded normalized-token presence check against safe title, description, and H1 evidence. Results explicitly distinguish measured, no-keywords, and not-measured states and state that the heuristic is not a relevance judgment.
- Findings and HTML now expose conflicts, orphan candidates, graph evidence, metadata lengths, and keyword/topic heuristic state without extrapolating beyond the bounded crawl.

### Lighthouse requested/final identity

- Newly collected Lighthouse evidence keeps `url` as the sanitized requested identity and adds separate `requestedUrl` and `finalUrl` fields.
- Same-origin final paths are retained without collapsing requested-page identity.
- An unexpected top-level cross-origin final navigation becomes fixed failed evidence, retains only sanitized requested/final URLs, and is excluded from normal mobile/desktop comparisons and findings.
- Renderer and finding pairing use requested identity; detailed metrics and failed-audit tables show both requested and final URLs.
- Raw evidence filenames use requested identity, with existing collision and traversal protections unchanged.

### Follow-up RED/GREEN evidence

Representative RED observations:

- Deploy contract: 1 failing test while the script still referenced `setup_20.x` and lacked the Node 22.19 gate.
- Priority crawler: 4 initial failures for unlinked seed collection/order, unsafe seed rejection, redirect handling, and depth/inbound/orphan evidence.
- Orchestration: priority and keyword inputs were not passed to the crawler.
- Page analysis: 4 failures for separate robots signals/conflicts, metadata lengths, measured keyword matches, and explicit unmeasured states.
- Crawler integration: `X-Robots-Tag` was dropped at the response/analyzer boundary.
- Findings/reporting: missing graph/conflict/heuristic findings and missing detailed HTML columns/states.
- Lighthouse identity: 3 failures showed `url` collapsing to `finalDisplayedUrl`, cross-origin finals succeeding, and multiple requested pages all normalizing to one final identity.
- Requested-URL pairing and failed-unsafe exclusion: 2 failures in findings/renderer for each behavior before the pairing/status guards.
- Graph alias regression: a directly requested final page received no inbound count or depth when a redirect record claimed its final URL alias.

Final GREEN commands, all run from `/Volumes/Elements/telegatask/.worktrees/seo-report-skill`:

```text
npx vitest run src/features/seoAgent/wgdReport/siteCrawler.test.ts src/features/seoAgent/wgdReport/htmlAnalyzer.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/lighthouseCollector.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts scripts/deploy.test.ts
PASS — 8 test files, 117 tests

npx vitest run src/features/seoAgent/wgdReport src/features/seoAgent/providers
PASS — 16 test files, 187 tests

npm test
PASS — 88 test files, 448 tests

npm run build
PASS — TypeScript build exited 0

npx vitest run scripts/deploy.test.ts && bash -n scripts/deploy.sh
PASS — deploy contract 1 test; shell syntax exited 0

npm run seo:report -- --help
PASS — exited 0 and retained all bounded report options

npm run seo:report -- --url file:///tmp/a
PASS — exited 1 with the fixed usage error and no raw input disclosure

npm ls lighthouse --depth=0
PASS — lighthouse@13.4.1

git diff --check fc017d4..HEAD
PASS — no whitespace errors
```

The installed `seo-report` skill instructions still do not need modification for these internal runtime/evidence changes, so `quick_validate.py` was not rerun.

### Follow-up files changed

- Runtime: `scripts/deploy.sh`, `scripts/deploy.test.ts`
- Crawl and analysis: `siteCrawler.ts`, `htmlAnalyzer.ts`, `types.ts`, and focused tests
- Orchestration: `runWgdReport.ts` and its tests
- Lighthouse identity: `lighthouseCollector.ts`, `artifactWriter.ts`, and focused tests
- Findings/report design: `findings.ts`, `reportRenderer.ts`, and focused tests

### Follow-up self-review

- Priority requests remain read-only, same-origin, mutation-filtered, DNS-validated, socket-pinned, redirect-validated, byte-bounded, and deadline-bounded.
- Depth, inbound-link, orphan, and keyword/topic fields describe only normalized bounded evidence. Unknown depth and unavailable topic inputs are rendered as not measured.
- User-controlled page text, directives, keywords, URLs, and Lighthouse errors still pass through artifact sanitation and HTML escaping; URL credentials, queries, and fragments are not retained.
- Cross-origin Lighthouse finals cannot contribute category comparisons or normal findings and expose no raw navigation error.
- No site mutation, ownership mutation, Telegram/task action, execution-plan output, secret retention, or live Flowerlife audit was introduced.
- Atomic publication, symlink/output-boundary checks, collision-safe evidence paths, bounded downloads, provider deadlines, exact owner matching, Lighthouse process isolation, and runtime schema `1.0` remain covered by the passing full suite.

## Lighthouse CONNECT tunnel EPIPE follow-up

### Root cause and scoped fix

- The accepted browser-side CONNECT socket lost the one-shot error listener installed internally by `Readable.pipe`. When Chrome closed the tunnel while the upstream server was still writing, a later `EPIPE`/`ECONNRESET` had no durable listener and terminated the report process.
- CONNECT tunnels now install durable error and close listeners on both endpoints before asynchronous setup. Once established, either endpoint closing or erroring performs one idempotent symmetric teardown: both pipe directions are removed and both sockets are destroyed if still open.
- Setup failures still return the fixed generic `502 Bad Gateway`; raw DNS/socket errors are not exposed. Repeated expected transport errors after establishment are contained by listeners retained through socket close.
- The regression also exercises the inverse direction (upstream closure), requires both Lighthouse profiles to settle, and checks that no upstream tunnel socket remains open.

### EPIPE RED/GREEN evidence

RED at `bd5d3aa`, before the lifecycle fix:

```text
npx vitest run src/features/seoAgent/wgdReport/lighthouseCollector.test.ts -t "abrupt browser disconnect"
FAIL — 1 test; isolated subprocess exited 1 with `Error: write EPIPE` from `Socket.ondata (Readable.pipe)` after a successful `HTTP/1.1 200 Connection Established`.
```

GREEN after the fix:

```text
npx vitest run src/features/seoAgent/wgdReport/lighthouseCollector.test.ts -t "abrupt browser disconnect"
PASS — 1 test, 14 skipped

npx vitest run src/features/seoAgent/wgdReport/lighthouseCollector.test.ts
PASS — 1 file, 15 tests

npx vitest run src/features/seoAgent/wgdReport
PASS — 11 files, 172 tests

npm test
PASS — 88 files, 449 tests

npm run build
PASS — TypeScript build exited 0

git diff --check
PASS — no whitespace errors
```

### EPIPE files and self-review

- `src/features/seoAgent/wgdReport/lighthouseCollector.ts`: owns the full CONNECT tunnel lifecycle with durable symmetric listeners and idempotent teardown.
- `src/features/seoAgent/wgdReport/lighthouseCollector.test.ts`: deterministic subprocess regression for an abrupt browser reset during active upstream writes plus upstream-initiated closure and orphan checks.
- No process-wide exception handler, public-network validation relaxation, unbounded resource, secret disclosure, or site mutation was added.
- The Flowerlife live audit was intentionally not run. The controller retains responsibility for the collector smoke and exact live command.

## Live-artifact accuracy follow-up

### Accessibility category provenance

- Accessibility findings now select failed audits only when normalized Lighthouse category provenance includes `accessibility`; audit IDs and titles are no longer regex-classified.
- Audit IDs are deduplicated across mobile and desktop for each requested URL, sorted deterministically, and reported with the truthful unique count plus at most eight bounded ID examples.
- Reprocessing the existing sanitized `fec9979` live artifact produced the expected evidence without another live request: the homepage reports 4 unique IDs, while each of the other five Lighthouse URLs reports 5.

### Lighthouse lab versus field provenance

- Every normalized Lighthouse profile now has typed `measurementType: "lab"` and `fieldData: { source: "CrUX", state: "not_collected" | "unavailable" }` evidence. Success, timeout/failure, orchestration fallback, and artifact-normalization paths all retain this boundary.
- `report.json` normalizes even legacy/injected profiles to lab provenance and a safe CrUX state. It cannot serialize a Lighthouse profile as field data.
- The HTML Lighthouse comparison contains a prominent lab-only callout; detailed profile rows show measurement type and CrUX state; limitations explicitly state that CrUX real-user field Core Web Vitals were not collected or connected and make no field pass/fail claim.
- `.superpowers/sdd/task-9-report.md` now opens by superseding all historical live bundles and requiring exact final validation after this fix. The file is intentionally ignored by the SDD workspace and was updated in place, not force-added.

### RED/GREEN and final verification

RED before production changes:

```text
npx vitest run src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/lighthouseCollector.test.ts
FAIL — 4 files / 4 tests: category-provenance fixture reported 3 instead of 5; collector, report JSON, and HTML lacked explicit lab/CrUX evidence.
```

Final GREEN:

```text
npx vitest run src/features/seoAgent/wgdReport/findings.test.ts src/features/seoAgent/wgdReport/reportRenderer.test.ts src/features/seoAgent/wgdReport/artifactWriter.test.ts src/features/seoAgent/wgdReport/lighthouseCollector.test.ts src/features/seoAgent/wgdReport/runWgdReport.test.ts
PASS — 5 files, 71 tests

npx vitest run src/features/seoAgent/wgdReport
PASS — 11 files, 175 tests

npm test
PASS — 88 files, 452 tests

npm run build
PASS — TypeScript build exited 0

git diff --check
PASS — no whitespace errors
```

No live Flowerlife audit was run in this follow-up. Public-network enforcement, process cleanup, bounded downloads, provider deadlines, exact owner matching, artifact sanitation, atomic publication, and symlink/collision protections remain unchanged and covered by the passing suite.
