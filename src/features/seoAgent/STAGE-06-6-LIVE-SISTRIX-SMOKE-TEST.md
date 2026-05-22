# SEO Agent Stage 06.6 Live SISTRIX Smoke Test

Date: 2026-05-22
Timezone: Europe/Vienna

## Status

Blocked for full live execution.

Reason:

- no real `SISTRIX_API_KEY` was available in the current process environment
- no real `SISTRIX_API_KEY` was present in local `.env`

Because of that, the required live-provider checks for:

- `annavisas.com`
- `amalphis.at`

could not be executed honestly against the real SISTRIX API.

## Environment Checked

- `SEO_DATA_PROVIDER=sistrix`
- `SISTRIX_API_BASE_URL=https://api.sistrix.com`
- local `.env` available
- `TELEGRAM_BOT_TOKEN` present in local `.env`
- `SISTRIX_API_KEY` absent

No API key value was printed or exposed.

## Endpoints Planned

- `POST /api/companies/:companyId/seo-config`
- `POST /api/ai/seo/analyze`
- `POST /api/ai/seo/runs/:runId/draft-tasks/generate`
- `GET /api/ai/seo/runs/:runId/draft-tasks`
- `PATCH /api/ai/seo/draft-tasks/:draftTaskId`
- `POST /api/ai/seo/draft-tasks/:draftTaskId/convert`

## What Was Tested

### 1. Build

- Result: PASS
- `npm run build` completed successfully

### 2. Missing key behavior

- Result: PASS
- Started app with `SEO_DATA_PROVIDER=sistrix` and no `SISTRIX_API_KEY`
- Analyze request returned controlled `503`
- API error:
  - `SISTRIX provider is not configured yet`
- Verified no new run was saved during this failure path

### 3. Invalid provider behavior

- Result: PASS
- Started app with `SEO_DATA_PROVIDER=invalid`
- Analyze request returned controlled `503`
- API error:
  - `Unsupported SEO_DATA_PROVIDER: invalid`

### 4. Startup log safety

- Result: PASS
- App started normally enough to serve HTTP routes
- No API key was printed
- No SISTRIX secrets were printed

## What Could Not Be Tested

Blocked due missing real `SISTRIX_API_KEY`:

1. Live analyze for `annavisas.com`
2. Live analyze for `amalphis.at`
3. Real normalized run inspection using SISTRIX data
4. Draft task generation from real SISTRIX-backed runs
5. Draft approve/reject based on real SISTRIX-backed runs
6. Company-task convert from real SISTRIX-backed approved draft
7. Home-task convert from real SISTRIX-backed approved draft
8. Invalid-key smoke test using a real-key baseline

## Pass / Fail Summary

- App startup without leaking secrets: PASS
- Missing-key safe failure: PASS
- Invalid-provider safe failure: PASS
- Build: PASS
- Full live SISTRIX smoke flow: BLOCKED

## Bugs Found

No new live SISTRIX runtime bug could be confirmed, because the real provider flow was not executable without a key.

## Fixes Applied

None in this turn.

## Final Assessment

Current state:

- mock flow is already validated by Stage 06.5 runtime QA
- missing-key and invalid-provider safety paths are validated
- real live SISTRIX provider flow is still unverified

Stage 07 readiness:

- not yet confirmed for live SISTRIX usage
- safe to proceed only if Stage 07 does not depend on confirmed live SISTRIX behavior
- if Stage 07 depends on real provider behavior, a real-key smoke test must be run first
