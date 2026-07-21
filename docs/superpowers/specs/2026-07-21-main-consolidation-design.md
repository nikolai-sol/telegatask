# Main consolidation design

## Objective

Consolidate the accumulated SEO OS implementation into `main`, preserve every meaningful project change, push the resulting history to `origin/main`, and leave the repository with a clean `git status`.

The operator explicitly selected direct integration into `main`; no feature branch or pull request is required for this cleanup.

## Repository state

- The workspace is a normal repository on `main`, not a linked worktree.
- Local `main` is three commits ahead of `origin/main` and zero commits behind.
- The working tree contains tracked source changes plus previously untracked source, SQL, tests, fixtures, task notes, and generated runtime artifacts.
- The complete suite currently passes, so consolidation must preserve behavior rather than refactor it.

## Classification

Commit to Git:

- application and bot source under `src/`;
- executable and review scripts under `scripts/`;
- test fixtures under `src/features/seoAgent/fixtures/`;
- SQL schema `010_seo_os_v1.sql`;
- package manifests and `.env.example`;
- TASK notes and product/implementation documentation;
- one static weekly production input: `reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json`.

Keep locally but ignore:

- `.env`, credentials, and service-account files;
- `node_modules/` and `dist/`;
- `.DS_Store` and `.vercel/`;
- `logs/` and `outputs/`;
- generated `reports/`, except the static TASK-043 weekly input.

No user-owned runtime artifact is physically deleted. Ignore rules make those files invisible to normal Git status while preserving them on disk.
The two previously tracked generated AmalPHIS report files are removed from the Git index with `git rm --cached` but remain on disk.

## Integration strategy

1. Add repository hygiene rules, remove previously tracked generated reports from the index, and add the TASK-043 exception.
2. Stage every non-ignored change with `git add -A`.
3. Audit the staged path list, staged diff statistics, whitespace errors, suspicious secret patterns, and accidental deletions.
4. Run the full Vitest suite and TypeScript build from the exact staged workspace.
5. Create one consolidation commit on `main` containing the accumulated implementation and documentation.
6. Push `main` to `origin/main` without force.
7. Confirm local/remote divergence is `0/0` and `git status --porcelain` is empty.

## Safety rules

- Never stage `.env`, tokens, service-account keys, PM2 logs, or generated report outputs.
- Never use reset, checkout, clean, force-push, or physical deletion for this consolidation.
- Abort before commit if tests/build fail, staged secret scanning finds a credential, or the staged set contains unexpected deletions.
- Preserve the Mac PM2/runtime state already deployed by TASK-073; Git consolidation must not restart services or re-run production collectors.

## Acceptance criteria

- All meaningful accumulated files are tracked in `main`.
- Full test suite and build pass immediately before commit.
- `origin/main` contains the consolidation commit.
- `git rev-list --left-right --count origin/main...main` returns `0 0`.
- `git status --porcelain` returns no lines.
