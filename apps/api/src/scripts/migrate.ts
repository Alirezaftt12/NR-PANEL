import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { environment } from "../lib/environment.js";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../database/migrations");
const pool = new Pool({ connectionString: environment.databaseUrl });
const client = await pool.connect();

try {
  await client.query(`CREATE TABLE IF NOT EXISTS nr_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>("SELECT checksum FROM nr_migrations WHERE name = $1", [file]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
      console.log(`skip ${file}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO nr_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
