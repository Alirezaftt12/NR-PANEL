import { SERVER_ROLES } from "@nr/shared";
import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable().optional();

export const serverCreateSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  role: z.enum(SERVER_ROLES),
  country: optionalText(80),
  region: optionalText(120),
  provider: optionalText(120),
  description: optionalText(500),
}).strict();

export const serverEnrollSchema = z.object({
  joinToken: z.string().regex(/^nrj_[A-Za-z0-9_-]{40,}$/),
  hostname: z.string().trim().min(1).max(255),
  publicAddress: z.string().trim().max(255).optional().nullable(),
  agentVersion: z.string().trim().min(1).max(64),
}).strict();

const nullableNonNegative = z.number().finite().nonnegative().nullable();
const nullableInteger = z.number().int().nonnegative().nullable();
export const agentHeartbeatSchema = z.object({
  requestId: z.string().uuid(),
  timestamp: z.string().datetime(),
  agentVersion: z.string().trim().min(1).max(64),
  health: z.enum(["ONLINE", "ERROR"]),
  system: z.object({ hostname: z.string().min(1).max(255), os: z.string().max(255).nullable(), kernel: z.string().max(255).nullable(), architecture: z.string().max(64).nullable(), ipv4: z.string().nullable(), ipv6: z.string().nullable() }).strict(),
  cpu: z.object({ usage: nullableNonNegative.refine((value) => value === null || value <= 100), cores: nullableInteger }).strict(),
  ram: z.object({ used: nullableInteger, total: nullableInteger }).strict(),
  swap: z.object({ used: nullableInteger, total: nullableInteger }).strict(),
  storage: z.object({ used: nullableInteger, total: nullableInteger }).strict(),
  load: z.tuple([nullableNonNegative, nullableNonNegative, nullableNonNegative]),
  uptimeSeconds: nullableInteger,
  network: z.object({ rxRate: nullableInteger, txRate: nullableInteger, rxTotal: nullableInteger, txTotal: nullableInteger }).strict(),
  connections: z.object({ tcp: nullableInteger, udp: nullableInteger }).strict(),
  processCount: nullableInteger,
  xray: z.object({ status: z.enum(["ONLINE", "NOT_INSTALLED", "ERROR", "STOPPED"]), version: z.string().max(64).nullable(), uptimeSeconds: nullableInteger, configValid: z.boolean().nullable() }).strict(),
}).strict();

export type ServerCreateInput = z.infer<typeof serverCreateSchema>;
export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>;
