import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import * as schema from "./schema/index.js";

const env = loadEnv();

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
