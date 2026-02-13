/* eslint-disable no-console */
/**
 * Danger: deletes team-related data in Firestore for a clean reset.
 *
 * What it does (in this order):
 *  - deletes ALL documents in: tasks, campaigns, campaignMembers, projects, chats, teams
 *  - sets users.activeTeamId = null for ALL user docs (keeps users/knowledge/actionLogs)
 *
 * Usage:
 *   node scripts/clearTeams.js --yes
 *
 * Notes:
 *  - This is intended for test environments / a clean reboot.
 *  - If you need a narrower delete, create a dedicated script.
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

async function deleteAllDocs(db, collectionName, limit) {
  const col = db.collection(collectionName);
  let totalDeleted = 0;

  while (true) {
    const snap = await col.limit(limit).get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    totalDeleted += snap.size;
    console.log(`[${collectionName}] Deleted ${snap.size}, total ${totalDeleted}`);
  }

  console.log(`[${collectionName}] Done. Total deleted: ${totalDeleted}`);
}

async function clearActiveTeamId(db, limit) {
  const col = db.collection("users");
  let totalUpdated = 0;
  while (true) {
    const snap = await col.limit(limit).get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { activeTeamId: null, updatedAt: new Date().toISOString() });
    }
    await batch.commit();
    totalUpdated += snap.size;
    console.log(`[users] Reset activeTeamId for ${snap.size}, total ${totalUpdated}`);
  }
  console.log(`[users] Done. Total updated: ${totalUpdated}`);
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

  // Keep order: delete dependent data first.
  const collections = [
    "tasks",
    "campaigns",
    "campaignMembers",
    "projects",
    "chats",
    "teams",
  ];

  for (const name of collections) {
    try {
      await deleteAllDocs(db, name, args.limit);
    } catch (e) {
      console.warn(`[${name}] Failed to delete (maybe missing collection):`, e?.message || e);
    }
  }

  await clearActiveTeamId(db, args.limit);
  console.log("Reset complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

