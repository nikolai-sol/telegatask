export function selectCampaigns(state) {
  const s = state || {};
  return Array.isArray(s.campaigns) ? s.campaigns : [];
}

export function selectCampaignById(state, id) {
  if (!id) return null;
  const list = selectCampaigns(state);
  return list.find((c) => c && c.id === id) || null;
}

