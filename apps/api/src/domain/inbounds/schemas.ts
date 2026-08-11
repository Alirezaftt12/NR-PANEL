import { INBOUND_PROTOCOLS, INBOUND_SECURITIES, INBOUND_TRANSPORTS, PRESERVE_SECRET_VALUE } from "@nr/shared";
import { z } from "zod";

const nullableByteLimit = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().transform(String), z.null()]).default(null);
const nullableDate = z.union([z.string().datetime(), z.null()]).default(null);

const fallbackSchema = z.object({
  name: z.string().max(255).optional(),
  alpn: z.enum(["", "h2", "http/1.1"]).optional(),
  path: z.string().max(2048).optional(),
  destination: z.string().min(1).max(2048),
  proxyProtocolVersion: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
}).strict();

const protocolConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("VLESS"), decryption: z.literal("none").default("none") }).strict(),
  z.object({ kind: z.literal("VMess"), disableInsecureEncryption: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal("Trojan") }).strict(),
  z.object({
    kind: z.literal("Shadowsocks"),
    method: z.enum(["aes-128-gcm", "aes-256-gcm", "chacha20-poly1305", "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm"]),
    network: z.enum(["tcp", "udp", "tcp,udp"]).default("tcp,udp"),
    serverPassword: z.string().min(16).max(512),
  }).strict(),
]);

const transportConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TCP"), headerType: z.enum(["none", "http"]).default("none"), requestPath: z.string().max(2048).optional() }).strict(),
  z.object({ kind: z.literal("WEBSOCKET"), path: z.string().min(1).max(2048).default("/"), host: z.string().max(255).optional(), heartbeatPeriod: z.number().int().min(0).max(86_400).optional() }).strict(),
  z.object({ kind: z.literal("GRPC"), serviceName: z.string().min(1).max(255), multiMode: z.boolean().default(false), idleTimeout: z.number().int().min(0).max(86_400).optional(), healthCheckTimeout: z.number().int().min(0).max(86_400).optional() }).strict(),
  z.object({ kind: z.literal("XHTTP"), path: z.string().min(1).max(2048).default("/"), host: z.string().max(255).optional(), mode: z.enum(["auto", "packet-up", "stream-up"]).default("auto") }).strict(),
]);

const securityConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NONE") }).strict(),
  z.object({
    kind: z.literal("TLS"), serverName: z.string().max(255).optional(), alpn: z.array(z.string().min(1).max(64)).max(8).default([]),
    minVersion: z.enum(["1.2", "1.3"]).default("1.2"), certificateFile: z.string().min(1).max(2048), keyFile: z.string().min(1).max(2048), rejectUnknownSni: z.boolean().default(false),
  }).strict(),
  z.object({
    kind: z.literal("REALITY"), target: z.string().min(1).max(2048), serverNames: z.array(z.string().max(255)).min(1).max(32),
    privateKey: z.union([z.string().min(32).max(255), z.literal(PRESERVE_SECRET_VALUE)]), shortIds: z.array(z.string().regex(/^(?:[a-fA-F0-9]{2}){0,8}$/)).min(1).max(32), show: z.boolean().default(false),
    proxyProtocolVersion: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  }).strict(),
]);

const sniffingSchema = z.object({
  enabled: z.boolean().default(false),
  destinationOverrides: z.array(z.enum(["http", "tls", "quic", "fakedns"])).max(4).default([]),
  metadataOnly: z.boolean().default(false), routeOnly: z.boolean().default(false),
  domainsExcluded: z.array(z.string().min(1).max(255)).max(256).default([]), domainsOnly: z.array(z.string().min(1).max(255)).max(256).default([]),
}).strict();

