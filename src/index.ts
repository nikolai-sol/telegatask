import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import healthRouter from "./routes/health";
import debugRouter from "./routes/debug";
import apiRouter from "./routes/api";
import agencyRouter from "./api/routes";
import seoAgentRouter from "./features/seoAgent/routes";
import {
  initTelegataskBot,
  stopTelegataskBot,
} from "./bot/telegataskBot";

const app = express();
app.use(cors());
app.use(express.json());

// Mini App static (works even when GitHub Pages is unavailable for private repos).
// In production: /opt/telegatask/mini-app; in dev: ./mini-app
const miniAppDir = path.join(__dirname, "..", "mini-app");
app.use((req, res, next) => {
  // Express treats /mini-app and /mini-app/ as the same route by default, so use originalUrl to avoid loops.
  if (req.originalUrl === "/mini-app") return res.redirect(302, "/mini-app/");
  next();
});
app.use("/mini-app", express.static(miniAppDir));

app.use(healthRouter);
app.use(debugRouter);
app.use(seoAgentRouter);
app.use(apiRouter);
app.use('/agency', agencyRouter);

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`telegatask backend listening on port ${PORT}`);
  initTelegataskBot();
  console.log("telegatask bot initialized");
});

process.once("SIGINT", () => {
  stopTelegataskBot();
  server.close();
});

process.once("SIGTERM", () => {
  stopTelegataskBot();
  server.close();
});
