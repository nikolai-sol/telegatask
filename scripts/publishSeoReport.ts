import { publishSeoReport } from "../src/features/seoAgent/wgdReport/pagesPublisher";

export const SEO_PUBLISH_REPORT_HELP = `Usage: npm run seo:publish-report -- --report-dir <dir> --slug <slug> [--replace]

Options:
  --report-dir <dir>  Absolute or repository-relative report bundle directory (required)
  --slug <slug>       Lowercase public path segment, for example flowerlife-school (required)
  --replace           Replace an existing staged bundle after full validation
  --help              Show this help`;

type CliDependencies = {
  publish?: typeof publishSeoReport;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};

function parseArguments(argv: readonly string[]): { reportDir: string; slug: string; replace?: true } {
  let reportDir: string | undefined;
  let slug: string | undefined;
  let replace = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--replace") {
      if (replace) throw new Error("duplicate flag");
      replace = true;
      continue;
    }
    if (argument !== "--report-dir" && argument !== "--slug") throw new Error("unknown argument");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("missing flag value");
    index += 1;
    if (argument === "--report-dir") {
      if (reportDir !== undefined) throw new Error("duplicate flag");
      reportDir = value;
    } else {
      if (slug !== undefined) throw new Error("duplicate flag");
      slug = value;
    }
  }
  if (!reportDir || !slug) throw new Error("required flag missing");
  return { reportDir, slug, ...(replace ? { replace: true } : {}) };
}

/** Run the staging command without echoing hostile arguments or validation details. */
export async function runPublishSeoReportCli(
  argv: readonly string[] = process.argv.slice(2),
  deps: CliDependencies = {}
): Promise<number> {
  const stdout = deps.stdout || ((text: string) => console.log(text));
  const stderr = deps.stderr || ((text: string) => console.error(text));
  if (argv.length === 1 && argv[0] === "--help") {
    stdout(SEO_PUBLISH_REPORT_HELP);
    return 0;
  }
  let options: ReturnType<typeof parseArguments>;
  try {
    options = parseArguments(argv);
  } catch {
    stderr("Invalid SEO report publication options. Run with --help for usage.");
    return 1;
  }
  try {
    const result = await (deps.publish || publishSeoReport)(options);
    stdout(JSON.stringify({
      trackedDestination: result.trackedDestination,
      publicUrl: result.publicUrl,
      files: result.files,
    }, null, 2));
    return 0;
  } catch {
    stderr("SEO report publication failed. Pages state may have changed; inspect the staging destination before retrying.");
    return 1;
  }
}

if (require.main === module) {
  void runPublishSeoReportCli().then((code) => {
    process.exitCode = code;
  });
}
