export interface Team {
  id: string;
  name: string;
  chatIds?: string[];
  projectIds?: string[];
  /** User IDs (users.id) who are members of the team. Used for queries and Mini App suggestions. */
  memberIds?: string[];
  roles?: Record<string, "owner" | "admin" | "member" | "read_only">;
  permissions?: Record<
    string,
    {
      create?: boolean;
      assign?: boolean;
      edit?: boolean;
    }
  >;
  createdAt: string;
  updatedAt: string;
}
