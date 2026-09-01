import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("production Node runtime contract", () => {
  test("provisions and verifies the package engine before dependency installation", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines?: { node?: string };
    };
    const deploy = readFileSync("scripts/deploy.sh", "utf8");

    expect(packageJson.engines?.node).toBe(">=22.19.0");
    expect(deploy).toContain("setup_22.x");
    expect(deploy).not.toContain("setup_20.x");
    expect(deploy).toContain("REQUIRED_NODE_MAJOR=22");
    expect(deploy).toContain("REQUIRED_NODE_MINOR=19");

    const verification = deploy.indexOf("node_runtime_is_supported");
    const install = deploy.indexOf("npm install");
    const build = deploy.indexOf("npm run build");
    expect(verification).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(verification);
    expect(build).toBeGreaterThan(install);
  });
});
