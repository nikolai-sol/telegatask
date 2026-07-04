import { assembleWeeklyTop10Digest } from "./weeklyTop10Assembly";
import type { WeeklyTop10Digest, WeeklyTop10GeneratorConfig, WeeklyTop10OpportunityInput } from "./weeklyTop10Generator";
import {
  loadWeeklyTop10AssemblySnapshot,
  type WeeklyTop10SnapshotRepositoryReaders,
} from "./weeklyTop10SnapshotRepository";
import type { SeoOpportunity } from "./types";

export type WeeklyTop10DryRunInput = {
  teamId: string;
  runId: string;
  opportunities: SeoOpportunity[];
  readers: WeeklyTop10SnapshotRepositoryReaders;
  config?: Partial<WeeklyTop10GeneratorConfig>;
};

export type WeeklyTop10DryRunResult = {
  mode: "dry_run";
  teamId: string;
  runId: string;
  inputs: WeeklyTop10OpportunityInput[];
  digest: WeeklyTop10Digest;
  snapshotCounts: {
    opportunities: number;
    draftTasks: number;
    implementationTasks: number;
  };
  sideEffects: {
    persisted: false;
    sent: false;
    productionPipelineRun: false;
  };
};

export type WeeklyTop10DryRunServiceContract = {
  mode: "dry_run";
  requiresInjectedReaders: true;
  writes: [];
  sendsNotifications: false;
  runsProductionPipeline: false;
  notes: string[];
};

export const WEEKLY_TOP10_DRY_RUN_SERVICE_CONTRACT: WeeklyTop10DryRunServiceContract = {
  mode: "dry_run",
  requiresInjectedReaders: true,
  writes: [],
  sendsNotifications: false,
  runsProductionPipeline: false,
  notes: [
    "This boundary loads snapshots through injected readers only.",
    "It assembles and returns a Weekly Top-10 digest without persistence.",
    "It does not send Telegram notifications.",
    "It does not run the production SEO pipeline.",
  ],
};

export async function runWeeklyTop10DryRun(input: WeeklyTop10DryRunInput): Promise<WeeklyTop10DryRunResult> {
  const snapshot = await loadWeeklyTop10AssemblySnapshot(input.readers, {
    teamId: input.teamId,
    runId: input.runId,
    opportunities: input.opportunities,
  });
  const assembled = assembleWeeklyTop10Digest({
    ...snapshot,
    config: input.config,
  });

  return {
    mode: "dry_run",
    teamId: input.teamId,
    runId: input.runId,
    inputs: assembled.inputs,
    digest: assembled.digest,
    snapshotCounts: {
      opportunities: snapshot.opportunities.length,
      draftTasks: snapshot.draftTasks.length,
      implementationTasks: snapshot.implementationTasks.length,
    },
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    },
  };
}