const sockoptSchema = z.object({
  acceptProxyProtocol: z.boolean().default(false), tcpFastOpen: z.boolean().default(false),
  tcpKeepAliveIdle: z.number().int().min(-1).max(86_400).optional(), tcpKeepAliveInterval: z.number().int().min(-1).max(86_400).optional(),
  tcpUserTimeout: z.number().int().min(0).max(86_400_000).optional(), congestion: z.enum(["bbr", "cubic", "reno"]).optional(),
  domainStrategy: z.enum(["AsIs", "UseIP", "UseIPv4", "UseIPv6", "ForceIP", "ForceIPv4", "ForceIPv6"]).default("AsIs"),
  dialerProxy: z.string().min(1).max(255).optional(), trustedXForwardedFor: z.array(z.string().min(1).max(255)).max(32).default([]),
}).strict();

const inboundWriteObjectSchema = z.object({
  serverId: z.string().uuid(), name: z.string().trim().min(2).max(120), tag: z.string().trim().regex(/^[A-Za-z0-9_.-]{2,120}$/),
  listenIp: z.string().trim().min(2).max(64).default("0.0.0.0"), port: z.number().int().min(1).max(65_535),
  protocol: z.enum(INBOUND_PROTOCOLS), transport: z.enum(INBOUND_TRANSPORTS), security: z.enum(INBOUND_SECURITIES), enabled: z.boolean().default(true),
  protocolConfig: protocolConfigSchema, transportConfig: transportConfigSchema, securityConfig: securityConfigSchema,
  sniffing: sniffingSchema.default({ enabled: false, destinationOverrides: [], metadataOnly: false, routeOnly: false, domainsExcluded: [], domainsOnly: [] }),
  sockopt: sockoptSchema.default({ acceptProxyProtocol: false, tcpFastOpen: false, domainStrategy: "AsIs", trustedXForwardedFor: [] }),
  fallbacks: z.array(fallbackSchema).max(64).default([]),
  routing: z.object({ outboundTag: z.string().min(1).max(255).optional(), balancerTag: z.string().min(1).max(255).optional() }).strict().default({}),
  trafficLimit: nullableByteLimit, expiresAt: nullableDate, advancedConfig: z.record(z.string(), z.unknown()).nullable().default(null),
}).strict();

export const inboundWriteSchema = inboundWriteObjectSchema.superRefine((value, context) => {
  if (value.protocol !== value.protocolConfig.kind) context.addIssue({ code: "custom", path: ["protocolConfig", "kind"], message: "Protocol adapter does not match protocol" });
  if (value.transport !== value.transportConfig.kind) context.addIssue({ code: "custom", path: ["transportConfig", "kind"], message: "Transport adapter does not match transport" });
  if (value.security !== value.securityConfig.kind) context.addIssue({ code: "custom", path: ["securityConfig", "kind"], message: "Security adapter does not match security" });
});

export const inboundClientWriteSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(320).nullable().default(null), credential: z.string().min(8).max(512).optional(),
  enabled: z.boolean().default(true), trafficLimit: nullableByteLimit, expiresAt: nullableDate,
  subscriptionEnabled: z.boolean().default(false), flow: z.enum(["xtls-rprx-vision"]).nullable().default(null),
}).strict();

export const inboundClientRequestSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(320).nullable().default(null), credential: z.string().min(8).max(512).optional(),
  enabled: z.boolean().optional(), trafficLimit: nullableByteLimit.optional(), expiresAt: nullableDate.optional(),
  subscriptionEnabled: z.boolean().optional(), flow: z.enum(["xtls-rprx-vision"]).nullable().default(null),
}).strict();

export const inboundPatchSchema = inboundWriteObjectSchema.partial().omit({ serverId: true });
export const confirmationSchema = z.object({ confirmation: z.literal("CONFIRM") }).strict();
export const globalInboundActionSchema = z.object({
  action: z.enum(["RESET_ALL_INBOUND_TRAFFIC", "RESET_ALL_USER_TRAFFIC", "DELETE_EXPIRED_USERS", "ENABLE_ALL", "DISABLE_ALL"]),
  confirmation: z.literal("CONFIRM"),
}).strict();

export type InboundWriteInput = z.infer<typeof inboundWriteSchema>;
export type InboundPatchInput = z.infer<typeof inboundPatchSchema>;
export type InboundClientWriteInput = z.infer<typeof inboundClientWriteSchema>;
export type InboundClientRequestInput = z.infer<typeof inboundClientRequestSchema>;
