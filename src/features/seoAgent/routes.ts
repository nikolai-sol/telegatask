import { Router, Request, Response } from "express";
import { webAppAuthMiddleware } from "../../middleware/validateWebApp";
import { getCompanyById } from "../../repositories/companyRepository";
import { isCompanyMember } from "../../repositories/companyMemberRepository";
import { getUserById, getUserByTelegramId, updateUserActiveTeamId } from "../../repositories/userRepository";
import { listTeamsByMemberId } from "../../repositories/teamRepository";
import { getRolePermissions, getUserRoleInTeam } from "../../core/permissions/campaignPermissions";
import { canAccessCompany } from "../../core/permissions/companyAccess";
import { listCampaignsByTeamId } from "../../repositories/campaignRepository";
import { findSeoAnalysisRunById, findSeoAnalysisRunByTeamAndId, listSeoAnalysisRunsByTeamId } from "./seoAnalysisRunRepository";
import { findSeoDraftTaskById, listSeoDraftTasksByRun } from "./seoDraftTaskRepository";
import { getStoredGscCredential, upsertStoredGscCredential } from "./gscCredentialRepository";
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
import { GoogleSearchConsoleSeoSource } from "./providers/googleSearchConsoleSeoSource";
import {
  buildGoogleSearchConsoleAuthUrl,
  parseGoogleSearchConsoleAuthState,
  resolveConfiguredGscSiteUrl,
  readGoogleSearchConsoleBaseConfig,
} from "./providers/googleSearchConsoleConfig";
import { SeoProviderError, SeoProviderNotConfiguredError } from "./providers/seoDataProvider";
import type {
  SeoAnalysisMode,
  SeoConvertDraftTaskPriority,
  SeoDraftTaskStatus,
  SeoDraftTaskVisibility,
  SeoAnalysisRun,
  SeoDraftTask,
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

function parseOptionalKeywords(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return parseStringArray(value);
}

function parseOptionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = String(value || "").trim();
  return raw || null;
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

function parseOptionalDevice(value: unknown): "desktop" | "mobile" | undefined | null {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = String(value || "").trim();
  if (raw === "desktop" || raw === "mobile") return raw;
  return null;
}

function parseIdSelection(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  );
}

function isLocalOnlyRequest(req: Request): boolean {
  const host = String(req.headers.host || "").toLowerCase();
  const ip = String(req.ip || "").toLowerCase();
  return (
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "127.0.0.1"
  );
}

