import type { AgencyTask } from "../../types/agency";
import type { SeoDraftTask, SeoOpportunity } from "./types";
import { buildWeeklyTop10InputsFromApprovalState } from "./weeklyTop10ApprovalStateSource";
import { applyWeeklyTop10ImplementationState } from "./weeklyTop10ImplementationStateSource";
import {
  generateWeeklyTop10Digest,
  type WeeklyTop10Digest,
  type WeeklyTop10GeneratorConfig,
  type WeeklyTop10OpportunityInput,
} from "./weeklyTop10Generator";

export type WeeklyTop10AssemblyInput = {
  opportunities: SeoOpportunity[];
  draftTasks: SeoDraftTask[];
  implementationTasks: AgencyTask[];
  config?: Partial<WeeklyTop10GeneratorConfig>;
};

export type WeeklyTop10AssemblyResult = {
  inputs: WeeklyTop10OpportunityInput[];
  digest: WeeklyTop10Digest;
};

export function assembleWeeklyTop10Digest(input: WeeklyTop10AssemblyInput): WeeklyTop10AssemblyResult {
  const approvalInputs = buildWeeklyTop10InputsFromApprovalState({
    opportunities: input.opportunities,
    draftTasks: input.draftTasks,
  });
  const inputs = applyWeeklyTop10ImplementationState({
    weeklyInputs: approvalInputs,
    draftTasks: input.draftTasks,
    implementationTasks: input.implementationTasks,
  });

  return {
    inputs,
    digest: generateWeeklyTop10Digest(inputs, input.config),
  };
}
