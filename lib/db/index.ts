import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

function createDb() {
  // Plain Postgres over TCP: works with Neon's pooled endpoint on Vercel Fluid
  // compute, supports interactive transactions, and runs against a local
  // Postgres in tests. attachDatabasePool closes idle clients before the
  // function instance is suspended.
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 5, idleTimeoutMillis: 5_000 });
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema, casing: "snake_case" });
}

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily connects, so builds and demo mode work without a database. */
export function db() {
  instance ??= createDb();
  return instance;
}

export type Db = ReturnType<typeof db>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export { schema };
