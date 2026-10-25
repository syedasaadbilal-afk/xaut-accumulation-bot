import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/connection.js";
import { applyMigrations } from "./db/migrate.js";
import { createServer } from "./server.js";
import { XautService } from "./service.js";

const DB_PATH = process.env.XAUT_DB_PATH ?? "./xaut.sqlite";
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 8787);
const TICK_MS = Number(process.env.XAUT_TICK_MS ?? 60_000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_STATIC_DIR = process.env.DASHBOARD_STATIC_DIR ?? path.join(__dirname, "..", "public");

async function main() {
  const db = openDatabase(DB_PATH);
  applyMigrations(db);
  const service = new XautService(DB_PATH, db);

  console.log(`[xaut] starting (tick every ${TICK_MS} ms). Nothing is traded until the bot is enabled AND set to LIVE in the dashboard.`);
  await createServer({ service, port: DASHBOARD_PORT, staticDir: DASHBOARD_STATIC_DIR, dbPath: DB_PATH });

  const tick = () => service.tick().catch((err) => console.error("[xaut] tick failed:", err));
  await tick();
  setInterval(tick, TICK_MS);
}

main().catch((err) => {
  console.error("[xaut] fatal:", err);
  process.exit(1);
});
