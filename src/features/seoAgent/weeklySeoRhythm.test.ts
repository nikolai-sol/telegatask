import { describe, expect, test, vi } from "vitest";
import {
  SEO_WEEKLY_RHYTHM_CRON_FLAG,
  buildSeoWeeklyRhythmWindow,
  buildSeoIsoWeekKey,
  buildLastCompletedSeoWeekAnchorIso,
  runWeeklySeoRhythm,
  shouldRunWeeklySeoRhythmCatchUp,
  type WeeklySeoRhythmRunRecord,
  type WeeklySeoRhythmStore,
} from "./weeklySeoRhythm";

function store(initial?: WeeklySeoRhythmRunRecord | WeeklySeoRhythmRunRecord[]): WeeklySeoRhythmStore {
  const records = new Map<string, WeeklySeoRhythmRunRecord>();
  const initialRecords = Array.isArray(initial) ? initial : initial ? [initial] : [];
  for (const record of initialRecords) {
    records.set(record.weekKey, { ...record });
  }
  return {
    async getRun(input) {
      return records.get(input.weekKey) || null;
    },
    async createRun(next) {
      records.set(next.weekKey, { ...next });
      return records.get(next.weekKey) as WeeklySeoRhythmRunRecord;
    },
    async updateRun(input) {
      const record = { ...(records.get(input.weekKey) as WeeklySeoRhythmRunRecord), ...input.patch };
      records.set(input.weekKey, record);
      return record;
    },
  };
}

