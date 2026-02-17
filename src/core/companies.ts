import { deriveTeamIdForTaskCreation } from "./deriveTeamIdForTaskCreation";
import { getOrCreateInternalCompany } from "../repositories/companyRepository";

export async function getInternalCompanyIdForTaskCreation(input: {
  telegramChatId?: string | null;
  userId: string;
}): Promise<string> {
  const teamId = await deriveTeamIdForTaskCreation({
    telegramChatId: input.telegramChatId ?? null,
    userId: input.userId,
  });
  const company = await getOrCreateInternalCompany(teamId, input.userId);
  return company.id;
}

export async function getInternalCompanyForTaskCreation(input: {
  telegramChatId?: string | null;
  userId: string;
}): Promise<{ companyId: string; isInternalCompanyFallback: true }> {
  const companyId = await getInternalCompanyIdForTaskCreation(input);
  return { companyId, isInternalCompanyFallback: true };
}
