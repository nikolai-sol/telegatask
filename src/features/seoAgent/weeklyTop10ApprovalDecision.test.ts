import { describe, expect, test } from "vitest";
import opportunitiesFixture from "./fixtures/weeklyTop10ApprovalDecision/opportunities.json";
import type { SeoOpportunity } from "./types";
import {
  buildWeeklyTop10ApprovalDecisionId,
  buildWeeklyTop10InputsFromApprovalDecisions,
  buildWeeklyTop10OpportunityId,
  persistWeeklyTop10ApprovalDecision,
  type WeeklyTop10ApprovalDecisionRecord,
  type WeeklyTop10ApprovalDecisionStore,
} from "./weeklyTop10ApprovalDecision";
import { generateWeeklyTop10Digest } from "./weeklyTop10Generator";

function memoryStore(seed: WeeklyTop10ApprovalDecisionRecord[] = []): WeeklyTop10ApprovalDecisionStore & {
  records: WeeklyTop10ApprovalDecisionRecord[];
} {
  const records = [...seed];
  return {
    records,
    async getDecision(input) {
      return records.find((record) => record.teamId === input.teamId && record.opportunityId === input.opportunityId) || null;
    },
    async createDecision(record) {
      records.push(record);
      return record;
    },
  };
}

describe("weeklyTop10ApprovalDecision", () => {
  const opportunities = opportunitiesFixture as SeoOpportunity[];

  test("persists an approval decision once and returns idempotent already-decided result", async () => {
    const opportunityId = buildWeeklyTop10OpportunityId(opportunities[0]);
    const store = memoryStore();
    const first = await persistWeeklyTop10ApprovalDecision(store, {
      writesEnabled: true,
      teamId: "zaruku",
      runId: "run1",
      opportunityId,
      clusterId: "query_cluster_001",
      draftTaskId: "d1",
      decision: "approved",
      reviewer: { userId: "telegram:2779103", telegramUserId: 2779103 },
      decidedAt: "2026-07-10T12:01:00.000Z",
      callbackData: "seo10:v1:a:zaruku:run1:d1",
    });
    const second = await persistWeeklyTop10ApprovalDecision(store, {
      writesEnabled: true,
      teamId: "zaruku",
      runId: "run1",
      opportunityId,
      clusterId: "query_cluster_001",
      draftTaskId: "d1",
      decision: "rejected",
      rejectReason: "duplicate click",
      reviewer: { userId: "telegram:2779103", telegramUserId: 2779103 },
      decidedAt: "2026-07-10T12:02:00.000Z",
      callbackData: "seo10:v1:r:zaruku:run1:d1",
    });

    expect(first.status).toBe("created");
    expect(first.decision).toMatchObject({
      id: buildWeeklyTop10ApprovalDecisionId({ teamId: "zaruku", opportunityId }),
      decision: "approved",
      rejectReason: null,
    });
    expect(second.status).toBe("already_decided");
    expect(second.answerText).toBe("Уже решено: одобрено.");
    expect(store.records).toHaveLength(1);
  });

  test("does not write when the explicit persistence flag is disabled", async () => {
    const store = memoryStore();
    const result = await persistWeeklyTop10ApprovalDecision(store, {
      writesEnabled: false,
      teamId: "zaruku",
      runId: "run1",
      opportunityId: buildWeeklyTop10OpportunityId(opportunities[0]),
      decision: "approved",
      reviewer: { userId: "telegram:2779103", telegramUserId: 2779103 },
      decidedAt: "2026-07-10T12:01:00.000Z",
    });

    expect(result.status).toBe("writes_disabled");
    expect(result.sideEffects.firestoreWrite).toBe(false);
    expect(store.records).toHaveLength(0);
  });

  test("maps decided opportunities out of the next digest and marks previous undecided opportunities as carried over", () => {
    const approvedOpportunityId = buildWeeklyTop10OpportunityId(opportunities[0]);
    const carriedOpportunityId = buildWeeklyTop10OpportunityId(opportunities[1]);
    const decisions: WeeklyTop10ApprovalDecisionRecord[] = [
      {
        id: buildWeeklyTop10ApprovalDecisionId({ teamId: "zaruku", opportunityId: approvedOpportunityId }),
        teamId: "zaruku",
        runId: "run1",
        opportunityId: approvedOpportunityId,
        clusterId: "query_cluster_001",
        draftTaskId: "d1",
        decision: "approved",
        rejectReason: null,
        reviewer: { userId: "telegram:2779103", telegramUserId: 2779103 },
        decidedAt: "2026-07-10T12:01:00.000Z",
        source: "telegram_dev_callback",
        callbackData: null,
      },
    ];

    const inputs = buildWeeklyTop10InputsFromApprovalDecisions({
      opportunities,
      decisions,
      previouslyPresentedOpportunityIds: [approvedOpportunityId, carriedOpportunityId],
    });
    const digest = generateWeeklyTop10Digest(inputs, { now: "2026-07-11T00:00:00.000Z" });

    expect(inputs.map((input) => input.state)).toEqual(["approved", "carried_over"]);
    expect(digest.items).toHaveLength(1);
    expect(digest.items[0].state).toBe("carried_over");
    expect(digest.items[0].title).toContain("онкологический центр");
  });
});
