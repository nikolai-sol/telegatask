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