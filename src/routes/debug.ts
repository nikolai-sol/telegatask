import { Router, Request, Response } from "express";
import { firestore } from "../config/firebase";
import { listActionLogs } from "../repositories/actionLogRepository";
import { isDebugMode, isVerbose } from "../config/debug";

const router = Router();

// Поможет понять, что роутер реально загрузился
console.log("✅ Debug router loaded");

router.get("/debug/ping-db", async (_req: Request, res: Response) => {
  try {
    const docRef = firestore.collection("debug").doc();
    const now = new Date().toISOString();

    await docRef.set({
      pingedAt: now,
      note: "telegatask debug ping",
    });

    const snapshot = await docRef.get();

    res.status(200).json({
      status: "ok",
      docId: docRef.id,
      data: snapshot.data(),
    });
  } catch (error) {
    console.error("Firestore ping error:", error);
    res.status(500).json({ status: "error", message: "Firestore ping failed" });
  }
});

router.get("/debug/status", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "telegatask-backend",
    debug: isDebugMode(),
    verbose: isVerbose(),
    env: {
      NODE_ENV: process.env.NODE_ENV ?? "undefined",
      PORT: process.env.PORT ?? "undefined",
      DEBUG: process.env.DEBUG ? "set" : "unset",
      LOG_LEVEL: process.env.LOG_LEVEL ?? "undefined",
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? "set" : "unset",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "set" : "unset",
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ? "set" : "unset",
    },
  });
});

router.get("/debug/action-logs", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await listActionLogs(limit);
    res.status(200).json({
      status: "ok",
      count: logs.length,
      logs,
    });
  } catch (error) {
    console.error("Action logs fetch error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch action logs" });
  }
});

export default router;