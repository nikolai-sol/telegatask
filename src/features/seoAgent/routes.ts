import { Router, Request, Response } from "express";
import { webAppAuthMiddleware } from "../../middleware/validateWebApp";
import { getCompanyById } from "../../repositories/companyRepository";
import { isCompanyMember } from "../../repositories/companyMemberRepository";
import { getUserById, getUserByTelegramId, updateUserActiveTeamId } from "../../repositories/userRepository";
import { listTeamsByMemberId } from "../../repositories/teamRepository";
import { getRolePermissions, getUserRoleInTeam } from "../../core/permissions/campaignPermissions";
import { canAccessCompany } from "../../core/permissions/companyAccess";
import { findSeoAnalysisRunById } from "./seoAnalysisRunRepository";
import { findSeoDraftTaskById } from "./seoDraftTaskRepository";
import { findSeoConfigByCompany, patchSeoConfig, upsertSeoConfig } from "./seoConfigRepository";
import {
  approveSeoRun,
  convertSeoDraftTaskToRealTask,
  generateSeoDraftTasksForRun,
  listSeoDraftTasksForRun,
  runSeoAnalysis,
  SeoDraftTaskError,
  updateSeoDraftTaskStatus,
} from "./seoAgentService";
import { SeoProviderError, SeoProviderNotConfiguredError } from "./providers/seoDataProvider";
import type {
  SeoAnalysisMode,
  SeoConvertDraftTaskPriority,
  SeoDraftTaskStatus,
  SeoDraftTaskVisibility,
} from "./types";

const router = Router();

function handleSeoAgentError(route: string, err: unknown, res: Response): void {
  if (err instanceof SeoProviderNotConfiguredError) {
    console.warn(`[seoAgent] ${route} provider not configured: ${err.message}`);
    res.status(503).json({ error: err.message });
    return;
  }
  if (err instanceof SeoProviderError) {
    console.warn(`[seoAgent] ${route} provider error:`, {
      category: err.category,
      statusCode: err.statusCode,
      safeMessage: err.safeMessage,
    });
    res.status(err.statusCode).json({ error: err.safeMessage });
    return;
  }
  if (err instanceof SeoDraftTaskError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error(`[seoAgent] ${route} error:`, err);
  res.status(500).json({ error: "Internal error" });
}

async function resolveUserId(telegramId: number): Promise<string | null> {
  const user = await getUserByTelegramId(telegramId);
  return user?.id ?? null;
}

async function resolveActiveTeamId(userId: string): Promise<string | null> {
  const user = await getUserById(userId);
  if (user?.activeTeamId) return user.activeTeamId;

  const teams = await listTeamsByMemberId(userId, 20);
  const first = teams[0]?.id ?? null;
  if (first) {
    updateUserActiveTeamId(userId, first).catch(() => {});
  }
  return first;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseOptionalSources(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return parseStringArray(value);
}

function parseMode(value: unknown): SeoAnalysisMode | null {
  const raw = String(value || "").trim();
  if (
    raw === "quick_audit" ||
    raw === "content_gap" ||
    raw === "keyword_strategy" ||
    raw === "daily_brief"
  ) {
    return raw;
  }
  return null;
}

function parseDraftTaskStatus(value: unknown): Extract<SeoDraftTaskStatus, "approved" | "rejected"> | null {
  const raw = String(value || "").trim();
  if (raw === "approved" || raw === "rejected") return raw;
  return null;
}

function parseConvertPriority(value: unknown): SeoConvertDraftTaskPriority | undefined | null {
  if (value === undefined) return undefined;
  const raw = String(value || "").trim();
  if (raw === "normal" || raw === "priority") return raw;
  return null;
}

function parseDraftTaskVisibility(value: unknown): SeoDraftTaskVisibility | undefined | null {
  if (value === undefined) return undefined;
  const raw = String(value || "").trim();
  if (raw === "private" || raw === "team") return raw;
  return null;
}

async function getSeoRequestContext(req: Request, res: Response, companyId: string) {
  const tgUser = req.webAppData!.user;
  const userId = await resolveUserId(tgUser.id);
  if (!userId) {
    res.status(404).json({ error: "User not found" });
    return null;
  }

  const activeTeamId = await resolveActiveTeamId(userId);
  if (!activeTeamId) {
    res.status(400).json({ error: "No active team set" });
    return null;
  }

  const company = await getCompanyById(companyId);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return null;
  }
  if (company.teamId !== activeTeamId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }

  const role = await getUserRoleInTeam(userId, activeTeamId);
  const member = await isCompanyMember(company.id, userId);
  if (!canAccessCompany({ role, company, isMember: member, hasOwnTasks: false })) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }

  return { userId, activeTeamId, company, role };
}

