import admin from "firebase-admin";
import path from "path";

let app: admin.app.App;

if (!admin.apps.length) {
  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, "../../serviceAccountKey.json");

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
  });
} else {
  app = admin.app();
}

export const firestore = admin.firestore();
// Many entities have optional fields (e.g. chatUsername, fileMeta.name). Firestore rejects `undefined` values by default.
// Enabling this avoids runtime errors on optional nested fields and keeps payloads clean.
try {
  firestore.settings({ ignoreUndefinedProperties: true });
} catch {
  // ignore (can throw if called after first use in some environments)
}
