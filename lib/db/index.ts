import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { sql } from "drizzle-orm";
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

/**
 * Holds a Postgres advisory lock on `key` until the transaction ends, so
 * transactions that take the same key run one after the other.
 */
export async function lockFor(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export { schema };
