import { normalizeProviderDomain } from "./seoDataProvider";

export function normalizeResultDomain(input: string): string {
  return normalizeProviderDomain(input);
}

export function isMatchingTargetDomain(input: {
  targetDomain: string;
  targetDomainAliases?: string[];
  resultUrl?: string | null;
  resultDomain?: string | null;
  allowSubdomains?: boolean;
}): boolean {
  const targets = Array.from(
    new Set(
      [input.targetDomain, ...(input.targetDomainAliases || [])]
        .map((item) => normalizeResultDomain(item))
        .filter(Boolean)
    )
  );
  const result = normalizeResultDomain(input.resultDomain || input.resultUrl || "");
  if (targets.length === 0 || !result) return false;

  for (const target of targets) {
    if (result === target) return true;
    if (input.allowSubdomains && result.endsWith(`.${target}`)) return true;
  }

  return false;
}
