import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgresql://nrpanel:nrpanel@localhost:5432/nrpanel"),
  SESSION_SECRET: z.string().min(32).default("development-session-pepper-change-before-production"),
  CONFIG_ENCRYPTION_KEY: z.string().min(32).default("development-config-key-change-before-production"),
  SUBSCRIPTION_PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000/api/v1/sub"),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(900).max(2_592_000).default(28_800),
  SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(300).max(604_800).default(3_600),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(3).max(50).default(5),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  PANEL_VERSION: z.string().min(1).max(64).default("0.1.0"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  MASTER_PUBLIC_URL: z.string().url().optional(),
  NR_PANEL_NODE_INSTALL_URL: z.string().url().optional(),
  SERVER_JOIN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
});

const parsed = environmentSchema.parse(process.env);

if (parsed.NODE_ENV === "production" && parsed.SESSION_SECRET.includes("development")) {
  throw new Error("SESSION_SECRET must be replaced before production startup");
}
if (parsed.NODE_ENV === "production" && parsed.CONFIG_ENCRYPTION_KEY.includes("development")) {
  throw new Error("CONFIG_ENCRYPTION_KEY must be replaced before production startup");
}
if (parsed.NODE_ENV === "production" && parsed.DEMO_MODE !== "false") throw new Error("DEMO_MODE must be false in production");

export const environment = {
  nodeEnv: parsed.NODE_ENV,
  apiPort: parsed.API_PORT,
  webOrigin: parsed.WEB_ORIGIN,
  databaseUrl: parsed.DATABASE_URL,
  sessionSecret: parsed.SESSION_SECRET,
  configEncryptionKey: parsed.CONFIG_ENCRYPTION_KEY,
  subscriptionPublicBaseUrl: parsed.SUBSCRIPTION_PUBLIC_BASE_URL.replace(/\/$/, ""),
  sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
  sessionIdleTimeoutSeconds: parsed.SESSION_IDLE_TIMEOUT_SECONDS,
  loginRateLimitMax: parsed.LOGIN_RATE_LIMIT_MAX,
  loginRateLimitWindowSeconds: parsed.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  panelVersion: parsed.PANEL_VERSION,
  demoMode: parsed.DEMO_MODE === "true",
  masterPublicUrl: parsed.MASTER_PUBLIC_URL?.replace(/\/$/, "") ?? null,
  nodeInstallUrl: parsed.NR_PANEL_NODE_INSTALL_URL ?? null,
  serverJoinTtlSeconds: parsed.SERVER_JOIN_TTL_SECONDS,
  production: parsed.NODE_ENV === "production",
};
