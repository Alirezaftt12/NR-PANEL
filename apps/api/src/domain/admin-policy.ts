import { ROLES, type Role } from "@nr/shared";
import { ApiError } from "../lib/errors.js";

export function assertAdminMutationAllowed(actorRole: Role, targetRole: Role) {
  if (actorRole !== ROLES.OWNER) throw new ApiError(403, "OWNER_REQUIRED", "Only OWNER can modify administrator accounts");
  if (targetRole === ROLES.OWNER) throw new ApiError(403, "OWNER_PROTECTED", "The OWNER account cannot be modified here");
}