router.get("/api/companies/:companyId/seo-config", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const context = await getSeoRequestContext(req, res, req.params.companyId);
    if (!context) return;

    const config = await findSeoConfigByCompany(context.activeTeamId, context.company.id);
    res.json({ ok: true, config });
  } catch (err) {
    handleSeoAgentError("GET /api/companies/:companyId/seo-config", err, res);
  }
});

router.post("/api/companies/:companyId/seo-config", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const context = await getSeoRequestContext(req, res, req.params.companyId);
    if (!context) return;

    if (!getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const domain = typeof req.body?.domain === "string" ? req.body.domain.trim() : "";
    if (!domain) {
      res.status(400).json({ error: "Missing domain" });
      return;
    }

    const config = await upsertSeoConfig({
      teamId: context.activeTeamId,
      companyId: context.company.id,
      domain,
      markets: parseStringArray(req.body?.markets),
      languages: parseStringArray(req.body?.languages),
      competitors: parseStringArray(req.body?.competitors),
      importantSections: parseStringArray(req.body?.importantSections),
      brandKeywords: parseStringArray(req.body?.brandKeywords),
      excludeKeywords: parseStringArray(req.body?.excludeKeywords),
      createdByUserId: context.userId,
    });

    res.json({ ok: true, config });
  } catch (err) {
    handleSeoAgentError("POST /api/companies/:companyId/seo-config", err, res);
  }
});

router.patch("/api/companies/:companyId/seo-config", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const context = await getSeoRequestContext(req, res, req.params.companyId);
    if (!context) return;

    if (!getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const config = await findSeoConfigByCompany(context.activeTeamId, context.company.id);
    if (!config) {
      res.status(404).json({ error: "SEO config not found" });
      return;
    }

    await patchSeoConfig(config.id, {
      domain: typeof req.body?.domain === "string" ? req.body.domain.trim() : undefined,
      markets: Array.isArray(req.body?.markets) ? parseStringArray(req.body.markets) : undefined,
      languages: Array.isArray(req.body?.languages) ? parseStringArray(req.body.languages) : undefined,
      competitors: Array.isArray(req.body?.competitors) ? parseStringArray(req.body.competitors) : undefined,
      importantSections: Array.isArray(req.body?.importantSections) ? parseStringArray(req.body.importantSections) : undefined,
      brandKeywords: Array.isArray(req.body?.brandKeywords) ? parseStringArray(req.body.brandKeywords) : undefined,
      excludeKeywords: Array.isArray(req.body?.excludeKeywords) ? parseStringArray(req.body.excludeKeywords) : undefined,
    });

    const updated = await findSeoConfigByCompany(context.activeTeamId, context.company.id);
    res.json({ ok: true, config: updated });
  } catch (err) {
    handleSeoAgentError("PATCH /api/companies/:companyId/seo-config", err, res);
  }
});

router.post("/api/ai/seo/analyze", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const companyId = typeof req.body?.companyId === "string" ? req.body.companyId.trim() : "";
    const mode = parseMode(req.body?.mode);
    if (!companyId) {
      res.status(400).json({ error: "Missing companyId" });
      return;
    }
    if (!mode) {
      res.status(400).json({ error: "Invalid mode" });
      return;
    }
    const sources = parseOptionalSources(req.body?.sources);
    if (sources === null) {
      res.status(400).json({ error: "Invalid sources" });
      return;
    }

    const context = await getSeoRequestContext(req, res, companyId);
    if (!context) return;

    if (!getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const config = await findSeoConfigByCompany(context.activeTeamId, context.company.id);
    if (!config) {
      res.status(404).json({ error: "SEO config not found" });
      return;
    }

    const run = await runSeoAnalysis({
      teamId: context.activeTeamId,
      companyId: context.company.id,
      config,
      mode,
      createdByUserId: context.userId,
      sources,
    });

    res.json({ ok: true, run });
  } catch (err) {
    handleSeoAgentError("POST /api/ai/seo/analyze", err, res);
  }
});

