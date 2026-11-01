import pg from "pg";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const users = await client.query(
  `SELECT id, tenant_id, email, full_name, status, left(password_hash, 20) AS hash_prefix
   FROM "user" ORDER BY id`,
);
console.log("users:", users.rows);

const roles = await client.query(
  `SELECT user_id, tenant_id, role FROM user_role ORDER BY id`,
);
console.log("roles:", roles.rows);

const kurum = await client.query(`SELECT id, name, code, status FROM kurum`);
console.log("kurum:", kurum.rows);

await client.end();
