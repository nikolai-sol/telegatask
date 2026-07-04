import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask } from "./types";
import type { WeeklyTop10OpportunityInput } from "./weeklyTop10Generator";
import { findMatchingDraftTaskForOpportunity } from "./weeklyTop10ApprovalStateSource";

export type WeeklyTop10ImplementationStateStorageContract = {
  sourceCollection: "agency_tasks";
  link: {
    seoDraftTaskField: "realTaskId";
    agencyTaskField: "id";
  };
  readFields: Array<keyof AgencyTask>;
  writeFields: [];
  implementationStatusAvailable: true;
  implementedStatus: "done";
  notes: string[];
};

export type WeeklyTop10ImplementationStateSourceInput = {
  weeklyInputs: WeeklyTop10OpportunityInput[];
  draftTasks: SeoDraftTask[];
  implementationTasks: AgencyTask[];
};

export const WEEKLY_TOP10_IMPLEMENTATION_STATE_STORAGE_CONTRACT: WeeklyTop10ImplementationStateStorageContract = {
  sourceCollection: "agency_tasks",
  link: {
    seoDraftTaskField: "realTaskId",
    agencyTaskField: "id",
  },
  readFields: ["id", "teamId", "companyId", "status", "completedAt", "updatedAt"],
  writeFields: [],
  implementationStatusAvailable: true,
  implementedStatus: "done",
  notes: [
    "This boundary is read-only and does not change Firestore schema.",
    "SEO draft tasks link to implementation tasks through realTaskId.",
    "Only agency_tasks with status done prove implementation.",
    "convertedAt alone still does not prove implementation.",
  ],
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isoString(value: Date | string | number | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    return cleanString(value) || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function implementationTasksById(tasks: AgencyTask[]): Map<string, AgencyTask> {
  const byId = new Map<string, AgencyTask>();
  for (const task of tasks) {
    const id = cleanString(task.id);
    if (id) byId.set(id, task);
  }
  return byId;
}

function implementedAtFromTask(task: AgencyTask): string | null {
  if (task.status !== "done") return null;
  return isoString(task.completedAt) || isoString(task.updatedAt);
}

export function applyWeeklyTop10ImplementationState(
  input: WeeklyTop10ImplementationStateSourceInput
): WeeklyTop10OpportunityInput[] {
  const implementationById = implementationTasksById(input.implementationTasks);

  return input.weeklyInputs.map((weeklyInput) => {
    const draftTask = findMatchingDraftTaskForOpportunity(weeklyInput.opportunity, input.draftTasks);
    const realTaskId = cleanString(draftTask?.realTaskId);
    const implementationTask = realTaskId ? implementationById.get(realTaskId) : null;
    const implementedAt = implementationTask ? implementedAtFromTask(implementationTask) : null;

    if (!implementedAt) return weeklyInput;

    return {
      ...weeklyInput,
      state: "implemented",
      implementedAt,
    };
  });
}
