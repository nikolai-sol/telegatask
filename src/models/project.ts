export interface Project {
  id: string;
  name: string;
  description?: string | null;
  teamId?: string | null;
  chatIds?: string[];
  createdAt: string;
  updatedAt: string;
}
