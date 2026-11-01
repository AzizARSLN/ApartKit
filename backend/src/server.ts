import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { pool } from "./db/client.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`API listening on :${env.PORT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