router.post("/api/ai/seo/runs/:runId/approve", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const run = await findSeoAnalysisRunById(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }

    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    if (run.teamId !== context.activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if (!getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await approveSeoRun(run.id);
    const updated = await findSeoAnalysisRunById(run.id);
    res.json({
      ok: true,
      run: updated,
      note: "Approval only changes SEO analysis run status. This stage does not create real tasks.",
    });
  } catch (err) {
    handleSeoAgentError("POST /api/ai/seo/runs/:runId/approve", err, res);
  }
});

router.post("/api/ai/seo/runs/:runId/draft-tasks/generate", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const run = await findSeoAnalysisRunById(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }

    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    if (run.teamId !== context.activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if (!getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const draftTasks = await generateSeoDraftTasksForRun(context.activeTeamId, run.id);
    res.json({ ok: true, draftTasks });
  } catch (err) {
    handleSeoAgentError("POST /api/ai/seo/runs/:runId/draft-tasks/generate", err, res);
  }
});

router.get("/api/ai/seo/runs/:runId/draft-tasks", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const run = await findSeoAnalysisRunById(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }

    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    if (run.teamId !== context.activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const draftTasks = await listSeoDraftTasksForRun(context.activeTeamId, run.id);
    res.json({ ok: true, draftTasks });
  } catch (err) {
    handleSeoAgentError("GET /api/ai/seo/runs/:runId/draft-tasks", err, res);
  }
});

router.patch("/api/ai/seo/draft-tasks/:draftTaskId", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set" });
      return;
    }

    const draftTask = await findSeoDraftTaskById(activeTeamId, req.params.draftTaskId);
    if (!draftTask) {
      res.status(404).json({ error: "SEO draft task not found" });
      return;
    }

    const run = await findSeoAnalysisRunById(draftTask.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }

    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    if (!getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const status = parseDraftTaskStatus(req.body?.status);
    if (!status) {
      res.status(400).json({ error: "Invalid draft task status" });
      return;
    }

    const updated = await updateSeoDraftTaskStatus({
      teamId: context.activeTeamId,
      draftTaskId: draftTask.id,
      status,
    });

    res.json({
      ok: true,
      draftTask: updated,
      note: "Approved SEO draft tasks are not real tasks yet.",
    });
  } catch (err) {
    handleSeoAgentError("PATCH /api/ai/seo/draft-tasks/:draftTaskId", err, res);
  }
});

router.post("/api/ai/seo/draft-tasks/:draftTaskId/convert", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set" });
      return;
    }

    const draftTask = await findSeoDraftTaskById(activeTeamId, req.params.draftTaskId);
    if (!draftTask) {
      res.status(404).json({ error: "SEO draft task not found" });
      return;
    }

    const hasCompanyIdField = Object.prototype.hasOwnProperty.call(req.body ?? {}, "companyId");
    const requestedCompanyId =
      req.body?.companyId === null
        ? null
        : typeof req.body?.companyId === "string"
          ? req.body.companyId.trim()
          : "";
    if (hasCompanyIdField && req.body?.companyId !== null && typeof req.body?.companyId !== "string") {
      res.status(400).json({ error: "Invalid companyId" });
      return;
    }
    const accessCompanyId =
      requestedCompanyId === null ? "" : requestedCompanyId || draftTask.suggestedCompanyId || "";

    let role = await getUserRoleInTeam(userId, activeTeamId);
    if (accessCompanyId) {
      const context = await getSeoRequestContext(req, res, accessCompanyId);
      if (!context) return;
      role = context.role;
      if (!getRolePermissions(context.role).edit) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    } else if (!getRolePermissions(role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const priority = parseConvertPriority(req.body?.priority);
    if (priority === null) {
      res.status(400).json({ error: "Invalid priority" });
      return;
    }

    const visibility = parseDraftTaskVisibility(req.body?.visibility);
    if (visibility === null) {
      res.status(400).json({ error: "Invalid visibility" });
      return;
    }

    const conversion = await convertSeoDraftTaskToRealTask({
      teamId: activeTeamId,
      userId,
      draftTaskId: draftTask.id,
      options: {
        companyId: requestedCompanyId === null ? null : requestedCompanyId || undefined,
        assignedUserId: typeof req.body?.assignedUserId === "string" ? req.body.assignedUserId.trim() : undefined,
        dueDate: typeof req.body?.dueDate === "string" ? req.body.dueDate.trim() : undefined,
        visibility,
        priority,
      },
    });

    res.json({
      ok: true,
      task: conversion.task,
      draftTask: conversion.draftTask,
    });
  } catch (err) {
    handleSeoAgentError("POST /api/ai/seo/draft-tasks/:draftTaskId/convert", err, res);
  }
});

export default router;
