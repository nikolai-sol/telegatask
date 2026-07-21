import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";

const mysqlExportScripts = [
  "runSeoMysqlDashboardExport.ts",
  "runSeoAiVisibilityImport.ts",
  "runSeoSovWeeklyExport.ts",
  "importAlisaAiVisibilityWorkbook.ts",
];

describe("SEO MySQL CLI isolation", () => {
  test.each(mysqlExportScripts)("%s ignores root MySQL option files", (filename) => {
    const source = readFileSync(join(__dirname, filename), "utf8");

    expect(source).toMatch(
      /spawn\(\s*"mysql",\s*\[\s*"--no-defaults",\s*"--connect-timeout=10"/u
    );
  });
});
