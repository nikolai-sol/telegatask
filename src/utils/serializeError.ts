export function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    const stack = typeof err.stack === "string" ? err.stack : undefined;
    return {
      name: err.name,
      message: err.message || String(err),
      stack: stack ? stack.slice(0, 2000) : undefined,
    };
  }
  return { message: typeof err === "string" ? err : JSON.stringify(err).slice(0, 2000) };
}

