const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();

export const isDebugMode = (): boolean => DEBUG;
export const isVerbose = (): boolean => DEBUG || LOG_LEVEL === "debug";

export function debugLog(...args: unknown[]): void {
  if (isDebugMode()) {
    console.log("[debug]", ...args);
  }
}

export function verboseLog(...args: unknown[]): void {
  if (isVerbose()) {
    console.log("[verbose]", ...args);
  }
}
