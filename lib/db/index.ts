import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

let client: ReturnType<typeof createClient> | undefined;

function createClient() {
  return drizzle({ client: neon(requireEnv("DATABASE_URL")), schema, casing: "snake_case" });
}

/** Lazily connects, so builds and demo mode work without a database. */
export function db() {
  client ??= createClient();
  return client;
}

export { schema };
