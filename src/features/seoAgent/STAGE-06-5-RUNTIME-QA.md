# SEO Agent Stage 06.5 Runtime QA

Date: 2026-05-21

Scope:

- Focused backend runtime QA for SEO analysis -> draft tasks -> draft approval/rejection -> explicit convert to real task
- Target domain: `annavisas.com`
- Primary provider: `SEO_DATA_PROVIDER=mock`
- Additional provider safety checks:
  - `SEO_DATA_PROVIDER=sistrix` without `SISTRIX_API_KEY`
  - `SEO_DATA_PROVIDER=invalid`

## Endpoints Used

- `POST /api/companies/:companyId/seo-config`
- `POST /api/ai/seo/analyze`
- `POST /api/ai/seo/runs/:runId/draft-tasks/generate`
- `GET /api/ai/seo/runs/:runId/draft-tasks`
- `PATCH /api/ai/seo/draft-tasks/:draftTaskId`
- `POST /api/ai/seo/draft-tasks/:draftTaskId/convert`

## Test Setup

- QA company: `qa-seo-company-annavisas`
- QA team: `qa-seo-team-1`
- Cross-team user/team:
  - user: `qa-seo-user-team2`
  - team: `qa-seo-team-2`
- Outsider user for invalid assignee:
  - user: `qa-seo-user-outsider`

## Runtime Results

1. Mock analysis creates run
   - Result: PASS
   - `POST /api/ai/seo/analyze` returned `{ ok: true, run }`

2. Run includes normalized fields
   - Result: PASS
   - Verified presence of:
     - `provider`
     - `domain`
     - `summary`
     - `visibility`
     - `keywords`
     - `competitors`
     - `opportunities`
     - `recommendations`
     - `scores`

3. Draft task generation works
   - Result: PASS
   - Draft tasks created from run
   - Every task had `teamId` and `runId`
   - Every task started with `status="draft"`
   - No empty titles found
   - No keyword draft task had empty keyword data
   - No draft task had `fire` priority

4. Re-generate draft tasks for same run
   - Result: PASS
   - Existing draft tasks were returned
   - No duplicate draft tasks were created

5. Approve draft task
   - Result: PASS
   - Status changed to `approved`
   - No real task created at approve time

6. Reject draft task
   - Result: PASS
   - Status changed to `rejected`
   - No real task created at reject time

7. Convert approved draft task to real company task
   - Result: PASS
   - Real task created
   - Draft task updated with:
     - `realTaskId`
     - `convertedAt`
     - `convertedByUserId`
   - Real task received:
     - correct `teamId`
     - `companyId`
     - `visibility="team"`
     - safe mapped priority (`high`, never `fire`)
     - `isFire=false`

8. Convert same approved draft task again
   - Result: PASS
   - No duplicate real task created
   - Existing linked task returned

9. Convert draft-status task
   - Result: PASS
   - Controlled error returned:
     - `SEO draft task is not approved yet`
   - No real task created

10. Convert rejected task
    - Result: PASS
    - Controlled error returned:
      - `Rejected SEO draft tasks cannot be converted`
    - No real task created

11. Convert with invalid `companyId`
    - Result: PASS
    - Controlled error returned:
      - `Company not found`
    - No real task created

12. Convert home task without `companyId`
    - Result: PASS
    - Verified by converting an approved draft task with `visibility="private"` and no `companyId`
    - Real task created without `companyId`
    - `visibility="private"`
    - `isFire=false`

13. Assign to user outside active team
    - Result: PASS
    - Controlled error returned:
      - `Assigned user is not an active team member`
    - No real task created

14. Company task with `visibility="private"`
    - Result: PASS
    - Controlled error returned:
      - `Company SEO tasks must use team visibility`

15. Home task with `visibility="team"`
    - Result: PASS
    - Verified with explicit home conversion intent (`companyId: null`, `visibility: "team"`)
    - Controlled error returned:
      - `Home SEO tasks must use private visibility`

16. Cross-team access blocked
    - Result: PASS
    - Cross-team list request returned `403 Access denied`
    - Cross-team convert request returned `404 SEO draft task not found`
    - Flow is blocked from another active team

17. Provider failure does not save run
    - Result: PASS
    - With `SEO_DATA_PROVIDER=sistrix` and no API key:
      - API returned `503`
      - error: `SISTRIX provider is not configured yet`
      - run count before/after stayed unchanged

18. Invalid provider returns controlled 503
    - Result: PASS
    - With `SEO_DATA_PROVIDER=invalid`:
      - API returned `503`
      - error: `Unsupported SEO_DATA_PROVIDER: invalid`

19. Build
    - Result: PASS
    - `npm run build`

## Bugs Found During Runtime QA

1. Repeated convert returned linked real task with raw Firestore timestamp objects instead of normalized date values
   - Status: FIXED

2. Explicit home-task conversion intent could be lost because `companyId: null` fell back to `suggestedCompanyId`
   - Effect:
     - home-task negative case could incorrectly create a company task
   - Status: FIXED

## Fixes Applied

1. Added normalized agency task hydration in [src/services/firestore.service.ts](/Volumes/Elements/telegatask/src/services/firestore.service.ts:1)
   - Repeated convert now returns the linked real task in the same normalized shape as initial convert

2. Hardened home/company conversion branching in [src/features/seoAgent/seoAgentService.ts](/Volumes/Elements/telegatask/src/features/seoAgent/seoAgentService.ts:732)
   - explicit `companyId: null` now stays explicit
   - `visibility="private"` without `companyId` can create a home task
   - company task visibility is enforced as `team`
   - home task visibility is enforced as `private`

3. Route parsing updated in [src/features/seoAgent/routes.ts](/Volumes/Elements/telegatask/src/features/seoAgent/routes.ts:401)
   - `companyId: null` is passed through correctly to conversion service
   - invalid `companyId` payload types now return controlled `400`

## Notes

- Local QA server was started with a dummy Telegram bot token for Mini App auth header generation.
- Bot launch produced expected `404` logs from Telegram API in local QA mode, but HTTP backend routes remained available and the SEO Agent runtime flow was validated successfully.