function requireLocalOnlyRequest(req: Request, res: Response): boolean {
  if (isLocalOnlyRequest(req)) return true;
  res.status(403).json({ error: "This Google Search Console OAuth route is local-only" });
  return false;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type SeoDashboardPosition = {
  engine: "google" | "yandex";
  query: string;
  currentPosition: number | null;
  previousPosition: number | null;
  delta: number | null;
  matchedUrl: string | null;
  found: boolean;
};

function sourceStepStatus(run: SeoAnalysisRun, source: string): "success" | "partial" | "failed" | "skipped" {
  const status = run.sourceStatuses.find((item) => item.source === source)?.status;
  return status || "skipped";
}

function buildSeoDashboardSteps(run: SeoAnalysisRun, draftTasks: SeoDraftTask[]) {
  return [
    {
      id: "crawl",
      title: "Crawl",
      status: sourceStepStatus(run, "crawler"),
      detail: run.crawler.httpStatus ? `HTTP ${run.crawler.httpStatus}` : "No crawl data",
    },
    {
      id: "performance",
      title: "Speed",
      status: sourceStepStatus(run, "pagespeed"),
      detail:
        run.pagespeed.performanceScore !== null
          ? `Performance ${run.pagespeed.performanceScore}`
          : "No PageSpeed source",
    },
    {
      id: "gsc",
      title: "GSC",
      status: sourceStepStatus(run, "gsc"),
      detail:
        run.searchConsole.impressions !== null
          ? `${run.searchConsole.impressions} impressions`
          : "No Search Console data",
    },
    {
      id: "yandex-webmaster",
      title: "Yandex WM",
      status: sourceStepStatus(run, "yandex_webmaster"),
      detail:
        run.yandexWebmaster.impressions !== null
          ? `${run.yandexWebmaster.impressions} impressions`
          : "No Yandex Webmaster data",
    },
    {
      id: "rank",
      title: "Rank",
      status:
        run.sourceStatuses.some(
          (item) =>
            (item.source === "google_serp_rank" || item.source === "yandex_serp_rank") &&
            (item.status === "success" || item.status === "partial")
        )
          ? "success"
          : "skipped",
      detail: `${(run.rankTracking.google?.checks.length || 0) + (run.rankTracking.yandex?.checks.length || 0)} checks`,
    },
    {
      id: "harness",
      title: "Harness",
      status: run.harness.blockedActions.length > 0 || run.harness.warnings.length > 0 ? "partial" : "success",
      detail: `${run.harness.selectedSkills.length} skills, ${run.harness.blockedActions.length} blocked`,
    },
    {
      id: "drafts",
      title: "Drafts",
      status: draftTasks.length > 0 ? "success" : "skipped",
      detail: `${draftTasks.length} draft tasks`,
    },
  ];
}

function rankChecks(run: SeoAnalysisRun) {
  return [
    ...(run.rankTracking.google?.checks || []),
    ...(run.rankTracking.yandex?.checks || []),
  ];
}

function buildPositionChanges(latest: SeoAnalysisRun, previous: SeoAnalysisRun | null): SeoDashboardPosition[] {
  const previousByKey = new Map<string, ReturnType<typeof rankChecks>[number]>();
  for (const check of previous ? rankChecks(previous) : []) {
    previousByKey.set(`${check.searchEngine}:${check.query.toLowerCase()}`, check);
  }

  return rankChecks(latest)
    .map((check) => {
      const prev = previousByKey.get(`${check.searchEngine}:${check.query.toLowerCase()}`) || null;
      const currentPosition = check.found && typeof check.position === "number" ? check.position : null;
      const previousPosition = prev?.found && typeof prev.position === "number" ? prev.position : null;
      const delta =
        currentPosition !== null && previousPosition !== null ? previousPosition - currentPosition : null;
      return {
        engine: check.searchEngine,
        query: check.query,
        currentPosition,
        previousPosition,
        delta,
        matchedUrl: check.matchedUrl || null,
        found: check.found,
      };
    })
    .slice(0, 12);
}

function taskLogEntry(task: SeoDraftTask, run: SeoAnalysisRun) {
  return {
    id: task.id,
    runId: run.id,
    runCreatedAt: run.createdAt,
    title: task.title,
    status: task.status,
    priority: task.priority,
    sourceFindingId: task.sourceFindingId,
    evidenceCount: task.evidence.length,
    labels: task.labels,
    realTaskId: task.realTaskId,
    convertedAt: task.convertedAt,
    createdAt: task.createdAt,
  };
}

async function exchangeOAuthCodeForTokens(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
}> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || typeof json.access_token !== "string") {
    throw new SeoProviderError({
      category: "gsc_oauth_callback",
      statusCode: 502,
      safeMessage: "Google OAuth code exchange failed",
      internalCause: {
        status: response.status,
        body: json,
      },
    });
  }

  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    scope: typeof json.scope === "string" ? json.scope : null,
    tokenType: typeof json.token_type === "string" ? json.token_type : null,
  };
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

