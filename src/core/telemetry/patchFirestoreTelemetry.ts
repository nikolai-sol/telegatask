import type { DocumentReference, Query, Transaction, WriteBatch, CollectionReference } from "@google-cloud/firestore";
import { incFirestoreReads, incFirestoreWrites } from "./requestTelemetry";

let patched = false;

/**
 * Monkey-patches Firestore client prototypes to count reads/writes per request.
 *
 * This is intentionally approximate:
 * - docRef.get() increments reads by 1
 * - query.get() increments reads by querySnapshot.size
 * - writes increment by 1 per operation call (set/update/delete/add, etc)
 *
 * If patching fails (SDK changes), it becomes a no-op and the app still works.
 */
export function patchFirestoreTelemetry(): void {
  if (patched) return;
  patched = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("@google-cloud/firestore") as {
      DocumentReference: { prototype: DocumentReference };
      Query: { prototype: Query };
      Transaction: { prototype: Transaction };
      WriteBatch: { prototype: WriteBatch };
      CollectionReference: { prototype: CollectionReference };
    };

    // DocumentReference.get()
    const docProto: any = fs.DocumentReference?.prototype;
    if (docProto && typeof docProto.get === "function") {
      const orig = docProto.get;
      docProto.get = async function (...args: any[]) {
        const snap = await orig.apply(this, args);
        incFirestoreReads(1, 1, "doc.get");
        return snap;
      };
    }

    // Query.get()
    const queryProto: any = fs.Query?.prototype;
    if (queryProto && typeof queryProto.get === "function") {
      const orig = queryProto.get;
      queryProto.get = async function (...args: any[]) {
        const snap = await orig.apply(this, args);
        const size = typeof snap?.size === "number" ? snap.size : 0;
        incFirestoreReads(size, 1, "query.get");
        return snap;
      };
    }

    // CollectionReference.add()
    const collProto: any = fs.CollectionReference?.prototype;
    if (collProto && typeof collProto.add === "function") {
      const orig = collProto.add;
      collProto.add = async function (...args: any[]) {
        const res = await orig.apply(this, args);
        incFirestoreWrites(1, 1, "coll.add");
        return res;
      };
    }

    // Transaction.get() / set / update / delete
    const txProto: any = fs.Transaction?.prototype;
    if (txProto && typeof txProto.get === "function") {
      const orig = txProto.get;
      txProto.get = async function (...args: any[]) {
        const snap = await orig.apply(this, args);
        // Can be DocumentSnapshot or QuerySnapshot depending on SDK.
        const size = typeof snap?.size === "number" ? snap.size : 1;
        incFirestoreReads(size, 1, "tx.get");
        return snap;
      };
    }
    if (txProto && typeof txProto.set === "function") {
      const orig = txProto.set;
      txProto.set = function (...args: any[]) {
        const res = orig.apply(this, args);
        incFirestoreWrites(1, 1, "tx.set");
        return res;
      };
    }
    if (txProto && typeof txProto.update === "function") {
      const orig = txProto.update;
      txProto.update = function (...args: any[]) {
        const res = orig.apply(this, args);
        incFirestoreWrites(1, 1, "tx.update");
        return res;
      };
    }
    if (txProto && typeof txProto.delete === "function") {
      const orig = txProto.delete;
      txProto.delete = function (...args: any[]) {
        const res = orig.apply(this, args);
        incFirestoreWrites(1, 1, "tx.delete");
        return res;
      };
    }

    // WriteBatch
    const batchProto: any = fs.WriteBatch?.prototype;
    if (batchProto && typeof batchProto.set === "function") {
      const orig = batchProto.set;
      batchProto.set = function (...args: any[]) {
        const res = orig.apply(this, args);
        incFirestoreWrites(1, 1, "batch.set");
        return res;
      };
    }
    if (batchProto && typeof batchProto.update === "function") {
      const orig = batchProto.update;
      batchProto.update = function (...args: any[]) {
        const res = orig.apply(this, args);
        incFirestoreWrites(1, 1, "batch.update");
        return res;
      };
    }
    if (batchProto && typeof batchProto.delete === "function") {
      const orig = batchProto.delete;
      batchProto.delete = function (...args: any[]) {
        const res = orig.apply(this, args);
        incFirestoreWrites(1, 1, "batch.delete");
        return res;
      };
    }
    if (batchProto && typeof batchProto.commit === "function") {
      const orig = batchProto.commit;
      batchProto.commit = async function (...args: any[]) {
        const res = await orig.apply(this, args);
        // commit itself does not map 1:1 to writes; writes are counted at set/update/delete calls.
        return res;
      };
    }
  } catch {
    // No-op: telemetry is best-effort.
  }
}
