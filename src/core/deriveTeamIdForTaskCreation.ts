import { getTeamByChatId } from "../repositories/teamRepository";
import { getUserById } from "../repositories/userRepository";

/**
 * Derive teamId for task creation.
 *
 * Rules:
 * - If telegramChatId is provided (group/channel context) and the chat is linked to a team -> use that team.
 * - Otherwise fallback to user's activeTeamId (private chat / Mini App / unlinked chat).
 * - If there is no activeTeamId -> throw (caller should ask user to link/select a team).
 */
export async function deriveTeamIdForTaskCreation(input: {
  telegramChatId?: string | null;
  userId: string; // internal users.id
}): Promise<string> {
  const telegramChatId = (input.telegramChatId ?? "").trim();
  if (telegramChatId) {
    const team = await getTeamByChatId(telegramChatId);
    if (team?.id) return team.id;
  }

  const user = await getUserById(input.userId);
  const active = user?.activeTeamId ?? null;
  if (active) return active;

  throw new Error("No active team set. Link this chat to a team (/link_team) or select a team in Settings.");
}
