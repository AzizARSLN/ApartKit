import { pool } from "./client.js";

async function reset(): Promise<void> {
  await pool.query(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '__drizzle_migrations'
      ) LOOP
        EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
  console.log("All application data wiped (migrations kept).");
}

reset()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
