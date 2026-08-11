import { createHash, createHmac, randomBytes } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { agentActions, type AgentAction } from "@nr/shared";
import { z } from "zod";
import { environment } from "./environment.js";

export const passwordSchema = z.string()
  .min(12, "Password must contain at least 12 characters")
  .max(256)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol");

export const normalizeIdentifier = (value: string) => value.trim().normalize("NFKC").toLowerCase();
export const hashIdentifier = (value: string) => createHash("sha256").update(normalizeIdentifier(value)).digest("hex");

export const hashPassword = (password: string) => hash(password, {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
});

export const verifyPassword = async (password: string, passwordHash: string) => {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
};

let dummyPasswordHash: Promise<string> | undefined;
export function getDummyPasswordHash() {
  dummyPasswordHash ??= hashPassword("NR-Panel-Dummy-Password!2026");
  return dummyPasswordHash;
}

export const createSessionToken = () => randomBytes(32).toString("base64url");
export const hashSessionToken = (token: string) => createHmac("sha256", environment.sessionSecret).update(token).digest("hex");
export const createSubscriptionToken = () => randomBytes(32).toString("base64url");
export const hashSubscriptionToken = (token: string) => createHmac("sha256", environment.sessionSecret).update(`subscription.${token}`).digest("hex");

export const isWhitelistedAction = (action: string): action is AgentAction => agentActions.includes(action as AgentAction);
