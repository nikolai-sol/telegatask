export interface Team {
  id: string;
  name: string;
  chatIds?: string[];
  projectIds?: string[];
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
