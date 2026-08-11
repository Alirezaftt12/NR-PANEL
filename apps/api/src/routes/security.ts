import type { FastifyInstance } from "fastify";
import type { KyselySecurityRepository } from "../database/security-repository.js";
import type { Authorization } from "../lib/auth.js";

type SecurityRoutesOptions = { repository: KyselySecurityRepository; authorization: Authorization };

export async function securityRoutes(app: FastifyInstance, { repository, authorization }: SecurityRoutesOptions) {
  app.get("/security/summary", { preHandler: authorization.requirePermission("SECURITY_VIEW") }, async (request) => ({
    ok: true,
    data: await repository.securitySummary(request.auth!),
  }));
}
