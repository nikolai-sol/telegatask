import "dotenv/config";
import { parseWgdCliOptions } from "../src/features/seoAgent/wgdReport/cliOptions";
import {
  runWgdReport,
  type WgdReportRunResult,
} from "../src/features/seoAgent/wgdReport/runWgdReport";
import type { WgdReportOptions } from "../src/features/seoAgent/wgdReport/types";

export const SEO_REPORT_HELP = `Usage: npm run seo:report -- --url <url> [options]

Options:
  --url <url>                       Public HTTP(S) site URL (required)
  --market <RU|AT|DE|OTHER>         Market profile (default: RU)
  --language <code>                 Report/search language (default: ru)
  --region <id>                     Yandex region ID (default: 225)
  --keyword <query>                 Yandex keyword; repeatable (max 50, 200 chars each)
  --ai-query <query>                Alice AI sample query; repeatable (max 20, 1000 chars each)
  --crawl-limit <1-100>             Maximum public pages to crawl (default: 100)
  --lighthouse-page-limit <1-6>     Maximum pages with mobile/desktop profiles (default: 6)
  --priority-url <url>              Same-origin Lighthouse priority; repeatable
  --out-dir <relative-path>         Artifact root (default: reports)
  --help                            Show this help`;

type CliDeps = {
  runReport?: (options: WgdReportOptions) => Promise<WgdReportRunResult>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};

/** Run the command without ever forwarding raw argument, environment, or provider errors. */
export async function runSeoReportCli(
  argv: readonly string[] = process.argv.slice(2),
  deps: CliDeps = {}
): Promise<number> {
  const stdout = deps.stdout || ((text: string) => console.log(text));
  const stderr = deps.stderr || ((text: string) => console.error(text));
  if (argv.length === 1 && argv[0] === "--help") {
    stdout(SEO_REPORT_HELP);
    return 0;
  }

  let options: WgdReportOptions;
  try {
    options = parseWgdCliOptions(argv);
  } catch {
    stderr("Invalid SEO report options. Run with --help for usage.");
    return 1;
  }

  try {
    const result = await (deps.runReport || runWgdReport)(options);
    stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch {
    stderr("SEO report failed. No complete artifact bundle was published.");
    return 1;
  }
}

if (require.main === module) {
  void runSeoReportCli().then((code) => {
    process.exitCode = code;
  });
}
