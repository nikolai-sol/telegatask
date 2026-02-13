import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import healthRouter from "./routes/health";
import debugRouter from "./routes/debug";
import apiRouter from "./routes/api";
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
app.get("/mini-app", (_req, res) => res.redirect(302, "/mini-app/"));
app.use("/mini-app", express.static(miniAppDir));

app.use(healthRouter);
app.use(debugRouter);
app.use(apiRouter);

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
