import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { environment } from "../lib/environment.js";
import type { SecurityDatabase } from "./types.js";

export function createDatabase(connectionString = environment.databaseUrl) {
  return new Kysely<SecurityDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 }),
    }),
  });
}

export type Database = ReturnType<typeof createDatabase>;
