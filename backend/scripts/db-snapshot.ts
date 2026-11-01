import { config } from "dotenv";
config();
config({ path: "../.env" });
import pg from "pg";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const sites = await pool.query(`SELECT id, name, tenant_id FROM site LIMIT 5`);
  console.log("sites", sites.rows);
  const periods = await pool.query(`
    SELECT period, COUNT(*) n, COALESCE(SUM(amount),0)::text tot
    FROM charge WHERE status NOT IN ('CANCELLED','CARRIED_FORWARD')
    GROUP BY period ORDER BY period DESC LIMIT 10`);
  console.log("periods", periods.rows);
  const units = await pool.query(`
    SELECT id, unit_no, floor_no FROM unit WHERE unit_no <> 'KD' ORDER BY CASE WHEN unit_no ~ '^[0-9]+$' THEN unit_no::int ELSE 999 END`);
  console.log("units", units.rows.length, units.rows.slice(0, 5), "...", units.rows.slice(-3));
  const people = await pool.query(`
    SELECT p.id, p.first_name, p.last_name, p.management_role, u.unit_no
    FROM person p
    LEFT JOIN LATERAL (
      SELECT unit_id FROM (
        SELECT unit_id, start_date FROM unit_occupancy WHERE person_id = p.id
        UNION ALL SELECT unit_id, start_date FROM unit_ownership WHERE person_id = p.id
      ) x ORDER BY start_date DESC LIMIT 1
    ) l ON true
    LEFT JOIN unit u ON u.id = l.unit_id
    WHERE p.deleted_at IS NULL
    ORDER BY CASE WHEN u.unit_no ~ '^[0-9]+$' THEN u.unit_no::int ELSE 999 END
    LIMIT 40`);
  console.log("people sample", people.rows.filter((r) => ["7", "9", "1", "8"].includes(String(r.unit_no))));
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
