import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied successfully.");
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
