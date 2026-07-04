import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";

export type WeeklyTop10SnapshotRepositoryContract = {
  opportunities: {
    source: "caller_provided";
    reason: string;
  };
  draftTasks: {
    sourceCollection: "seoDraftTasks";
    readMethod: "listSeoDraftTasksByRun";
    requiredFilters: ["teamId", "runId"];
    readFields: Array<keyof SeoDraftTask>;
  };
  implementationTasks: {
    sourceCollection: "agency_tasks";
    readMethod: "getAgencyTaskById";
    link: {
      seoDraftTaskField: "realTaskId";
      agencyTaskField: "id";
    };
    readFields: Array<keyof AgencyTask>;
  };
  writeFields: [];
  notes: string[];
};

export type WeeklyTop10SnapshotRepositoryReaders = {
  listDraftTasksByRun(input: { teamId: string; runId: string }): Promise<SeoDraftTask[]>;
  getImplementationTaskById(id: string): Promise<AgencyTask | null>;
};

export type WeeklyTop10SnapshotRepositoryInput = {
  teamId: string;
  runId: string;
  opportunities: SeoOpportunity[];
};

export type WeeklyTop10AssemblySnapshot = {
  opportunities: SeoOpportunity[];
  draftTasks: SeoDraftTask[];
  implementationTasks: AgencyTask[];
};

export const WEEKLY_TOP10_SNAPSHOT_REPOSITORY_CONTRACT: WeeklyTop10SnapshotRepositoryContract = {
  opportunities: {
    source: "caller_provided",
    reason: "Current opportunity generation is upstream of this boundary and has no Weekly Top-10 storage table.",
  },
  draftTasks: {
    sourceCollection: "seoDraftTasks",
    readMethod: "listSeoDraftTasksByRun",
    requiredFilters: ["teamId", "runId"],
    readFields: [
      "id",
      "teamId",
      "companyId",
      "runId",
      "domain",
      "sourceType",
      "sourceId",
      "sourceFindingId",
      "evidence",
      "labels",
      "title",
      "description",
      "priority",
      "status",
      "targetKeywords",
      "suggestedCompanyId",
      "realTaskId",
      "convertedAt",
      "convertedByUserId",
      "createdAt",
      "updatedAt",
    ],
  },
  implementationTasks: {
    sourceCollection: "agency_tasks",
    readMethod: "getAgencyTaskById",
    link: {
      seoDraftTaskField: "realTaskId",
      agencyTaskField: "id",
    },
    readFields: ["id", "teamId", "companyId", "status", "completedAt", "updatedAt"],
  },
  writeFields: [],
  notes: [
    "This adapter boundary is read-only and does not change Firestore schema.",
    "It does not persist, schedule, or send Weekly Top-10 digests.",
    "Implementation tasks are loaded only through seoDraftTasks.realTaskId links.",
    "Opportunities are provided by the caller until a dedicated opportunity storage source exists.",
  ],
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function linkedImplementationTaskIds(draftTasks: SeoDraftTask[]): string[] {
  return Array.from(
    new Set(draftTasks.map((task) => cleanString(task.realTaskId)).filter(Boolean))
  ).sort();
}

export async function loadWeeklyTop10AssemblySnapshot(
  readers: WeeklyTop10SnapshotRepositoryReaders,
  input: WeeklyTop10SnapshotRepositoryInput
): Promise<WeeklyTop10AssemblySnapshot> {
  const draftTasks = await readers.listDraftTasksByRun({
    teamId: input.teamId,
    runId: input.runId,
  });
  const implementationTasks = (
    await Promise.all(
      linkedImplementationTaskIds(draftTasks).map((id) => readers.getImplementationTaskById(id))
    )
  ).filter(Boolean) as AgencyTask[];

  return {
    opportunities: [...input.opportunities],
    draftTasks,
    implementationTasks,
  };
}