router.get("/api/gsc/oauth/start", async (req: Request, res: Response) => {
  try {
    if (!requireLocalOnlyRequest(req, res)) return;

    const requested = typeof req.query.siteUrl === "string" ? req.query.siteUrl : typeof req.query.domain === "string" ? req.query.domain : "";
    const teamId = typeof req.query.teamId === "string" ? req.query.teamId.trim() : "";
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
    if (!requested.trim() || !teamId || !companyId) {
      res.status(400).json({ error: "Provide domain/siteUrl, teamId, and companyId" });
      return;
    }
    const company = await getCompanyById(companyId);
    if (!company || company.teamId !== teamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const siteUrl = resolveConfiguredGscSiteUrl(requested);
    const authUrl = buildGoogleSearchConsoleAuthUrl(siteUrl, teamId, companyId);

    if (String(req.query.redirect || "") === "1") {
      res.redirect(302, authUrl);
      return;
    }

    res.json({ ok: true, siteUrl, authUrl });
  } catch (err) {
    handleSeoAgentError("GET /api/gsc/oauth/start", err, res);
  }
});

router.get("/api/gsc/oauth/status", async (req: Request, res: Response) => {
  try {
    if (!requireLocalOnlyRequest(req, res)) return;

    const teamId = typeof req.query.teamId === "string" ? req.query.teamId.trim() : "";
    if (!teamId) {
      res.status(400).json({ error: "Provide teamId" });
      return;
    }
    const credential = await getStoredGscCredential(teamId);
    const baseConfig = readGoogleSearchConsoleBaseConfig();
    res.json({
      ok: true,
      configuredSiteUrls: baseConfig.configuredSiteUrls,
      redirectUri: baseConfig.redirectUri,
      hasStoredRefreshToken: Boolean(credential?.refreshToken),
      verifiedSiteUrls: credential?.verifiedSiteUrls || [],
      lastValidatedSiteUrl: credential?.lastValidatedSiteUrl || null,
      updatedAt: credential?.updatedAt || null,
    });
  } catch (err) {
    handleSeoAgentError("GET /api/gsc/oauth/status", err, res);
  }
});

router.get("/api/gsc/oauth/callback", async (req: Request, res: Response) => {
  try {
    if (!requireLocalOnlyRequest(req, res)) return;

    const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
    const error = typeof req.query.error === "string" ? req.query.error.trim() : "";
    const state = typeof req.query.state === "string" ? req.query.state.trim() : "";

    if (error) {
      res.status(400).send(`<h1>Google OAuth failed</h1><pre>${escapeHtml(error)}</pre>`);
      return;
    }
    if (!code || !state) {
      res.status(400).send("<h1>Missing code or state</h1>");
      return;
    }

    const parsedState = parseGoogleSearchConsoleAuthState(state);
    const baseConfig = readGoogleSearchConsoleBaseConfig();
    const oauthToken = await exchangeOAuthCodeForTokens({
      code,
      clientId: baseConfig.clientId,
      clientSecret: baseConfig.clientSecret,
      redirectUri: baseConfig.redirectUri,
    });

    const stored = await getStoredGscCredential(parsedState.teamId);
    const refreshToken = oauthToken.refreshToken || stored?.refreshToken || "";
    if (!refreshToken) {
      throw new SeoProviderNotConfiguredError(
        "Google OAuth callback did not return a refresh token. Re-run consent with prompt=consent."
      );
    }

    const requestedDomain = parsedState.siteUrl.startsWith("sc-domain:")
      ? parsedState.siteUrl
      : new URL(parsedState.siteUrl).hostname;

    const smoke = await new GoogleSearchConsoleSeoSource().smokeTest(requestedDomain, {
      teamId: parsedState.teamId,
      siteUrl: parsedState.siteUrl,
      refreshTokenOverride: refreshToken,
    });
    const saved = await upsertStoredGscCredential({
      teamId: parsedState.teamId,
      refreshToken,
      scope: oauthToken.scope,
      tokenType: oauthToken.tokenType,
      verifiedSiteUrls: smoke.verifiedSiteUrls,
      lastValidatedSiteUrl: smoke.snapshot.siteUrl,
    });
    const config = await findSeoConfigByCompany(parsedState.teamId, parsedState.companyId);
    if (config) {
      await patchSeoConfig(config.id, { gscSiteUrl: smoke.snapshot.siteUrl });
    }

    res.status(200).send(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>GSC Connected</title></head>
  <body style="font-family: sans-serif; padding: 24px; line-height: 1.5;">
    <h1>Google Search Console connected</h1>
    <p>Stored refresh token and completed a live smoke query.</p>
    <ul>
      <li><strong>Property:</strong> ${escapeHtml(smoke.snapshot.siteUrl || "")}</li>
      <li><strong>Clicks:</strong> ${escapeHtml(String(smoke.snapshot.clicks ?? 0))}</li>
      <li><strong>Impressions:</strong> ${escapeHtml(String(smoke.snapshot.impressions ?? 0))}</li>
      <li><strong>Top queries:</strong> ${escapeHtml(smoke.snapshot.topQueries.slice(0, 5).join(", ") || "none")}</li>
      <li><strong>Verified properties visible to token:</strong> ${escapeHtml(String(saved.verifiedSiteUrls.length))}</li>
    </ul>
    <p>You can close this tab.</p>
  </body>
</html>`);
  } catch (err) {
    console.error("[seoAgent] GET /api/gsc/oauth/callback error:", err);
    if (err instanceof SeoProviderNotConfiguredError || err instanceof SeoProviderError) {
      res.status(500).send(
        `<!doctype html><html lang="en"><body style="font-family: sans-serif; padding: 24px;"><h1>GSC OAuth failed</h1><pre>${escapeHtml(err.message)}</pre></body></html>`
      );
      return;
    }
    res.status(500).send(
      "<!doctype html><html lang=\"en\"><body style=\"font-family: sans-serif; padding: 24px;\"><h1>GSC OAuth failed</h1><pre>Internal error</pre></body></html>"
    );
  }
});

router.get("/api/gsc/oauth/smoke", async (req: Request, res: Response) => {
  try {
    if (!requireLocalOnlyRequest(req, res)) return;

    const requested = typeof req.query.siteUrl === "string" ? req.query.siteUrl : typeof req.query.domain === "string" ? req.query.domain : "";
    const teamId = typeof req.query.teamId === "string" ? req.query.teamId.trim() : "";
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
    if (!requested.trim() || !teamId || !companyId) {
      res.status(400).json({ error: "Provide domain/siteUrl, teamId, and companyId" });
      return;
    }

    const company = await getCompanyById(companyId);
    if (!company || company.teamId !== teamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const siteUrl = resolveConfiguredGscSiteUrl(requested);
    const smoke = await new GoogleSearchConsoleSeoSource().smokeTest(requested, { teamId, siteUrl });
    await upsertStoredGscCredential({
      teamId,
      refreshToken: (await getStoredGscCredential(teamId))?.refreshToken || "",
      verifiedSiteUrls: smoke.verifiedSiteUrls,
      lastValidatedSiteUrl: smoke.snapshot.siteUrl,
    });
    const config = await findSeoConfigByCompany(teamId, companyId);
    if (config) await patchSeoConfig(config.id, { gscSiteUrl: smoke.snapshot.siteUrl });
    res.json({ ok: true, ...smoke });
  } catch (err) {
    handleSeoAgentError("GET /api/gsc/oauth/smoke", err, res);
  }
});

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
      gscSiteUrl:
        req.body?.gscSiteUrl === undefined
          ? undefined
          : typeof req.body.gscSiteUrl === "string" && req.body.gscSiteUrl.trim()
            ? req.body.gscSiteUrl.trim()
            : null,
      targetDomainAliases: Array.isArray(req.body?.targetDomainAliases) ? parseStringArray(req.body.targetDomainAliases) : undefined,
      markets: Array.isArray(req.body?.markets) ? parseStringArray(req.body.markets) : undefined,
      languages: Array.isArray(req.body?.languages) ? parseStringArray(req.body.languages) : undefined,
      competitors: Array.isArray(req.body?.competitors) ? parseStringArray(req.body.competitors) : undefined,
      importantSections: Array.isArray(req.body?.importantSections) ? parseStringArray(req.body.importantSections) : undefined,
      brandKeywords: Array.isArray(req.body?.brandKeywords) ? parseStringArray(req.body.brandKeywords) : undefined,
      excludeKeywords: Array.isArray(req.body?.excludeKeywords) ? parseStringArray(req.body.excludeKeywords) : undefined,
      trackingKeywords: Array.isArray(req.body?.trackingKeywords) ? parseStringArray(req.body.trackingKeywords) : undefined,
      targetLocation: req.body?.targetLocation === undefined ? undefined : typeof req.body.targetLocation === "string" ? req.body.targetLocation.trim() : null,
      targetRegion: req.body?.targetRegion === undefined ? undefined : typeof req.body.targetRegion === "string" ? req.body.targetRegion.trim() : null,
      targetDevice: parseOptionalDevice(req.body?.targetDevice) ?? undefined,
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
      gscSiteUrl:
        req.body?.gscSiteUrl === undefined
          ? undefined
          : typeof req.body.gscSiteUrl === "string" && req.body.gscSiteUrl.trim()
            ? req.body.gscSiteUrl.trim()
            : null,
      targetDomainAliases: Array.isArray(req.body?.targetDomainAliases) ? parseStringArray(req.body.targetDomainAliases) : undefined,
      markets: Array.isArray(req.body?.markets) ? parseStringArray(req.body.markets) : undefined,
      languages: Array.isArray(req.body?.languages) ? parseStringArray(req.body.languages) : undefined,
      competitors: Array.isArray(req.body?.competitors) ? parseStringArray(req.body.competitors) : undefined,
      importantSections: Array.isArray(req.body?.importantSections) ? parseStringArray(req.body.importantSections) : undefined,
      brandKeywords: Array.isArray(req.body?.brandKeywords) ? parseStringArray(req.body.brandKeywords) : undefined,
      excludeKeywords: Array.isArray(req.body?.excludeKeywords) ? parseStringArray(req.body.excludeKeywords) : undefined,
      trackingKeywords: Array.isArray(req.body?.trackingKeywords) ? parseStringArray(req.body.trackingKeywords) : undefined,
      targetLocation: req.body?.targetLocation !== undefined ? (typeof req.body?.targetLocation === "string" ? req.body.targetLocation.trim() : null) : undefined,
      targetRegion: req.body?.targetRegion !== undefined ? (typeof req.body?.targetRegion === "string" ? req.body.targetRegion.trim() : null) : undefined,
      targetDevice: parseOptionalDevice(req.body?.targetDevice),
    });

    const updated = await findSeoConfigByCompany(context.activeTeamId, context.company.id);
    res.json({ ok: true, config: updated });
  } catch (err) {
    handleSeoAgentError("PATCH /api/companies/:companyId/seo-config", err, res);
  }
});

router.get("/api/ai/seo/dashboard", webAppAuthMiddleware, async (req: Request, res: Response) => {
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

    const role = await getUserRoleInTeam(userId, activeTeamId);
    const campaigns = await listCampaignsByTeamId(activeTeamId, 200);
    const campaignsById = new Map(campaigns.map((item) => [item.id, item]));
    const runs = await listSeoAnalysisRunsByTeamId(activeTeamId, 120);
    const draftTasksByRun = new Map<string, SeoDraftTask[]>();

    await Promise.all(
      runs.map(async (run) => {
        draftTasksByRun.set(run.id, await listSeoDraftTasksByRun(activeTeamId, run.id));
      })
    );

    const grouped = new Map<string, SeoAnalysisRun[]>();
    for (const run of runs) {
      const key = `${run.companyId}:${run.domain}`;
      grouped.set(key, [...(grouped.get(key) || []), run]);
    }

    const projects = Array.from(grouped.entries()).map(([key, projectRuns]) => {
      const sorted = [...projectRuns].sort((a, b) => b.createdAt - a.createdAt);
      const latest = sorted[0];
      const previous = sorted[1] || null;
      const draftTasks = sorted.flatMap((run) => draftTasksByRun.get(run.id) || []);
      const latestDraftTasks = draftTasksByRun.get(latest.id) || [];
      const campaign = campaignsById.get(latest.companyId);
      const taskLog = sorted
        .flatMap((run) => (draftTasksByRun.get(run.id) || []).map((task) => taskLogEntry(task, run)))
        .sort((a, b) => {
          const aTime = Date.parse(a.createdAt || "") || a.runCreatedAt;
          const bTime = Date.parse(b.createdAt || "") || b.runCreatedAt;
          return bTime - aTime;
        })
        .slice(0, 20);

      return {
        key,
        companyId: latest.companyId,
        teamId: latest.teamId,
        projectName: campaign?.name || latest.domain,
        projectStatus: campaign?.status || "unknown",
        domain: latest.domain,
        latestRunId: latest.id,
        latestRunCreatedAt: latest.createdAt,
        runCount: sorted.length,
        steps: buildSeoDashboardSteps(latest, latestDraftTasks),
        positionChanges: buildPositionChanges(latest, previous),
        taskLog,
        warnings: latest.harness.warnings,
        blockedActions: latest.harness.blockedActions,
        confidenceSummary: latest.harness.confidenceSummary,
        findings: latest.findings,
      };
    });

    res.json({
      ok: true,
      activeTeamId,
      activeTeamRole: role,
      projects: projects.sort((a, b) => b.latestRunCreatedAt - a.latestRunCreatedAt),
    });
  } catch (err) {
    handleSeoAgentError("GET /api/ai/seo/dashboard", err, res);
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
    const keywords = parseOptionalKeywords(req.body?.keywords);
    if (keywords === null) {
      res.status(400).json({ error: "Invalid keywords" });
      return;
    }
    const region = parseOptionalString(req.body?.region);
    const language = parseOptionalString(req.body?.language);
    const location = parseOptionalString(req.body?.location);
    const device = parseOptionalDevice(req.body?.device);
    if (device === null && req.body?.device !== undefined && req.body?.device !== null && req.body?.device !== "") {
      res.status(400).json({ error: "Invalid device" });
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
      keywords,
      location,
      region,
      language,
      device: device ?? null,
    });
    const draftTasks = await listSeoDraftTasksForRun(context.activeTeamId, run.id);

    res.json({ ok: true, run, draftTasks });
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

    await approveSeoRun(context.activeTeamId, run.id);
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

router.get("/api/ai/seo/runs/:runId", webAppAuthMiddleware, async (req: Request, res: Response) => {
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
    const run = await findSeoAnalysisRunByTeamAndId(activeTeamId, req.params.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }
    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    const draftTasks = await listSeoDraftTasksForRun(activeTeamId, run.id);
    res.json({ ok: true, run, draftTasks });
  } catch (err) {
    handleSeoAgentError("GET /api/ai/seo/runs/:runId", err, res);
  }
});

router.post("/api/ai/seo/runs/:runId/recommended-tasks/approve", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const selectedIds = parseIdSelection(req.body?.draftTaskIds);
    if (!selectedIds || selectedIds.length === 0) {
      res.status(400).json({ error: "Select at least one draftTaskId" });
      return;
    }
    const run = await findSeoAnalysisRunById(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }
    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    if (run.teamId !== context.activeTeamId || !getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const runDrafts = await listSeoDraftTasksForRun(context.activeTeamId, run.id);
    const draftsById = new Map(runDrafts.map((task) => [task.id, task]));
    if (selectedIds.some((id) => !draftsById.has(id))) {
      res.status(400).json({ error: "One or more selected draft tasks do not belong to this run" });
      return;
    }

    const created = [];
    for (const draftTaskId of selectedIds) {
      await updateSeoDraftTaskStatus({ teamId: context.activeTeamId, draftTaskId, status: "approved" });
      created.push(
        await convertSeoDraftTaskToRealTask({
          teamId: context.activeTeamId,
          userId: context.userId,
          draftTaskId,
          options: { companyId: run.companyId, visibility: "team" },
        })
      );
    }
    await approveSeoRun(context.activeTeamId, run.id);
    res.json({ ok: true, approvedCount: created.length, results: created });
  } catch (err) {
    handleSeoAgentError("POST /api/ai/seo/runs/:runId/recommended-tasks/approve", err, res);
  }
});

router.post("/api/ai/seo/runs/:runId/recommended-tasks/reject", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const selectedIds = parseIdSelection(req.body?.draftTaskIds);
    if (!selectedIds || selectedIds.length === 0) {
      res.status(400).json({ error: "Select at least one draftTaskId" });
      return;
    }
    const run = await findSeoAnalysisRunById(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "SEO analysis run not found" });
      return;
    }
    const context = await getSeoRequestContext(req, res, run.companyId);
    if (!context) return;
    if (run.teamId !== context.activeTeamId || !getRolePermissions(context.role).edit) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const runDrafts = await listSeoDraftTasksForRun(context.activeTeamId, run.id);
    const draftsById = new Map(runDrafts.map((task) => [task.id, task]));
    if (selectedIds.some((id) => !draftsById.has(id))) {
      res.status(400).json({ error: "One or more selected draft tasks do not belong to this run" });
      return;
    }
    const rejected = await Promise.all(
      selectedIds.map((draftTaskId) =>
        updateSeoDraftTaskStatus({ teamId: context.activeTeamId, draftTaskId, status: "rejected" })
      )
    );
    res.json({ ok: true, rejectedCount: rejected.length, draftTasks: rejected });
  } catch (err) {
    handleSeoAgentError("POST /api/ai/seo/runs/:runId/recommended-tasks/reject", err, res);
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
    if (requestedCompanyId === null || (requestedCompanyId && requestedCompanyId !== draftTask.companyId)) {
      res.status(400).json({ error: "SEO draft tasks must be created for their analysis Company" });
      return;
    }
    const context = await getSeoRequestContext(req, res, draftTask.companyId);
    if (!context) return;
    if (!getRolePermissions(context.role).edit) {
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
        companyId: draftTask.companyId,
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
