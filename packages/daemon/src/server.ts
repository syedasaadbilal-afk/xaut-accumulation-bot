import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import { parseConfig } from "./config.js";
import { hasSecrets, writeSecrets } from "./secrets.js";
import type { XautService } from "./service.js";

export interface CreateServerOptions {
  service: XautService;
  port: number;
  /** Built dashboard assets; skipped if missing (API still works). */
  staticDir?: string;
  /** SQLite path - the credentials file is stored next to it. */
  dbPath: string;
}

export async function createServer(opts: CreateServerOptions) {
  const { service } = opts;
  const fastify = Fastify({ logger: false });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    await fastify.register(fastifyStatic, { root: opts.staticDir });
    fastify.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    console.warn(`[xaut] dashboard static dir not found (${opts.staticDir ?? "unset"}) - serving API only`);
  }

  fastify.get("/api/status", async () => service.status());

  fastify.get("/api/secrets", async () => ({ configured: hasSecrets(opts.dbPath) }));

  fastify.put("/api/secrets", async (req, reply) => {
    const body = req.body as { apiKey?: string; apiSecret?: string } | undefined;
    const apiKey = body?.apiKey?.trim();
    const apiSecret = body?.apiSecret?.trim();
    if (!apiKey || !apiSecret) {
      reply.code(400);
      return { error: "apiKey and apiSecret are both required" };
    }
    writeSecrets(opts.dbPath, { apiKey, apiSecret });
    // A new key means the wallet baseline may belong to a different account.
    const st = service.store.getState();
    service.store.setState({ ...st, snapshot: null, strandedUst: 0, heldBackXaut: 0 });
    console.log("[xaut] Bitfinex API credentials updated via dashboard.");
    return { configured: true };
  });

  fastify.put("/api/config", async (req, reply) => {
    const parsed = parseConfig(req.body);
    if ("error" in parsed) {
      reply.code(400);
      return { error: parsed.error };
    }
    const before = service.store.getConfig();
    service.store.setConfig(parsed.config);
    const c = parsed.config;
    service.store.addEvent(
      "config",
      `Config saved: enabled=${c.enabled}, mode=${c.mode}, chunk $${c.chunkUsd}, strategy cap ${c.strategyCap.enabled ? `${c.strategyCap.maxDistPct}%` : "off"}, new-money cap ${c.newMoneyCap.enabled ? `${c.newMoneyCap.maxDistPct}% (lump >= ${c.newMoneyCap.minLumpPct}%)` : "off"}, position cap ${c.positionCapXaut > 0 ? `${c.positionCapXaut} XAUT` : "off"}`
    );
    if (before.mode !== c.mode) console.log(`[xaut] mode changed ${before.mode} -> ${c.mode}`);
    return { ok: true };
  });

  fastify.post("/api/run-now", async () => {
    service.tick().catch((err) => console.error("[xaut] manual tick failed:", err));
    return { started: true };
  });

  fastify.post("/api/clear-held-back", async () => {
    const st = service.store.getState();
    service.store.setState({ ...st, heldBackXaut: 0 });
    service.store.addEvent("info", "Held-back XAUT released manually");
    return { ok: true };
  });

  await fastify.listen({ port: opts.port, host: "0.0.0.0" });
  console.log(`[xaut] dashboard/API listening on :${opts.port}`);
  return fastify;
}
