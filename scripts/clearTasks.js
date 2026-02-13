/* eslint-disable no-console */
/**
 * Danger: deletes ALL documents in Firestore collection "tasks".
 *
 * Usage:
 *   node scripts/clearTasks.js --yes
 */

const admin = require("firebase-admin");
const path = require("path");

function parseArgs() {
  const argv = process.argv.slice(2);
  const yes = argv.includes("--yes");
  const limitIdx = argv.indexOf("--limit");
  let limit = 450;
  if (limitIdx !== -1) {
    const n = Number(argv[limitIdx + 1]);
    if (Number.isFinite(n) && n > 0) limit = Math.min(450, Math.floor(n));
  }
  return { yes, limit };
}

async function main() {
  const args = parseArgs();
  if (!args.yes) {
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
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {}

  const col = db.collection("tasks");
  let totalDeleted = 0;

  while (true) {
    const snap = await col.limit(args.limit).get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    totalDeleted += snap.size;
    console.log(`Deleted ${snap.size}, total ${totalDeleted}`);
  }

  console.log(`Done. Total deleted: ${totalDeleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

