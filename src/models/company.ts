export type CompanyType = "tender" | "campaign" | "internal";
export type CompanyStatus = "active" | "archived";

export type Company = {
  id: string;
  teamId: string;
  name: string;
  type: CompanyType;
  status: CompanyStatus;
  restrictAccess: boolean;
  createdAt: number;
  createdByUserId: string;
};
