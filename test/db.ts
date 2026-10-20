import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/lib/db";

/** Drops everything and re-applies the migrations. Only for TEST_DATABASE_URL. */
export async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to run integration tests.");
  await db().execute(sql`drop schema if exists public cascade`);
  await db().execute(sql`drop schema if exists drizzle cascade`);
  await db().execute(sql`create schema public`);
  await migrate(db(), { migrationsFolder: "drizzle" });
}

export async function closeDatabase(): Promise<void> {
  await db().$client.end();
}
