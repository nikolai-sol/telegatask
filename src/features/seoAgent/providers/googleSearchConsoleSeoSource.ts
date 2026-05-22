import type { SeoSearchConsoleSnapshot } from "../types";
import { SeoProviderNotConfiguredError } from "./seoDataProvider";

export class GoogleSearchConsoleSeoSource {
  async getSnapshot(domain: string): Promise<SeoSearchConsoleSnapshot> {
    const enabled = String(process.env.GSC_ENABLED || "")
      .trim()
      .toLowerCase();
    const siteUrl = String(process.env.GSC_SITE_URL || "").trim();
    const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();

    if (enabled !== "true" || !siteUrl || !credentialsPath) {
      throw new SeoProviderNotConfiguredError("Google Search Console source is not configured yet");
    }

    return {
      siteUrl,
      clicks: null,
      impressions: null,
      ctr: null,
      averagePosition: null,
      topQueries: [],
      topPages: [],
      countries: [],
      devices: [],
    };
  }
}
