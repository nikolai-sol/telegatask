# Main Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all meaningful accumulated work into local and remote `main` while keeping runtime artifacts on disk but out of Git status.

**Architecture:** Treat Git hygiene as a classification boundary: source, schemas, tests, fixtures, notes, and the static weekly input are versioned; generated reports, logs, outputs, Vercel metadata, and OS files are ignored. Integrate directly on `main` because the operator explicitly requested it and the branch is zero commits behind `origin/main`.

**Tech Stack:** Git, Node.js, TypeScript, Vitest, npm.

## Global Constraints

- Do not delete local runtime artifacts.
- Do not stage `.env`, credentials, service-account keys, logs, or generated report outputs.
- Do not force-push or rewrite existing history.
- Stop before commit if verification or staged security review fails.

---

### Task 1: Establish repository hygiene

**Files:**
- Modify: `.gitignore`
- Preserve and track: `reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json`

**Interfaces:**
- Consumes: current generated runtime directories.
- Produces: a Git classification boundary that keeps future weekly runs from dirtying `main`.

- [ ] **Step 1: Add ignore rules**

Add `.DS_Store`, `.vercel/`, `logs/`, `outputs/`, and `reports/*`, followed by the directory and file exceptions required to track the TASK-043 weekly input.

- [ ] **Step 2: Stop tracking generated reports without deleting local files**

Run:

```bash
git rm --cached reports/wgd-amalphis-2026-06-09.html reports/wgd-amalphis-2026-06-09.json
```

Expected: both files are staged as repository deletions and remain present on disk.

- [ ] **Step 3: Verify ignore behavior**

Run:

```bash
git check-ignore -v logs/out.log reports/task-048-zaruku-weekly-seo-rhythm-2026-W29.json
git check-ignore -v reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json
```

Expected: runtime files match `.gitignore`; TASK-043 prints no ignore match.

### Task 2: Stage and audit the consolidation

**Files:**
- Stage: all non-ignored modifications and untracked files.

**Interfaces:**
- Consumes: Task 1 classification.
- Produces: a reviewed Git index suitable for a single consolidation commit.

- [ ] **Step 1: Stage all meaningful changes**

Run:

```bash
git add -A
```

- [ ] **Step 2: Audit paths and deletions**

Run:

```bash
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
```

Expected: source/docs/tests/fixtures/schema plus TASK-043; no runtime directories, `.env`, or accidental deletions; no whitespace errors.

- [ ] **Step 3: Scan the staged content for secrets**

Run a staged-file scan for private-key headers and assigned token/password/client-secret values. `.env.example` placeholders are allowed; real non-empty credential assignments are not.

Expected: no real credential material.

### Task 3: Verify and commit on main

**Files:**
- Commit: the complete reviewed index.

**Interfaces:**
- Consumes: audited staged tree.
- Produces: one non-rewriting commit on local `main`.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: all Vitest files/tests pass and TypeScript exits 0.

- [ ] **Step 2: Commit**

Run:

```bash
git commit -m "feat(seo): consolidate SEO OS weekly operations"
```

Expected: commit created on `main` with no unstaged meaningful changes.

### Task 4: Publish and prove cleanliness

**Files:**
- No file changes.

**Interfaces:**
- Consumes: local consolidation commit.
- Produces: synchronized local and remote `main` with a clean worktree.

- [ ] **Step 1: Push without rewriting history**

Run:

```bash
git push origin main
```

Expected: fast-forward push succeeds.

- [ ] **Step 2: Verify final state**

Run:

```bash
git fetch origin
git rev-list --left-right --count origin/main...main
git status --porcelain
git status --branch --short
```

Expected: divergence `0 0`, empty porcelain output, and `## main...origin/main` with no changes.
