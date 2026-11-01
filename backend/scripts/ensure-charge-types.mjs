import pg from "pg";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const defs = [
  ["YAKIT", "Yakıt", "FUEL"],
  ["DIGER", "Site İşi / Diğer", "EXTRA"],
];

for (const [code, name, category] of defs) {
  const existing = await client.query(
    `SELECT id FROM charge_type WHERE tenant_id = 1 AND code = $1`,
    [code],
  );
  if (!existing.rows[0]) {
    await client.query(
      `INSERT INTO charge_type (tenant_id, code, name, category) VALUES (1, $1, $2, $3)`,
      [code, name, category],
    );
    console.log("inserted", code);
  } else {
    console.log("exists", code);
  }
}

await client.end();
