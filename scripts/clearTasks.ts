/**
 * Danger: deletes ALL documents in Firestore collection "tasks".
 *
 * Usage:
 *   node scripts/clearTasks.js --yes
 *
 * This TS file is the source-of-truth; scripts/clearTasks.js is the runnable version.
 */

import admin from "firebase-admin";
import path from "path";

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    yes: argv.includes("--yes"),
    limit: (() => {
      const i = argv.indexOf("--limit");
      if (i === -1) return 450;
      const n = Number(argv[i + 1]);
      return Number.isFinite(n) && n > 0 ? Math.min(450, Math.floor(n)) : 450;
    })(),
  };
}

async function main() {
  const args = parseArgs();
  if (!args.yes) {
    // eslint-disable-next-line no-console
    console.log("Refusing to run without --yes");
    process.exit(2);
  }

  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, "../serviceAccountKey.json");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
    });
  }

  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });

  const col = db.collection("tasks");
  let totalDeleted = 0;

  while (true) {
    const snap = await col.limit(args.limit).get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    totalDeleted += snap.size;
    // eslint-disable-next-line no-console
    console.log(`Deleted ${snap.size}, total ${totalDeleted}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Done. Total deleted: ${totalDeleted}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