function deps(overrides: Partial<Parameters<typeof runWeeklySeoRhythm>[0]["deps"]> = {}) {
  return {
    store: store(),
    buildTrackingList: vi.fn(async () => [{ query: "q1" }, { query: "q2" }]),
    runRankTracking: vi.fn(async () => ({ requestCount: 2, recordsWritten: 2, artifact: { rank: true } })),
    buildGapDigest: vi.fn(async () => ({
      opportunityCount: 1,
      messages: [{ text: "digest", buttons: [] }],
      artifact: { gap: true },
    })),
    sendDigest: vi.fn(async () => [{ messageId: 101 }]),
    sendServiceMessage: vi.fn(async () => ({ messageId: 999 })),
    writeArtifact: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("weeklySeoRhythm", () => {
  test("builds stable ISO week keys", () => {
    expect(buildSeoIsoWeekKey("2026-07-10T12:00:00.000Z")).toBe("2026-W28");
  });

  test("anchors Monday cron runs to the last completed SEO week", () => {
    const anchor = buildLastCompletedSeoWeekAnchorIso("2026-07-13T09:00:00.000Z");

    expect(buildSeoIsoWeekKey(anchor)).toBe("2026-W28");
  });

  test("splits Monday run week from the completed data week", () => {
    expect(buildSeoWeeklyRhythmWindow("2026-07-20T07:00:00.000Z")).toMatchObject({
      runWeekKey: "2026-W30",
      dataWeekKey: "2026-W29",
      runId: "seo_weekly_2026-W30",
    });
  });

  test("Monday run idempotency uses run week and does not noop on completed data week", async () => {
    const d = deps({
      store: store({
        weekKey: "2026-W29",
        runId: "seo_weekly_2026-W29",
        status: "completed",
        lockOwner: null,
        startedAt: "2026-07-13T09:00:00.000Z",
        completedAt: "2026-07-13T09:05:00.000Z",
        failedAt: null,
        failureStage: null,
        failureMessage: null,
        digestMessageIds: [301],
        artifactPath: "reports/w29.json",
      }),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-20T07:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
      window: buildSeoWeeklyRhythmWindow("2026-07-20T07:00:00.000Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.runId).toBe("seo_weekly_2026-W30");
    expect(result.weekKey).toBe("2026-W30");
    expect(result.artifact).toMatchObject({
      weekKey: "2026-W29",
      dataWeekKey: "2026-W29",
      runWeekKey: "2026-W30",
      runId: "seo_weekly_2026-W30",
    });
    expect(d.runRankTracking).toHaveBeenCalledWith(expect.objectContaining({
      runId: "seo_weekly_2026-W30",
      weekKey: "2026-W29",
      dataWeekKey: "2026-W29",
      runWeekKey: "2026-W30",
    }));
    expect(d.sendDigest).toHaveBeenCalledTimes(1);
  });

  test("catch-up runs only after the configured weekly slot and master flag", () => {
    expect(shouldRunWeeklySeoRhythmCatchUp({
      now: "2026-07-20T06:30:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      timeZone: "Europe/Vienna",
    })).toBe(false);
    expect(shouldRunWeeklySeoRhythmCatchUp({
      now: "2026-07-20T07:30:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      timeZone: "Europe/Vienna",
    })).toBe(true);
    expect(shouldRunWeeklySeoRhythmCatchUp({
      now: "2026-07-20T07:30:00.000Z",
      env: {},
      timeZone: "Europe/Vienna",
    })).toBe(false);
  });

  test("master flag off disables cron behavior entirely", async () => {
    const d = deps();
    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: {},
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
    });

    expect(result.status).toBe("disabled");
    expect(d.buildTrackingList).not.toHaveBeenCalled();
    expect(d.sendDigest).not.toHaveBeenCalled();
  });

  test("completed same-week run is a no-op and sends no duplicate digest", async () => {
    const d = deps({
      store: store({
        weekKey: "2026-W28",
        runId: "seo_weekly_2026-W28",
        status: "completed",
        lockOwner: null,
        startedAt: "2026-07-10T10:00:00.000Z",
        completedAt: "2026-07-10T10:05:00.000Z",
        failedAt: null,
        failureStage: null,
        failureMessage: null,
        digestMessageIds: [101],
        artifactPath: "reports/existing.json",
      }),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
    });

    expect(result.status).toBe("noop");
    expect(d.runRankTracking).not.toHaveBeenCalled();
    expect(d.sendDigest).not.toHaveBeenCalled();
  });

  test("stage failure sends service message and no partial digest", async () => {
    const d = deps({
      runRankTracking: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
    });

    expect(result.status).toBe("failed");
    expect(result.failureStage).toBe("rank_tracking");
    expect(d.sendServiceMessage).toHaveBeenCalledWith(expect.stringContaining("прогон не завершён: этап rank_tracking"));
    expect(d.sendDigest).not.toHaveBeenCalled();
  });

  test("budget cap is enforced before SERP calls", async () => {
    const d = deps({
      buildTrackingList: vi.fn(async () => [{ query: "q1" }, { query: "q2" }, { query: "q3" }]),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 2 },
      deps: d,
    });

    expect(result.status).toBe("failed");
    expect(result.failureStage).toBe("budget");
    expect(d.runRankTracking).not.toHaveBeenCalled();
    expect(d.sendDigest).not.toHaveBeenCalled();
  });

  test("optional global report failure does not fail the weekly rhythm chain", async () => {
    const d = deps({
      buildGlobalReport: vi.fn(async () => {
        throw new Error("Metrika quota exhausted");
      }),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
    });

    expect(result.status).toBe("completed");
    expect(result.failureStage).toBeNull();
    expect(result.artifact?.globalReport).toMatchObject({
      status: "failed",
      metrikaStatus: "unavailable",
      failureMessage: "Metrika quota exhausted",
    });
    expect(result.artifact?.stages).toContainEqual({
      stage: "global_report",
      status: "skipped",
      message: "Metrika quota exhausted",
    });
    expect(d.sendDigest).toHaveBeenCalledTimes(1);
    expect(d.sendServiceMessage).not.toHaveBeenCalled();
  });

  test("optional dashboard export runs after the global report and records exported status", async () => {
    const exportDashboard = vi.fn(async () => ({
      status: "exported" as const,
      path: "reports/dashboard-export.json",
      error: null,
    }));
    const d = deps({
      buildGlobalReport: vi.fn(async () => ({
        path: "reports/global-report.json",
        metrikaStatus: "available" as const,
      })),
      exportDashboard,
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-20T07:10:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
      window: buildSeoWeeklyRhythmWindow("2026-07-20T07:10:00.000Z"),
    });

    expect(exportDashboard).toHaveBeenCalledWith(expect.objectContaining({
      weekKey: "2026-W29",
      runWeekKey: "2026-W30",
      dataWeekKey: "2026-W29",
      runId: "seo_weekly_2026-W30",
      globalReportPath: "reports/global-report.json",
    }));
    expect(result.status).toBe("completed");
    expect(result.artifact?.dashboardExport).toEqual({
      status: "exported",
      path: "reports/dashboard-export.json",
      failureMessage: null,
    });
    expect(result.artifact?.stages).toContainEqual({
      stage: "dashboard_export",
      status: "completed",
      message: undefined,
    });
  });

  test("optional dashboard export failure leaves the week completed and marks export pending", async () => {
    const d = deps({
      exportDashboard: vi.fn(async () => {
        throw new Error("mysql unavailable");
      }),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
    });

    expect(result.status).toBe("completed");
    expect(result.failureStage).toBeNull();
    expect(result.artifact?.dashboardExport).toMatchObject({
      status: "export_pending",
      path: null,
      failureMessage: "mysql unavailable",
    });
    expect(result.artifact?.stages).toContainEqual({
      stage: "dashboard_export",
      status: "skipped",
      message: "mysql unavailable",
    });
  });

  test("includes optional GSC search performance collection in the weekly artifact", async () => {
    const d = deps({
      collectSearchPerformance: vi.fn(async () => ({
        records: 3,
        opportunities: 1,
        artifact: {
          schemaVersion: "seo_os_weekly_search_performance_v1",
          source: "gsc",
        },
      })),
    });

    const result = await runWeeklySeoRhythm({
      now: "2026-07-10T12:00:00.000Z",
      env: { [SEO_WEEKLY_RHYTHM_CRON_FLAG]: "1" },
      config: { weeklyRunMaxSerpRequests: 10 },
      deps: d,
    });

    expect(result.status).toBe("completed");
    expect(d.collectSearchPerformance).toHaveBeenCalledWith(expect.objectContaining({
      runId: "seo_weekly_2026-W28",
      weekKey: "2026-W28",
    }));
    expect(result.artifact?.counters.searchPerformanceRecords).toBe(3);
    expect(result.artifact?.counters.searchPerformanceOpportunities).toBe(1);
    expect(result.artifact?.searchPerformanceArtifact).toMatchObject({
      schemaVersion: "seo_os_weekly_search_performance_v1",
      source: "gsc",
    });
    expect(result.artifact?.stages).toContainEqual({ stage: "search_performance", status: "completed" });
  });
});
