import { AsyncLocalStorage } from "node:async_hooks";

export type RequestTelemetry = {
  requestId: string;
  firestoreReads: number;
  firestoreWrites: number;
  firestoreReadOps: number;
  firestoreWriteOps: number;
  firestoreOps?: Record<string, number>;
};

const als = new AsyncLocalStorage<RequestTelemetry>();

export function runWithRequestTelemetry<T>(telemetry: RequestTelemetry, fn: () => T): T {
  return als.run(telemetry, fn);
}

export function getRequestTelemetry(): RequestTelemetry | null {
  return als.getStore() ?? null;
}

export function incFirestoreReads(count: number, opCount: number = 1, opName?: string): void {
  const t = als.getStore();
  if (!t) return;
  t.firestoreReads += Math.max(0, Number(count) || 0);
  t.firestoreReadOps += Math.max(0, Number(opCount) || 0);
  if (opName) {
    if (!t.firestoreOps) t.firestoreOps = {};
    t.firestoreOps[opName] = (t.firestoreOps[opName] || 0) + 1;
  }
}

export function incFirestoreWrites(count: number, opCount: number = 1, opName?: string): void {
  const t = als.getStore();
  if (!t) return;
  t.firestoreWrites += Math.max(0, Number(count) || 0);
  t.firestoreWriteOps += Math.max(0, Number(opCount) || 0);
  if (opName) {
    if (!t.firestoreOps) t.firestoreOps = {};
    t.firestoreOps[opName] = (t.firestoreOps[opName] || 0) + 1;
  }
}
