import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { environment } from "../../lib/environment.js";

const key = createHash("sha256").update(environment.configEncryptionKey, "utf8").digest();

export function encryptCredential(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptCredential(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Unsupported credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

export function credentialPreview(credential: string) {
  if (credential.length <= 8) return "••••••••";
  return `${credential.slice(0, 4)}••••${credential.slice(-4)}`;
}
