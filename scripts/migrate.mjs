// Applies drizzle/ migrations to DATABASE_URL. Vercel runs this before every
// build (vercel.json), so production and each preview's own database (a Neon
// branch) are on the deployed schema. Keep migrations additive so the previous
// deployment keeps working until the new one takes over.
// Skips without a database, or with SKIP_MIGRATIONS=1.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Neon's integration also provides a direct (unpooled) URL, which suits DDL best.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url || process.env.SKIP_MIGRATIONS === "1") {
  console.log("Skipping migrations (no DATABASE_URL, or SKIP_MIGRATIONS=1).");
} else {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}
