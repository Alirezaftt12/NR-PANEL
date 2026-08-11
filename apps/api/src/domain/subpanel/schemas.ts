import { INBOUND_PROTOCOLS } from "@nr/shared";
import { z } from "zod";
import { normalizeIdentifier, passwordSchema } from "../../lib/security.js";

const byteString = z.string().regex(/^\d+$/, "Byte values must be unsigned integer strings").refine((value) => BigInt(value) >= 0n, "Byte values must be positive");
const nullableByteString = byteString.nullable();
const futureDate = z.string().datetime().nullable();

export const portalUserCreateSchema = z.object({
  inboundId: z.string().uuid(),
  username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/).transform(normalizeIdentifier),
  displayName: z.string().trim().min(2).max(120),
  trafficLimit: nullableByteString,
  durationDays: z.number().int().min(1).max(3650).nullable().default(null),
  expiresAt: futureDate.default(null),
  enabled: z.boolean().default(true),
  subscriptionEnabled: z.boolean().default(true),
}).refine((value) => !(value.durationDays && value.expiresAt), { message: "Choose duration or an expiration date, not both" });

export const portalUserPatchSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  trafficLimit: nullableByteString.optional(),
  expiresAt: futureDate.optional(),
  enabled: z.boolean().optional(),
  subscriptionEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required");

export const portalUserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EXTEND"), days: z.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("INCREASE_TRAFFIC"), bytes: byteString.refine((value) => BigInt(value) > 0n) }),
  z.object({ action: z.literal("RESET_TRAFFIC") }),
  z.object({ action: z.literal("ROTATE_CREDENTIAL") }),
  z.object({ action: z.literal("ENABLE") }),
  z.object({ action: z.literal("DISABLE") }),
  z.object({ action: z.literal("DELETE"), confirmation: z.literal("CONFIRM") }),
]);

export const portalBulkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ENABLE"), userIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ action: z.literal("DISABLE"), userIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ action: z.literal("EXTEND"), userIds: z.array(z.string().uuid()).min(1).max(500), days: z.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("INCREASE_TRAFFIC"), userIds: z.array(z.string().uuid()).min(1).max(500), bytes: byteString.refine((value) => BigInt(value) > 0n) }),
  z.object({ action: z.literal("RESET_TRAFFIC"), userIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ action: z.literal("DELETE_EXPIRED"), userIds: z.array(z.string().uuid()).max(500).default([]), confirmation: z.literal("CONFIRM") }),
]);

export const portalSettingsPatchSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().max(254).transform(normalizeIdentifier).nullable().optional(),
  theme: z.enum(["light", "dark"]).optional(),
  language: z.enum(["fa", "en"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required");

const capabilitiesSchema = z.object({
  subscription: z.boolean(),
  trafficReset: z.boolean(),
  extend: z.boolean(),
  credentialRotation: z.boolean(),
});

const masterBase = {
  panelName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(120),
  expiresAt: futureDate,
  trafficCredit: nullableByteString,
  userLimit: z.number().int().min(0).max(1_000_000).nullable(),
  allowedServerIds: z.array(z.string().uuid()).max(500),
  assignedInboundIds: z.array(z.string().uuid()).max(1000),
  allowedProtocols: z.array(z.enum(INBOUND_PROTOCOLS)).min(1).max(INBOUND_PROTOCOLS.length),
  capabilities: capabilitiesSchema,
};

export const masterSubpanelCreateSchema = z.object({
  ...masterBase,
  slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/).transform(normalizeIdentifier),
  email: z.string().email().max(254).transform(normalizeIdentifier).nullable().default(null),
  password: passwordSchema,
});

export const masterSubpanelPatchSchema = z.object({
  panelName: masterBase.panelName.optional(),
  displayName: masterBase.displayName.optional(),
  expiresAt: masterBase.expiresAt.optional(),
  trafficCredit: masterBase.trafficCredit.optional(),
  userLimit: masterBase.userLimit.optional(),
  allowedServerIds: masterBase.allowedServerIds.optional(),
  assignedInboundIds: masterBase.assignedInboundIds.optional(),
  allowedProtocols: masterBase.allowedProtocols.optional(),
  capabilities: masterBase.capabilities.optional(),
  status: z.enum(["ACTIVE", "DISABLED", "EXPIRED"]).optional(),
  password: passwordSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required");

export const portalRangeSchema = z.enum(["24h", "7d", "30d", "all"]);
export type PortalUserCreateInput = z.infer<typeof portalUserCreateSchema>;
export type PortalUserPatchInput = z.infer<typeof portalUserPatchSchema>;
export type PortalUserActionInput = z.infer<typeof portalUserActionSchema>;
export type PortalBulkActionInput = z.infer<typeof portalBulkActionSchema>;
export type PortalSettingsPatchInput = z.infer<typeof portalSettingsPatchSchema>;
export type MasterSubpanelCreateInput = z.infer<typeof masterSubpanelCreateSchema>;
export type MasterSubpanelPatchInput = z.infer<typeof masterSubpanelPatchSchema>;
