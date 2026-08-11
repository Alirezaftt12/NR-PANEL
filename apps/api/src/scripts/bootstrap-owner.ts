import { z } from "zod";
import { createDatabase } from "../database/client.js";
import { KyselySecurityRepository } from "../database/security-repository.js";
import { hashPassword, normalizeIdentifier, passwordSchema } from "../lib/security.js";

const input = z.object({
  OWNER_USERNAME: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  OWNER_EMAIL: z.string().email().max(254).optional(),
  OWNER_PASSWORD: passwordSchema,
}).safeParse(process.env);

if (!input.success) {
  console.error("OWNER_USERNAME and OWNER_PASSWORD are required. OWNER_EMAIL is optional.");
  console.error("Password must be 12+ characters and include upper/lowercase, a number, and a symbol.");
  process.exitCode = 1;
} else {
  const database = createDatabase();
  try {
    const repository = new KyselySecurityRepository(database);
    const owner = await repository.bootstrapOwner(
      normalizeIdentifier(input.data.OWNER_USERNAME),
      input.data.OWNER_EMAIL ? normalizeIdentifier(input.data.OWNER_EMAIL) : null,
      await hashPassword(input.data.OWNER_PASSWORD),
    );
    console.log(`OWNER created: ${owner.username} (${owner.id})`);
  } finally {
    await database.destroy();
  }
}
