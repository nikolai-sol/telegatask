import { apiFetch } from "../../core/api.js";

export async function fetchTeams() {
  return apiFetch("/api/teams");
}

export async function setActiveTeam(teamId) {
  return apiFetch("/api/teams/active", { method: "POST", body: { teamId } });
}

