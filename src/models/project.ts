export interface Project {
  id: string;
  name: string;
  description?: string | null;
  teamId?: string | null;
  chatIds?: string[];
  /**
   * If empty/undefined => доступ у всех членов команды.
   * If non-empty => доступ только у перечисленных users.id.
   */
  allowedMemberIds?: string[] | null;
  createdAt: string;
  updatedAt: string;
}
