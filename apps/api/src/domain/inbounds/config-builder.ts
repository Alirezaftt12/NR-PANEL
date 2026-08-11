import { createHash } from "node:crypto";
import type { InboundSecurityConfig, InboundTransportConfig, SockoptConfig, XrayFallback } from "@nr/shared";
import { ApiError } from "../../lib/errors.js";
import type { DesiredInbound, XrayConfigDocument, XrayInboundConfig, XrayUser } from "./model.js";
import { protocolSlug } from "./model.js";

const loopbackAddresses = new Set(["127.0.0.1", "::1", "localhost"]);
const protectedAdvancedKeys = new Set(["tag", "listen", "port", "protocol", "settings", "streamSettings", "sniffing"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InboundConfigValidationError extends ApiError {
  constructor(public readonly validationErrors: string[]) {
    super(400, "XRAY_CONFIG_INVALID", "Generated Xray configuration is invalid", { errors: validationErrors });
  }
}

export function validateDesiredInbound(inbound: DesiredInbound, supportsXhttp = true) {
  const errors: string[] = [];
  if (inbound.protocolConfig.kind !== inbound.protocol) errors.push("Protocol adapter does not match the selected protocol");
  if (inbound.transportConfig.kind !== inbound.transport) errors.push("Transport adapter does not match the selected transport");
  if (inbound.securityConfig.kind !== inbound.security) errors.push("Security adapter does not match the selected security mode");
  if (inbound.transport === "XHTTP" && !supportsXhttp) errors.push("The selected Xray runtime does not advertise XHTTP support");
  if (inbound.security === "REALITY" && !["TCP", "GRPC", "XHTTP"].includes(inbound.transport)) errors.push("REALITY supports TCP/RAW, gRPC, and XHTTP transports only");
  if ((inbound.protocol === "VLESS" || inbound.protocol === "Trojan") && inbound.security === "NONE" && !loopbackAddresses.has(inbound.listenIp)) errors.push(`${inbound.protocol} without transport security is restricted to a loopback listener`);
  if (inbound.protocol === "Trojan" && inbound.security === "NONE" && !loopbackAddresses.has(inbound.listenIp)) errors.push("Trojan requires TLS or REALITY on public listeners");
  if (inbound.fallbacks.length > 0 && (!(["VLESS", "Trojan"] as string[]).includes(inbound.protocol) || inbound.transport !== "TCP" || inbound.security !== "TLS")) errors.push("Fallbacks are valid only for VLESS/Trojan with TCP and TLS");
  if (inbound.fallbacks.length > 0 && inbound.securityConfig.kind === "TLS" && !inbound.securityConfig.alpn.includes("http/1.1")) errors.push("TLS ALPN must include http/1.1 when fallbacks are configured");
  if (inbound.protocol === "VLESS" && inbound.clients.some((client) => client.flow === "xtls-rprx-vision") && !(inbound.transport === "TCP" && ["TLS", "REALITY"].includes(inbound.security))) errors.push("XTLS Vision flow requires VLESS over TCP with TLS or REALITY");
  if (inbound.advancedConfig) for (const key of Object.keys(inbound.advancedConfig)) if (protectedAdvancedKeys.has(key)) errors.push(`Advanced JSON cannot override protected field: ${key}`);
  const emails = new Set<string>();
  for (const client of inbound.clients.filter((entry) => entry.enabled)) {
    const email = client.email || `${client.publicId}@nr-panel.local`;
    if (emails.has(email)) errors.push(`Duplicate Xray client email: ${email}`);
    emails.add(email);
    if (inbound.protocol === "VMess" && !uuidPattern.test(client.credential)) errors.push(`VMess credential must be a UUID for ${client.name}`);
    if (inbound.protocol === "VLESS" && !uuidPattern.test(client.credential) && Buffer.byteLength(client.credential, "utf8") >= 30) errors.push(`VLESS credential must be a UUID or a custom ID shorter than 30 bytes for ${client.name}`);
    if (inbound.protocol === "Shadowsocks" && inbound.protocolConfig.kind === "Shadowsocks" && inbound.protocolConfig.method.startsWith("2022-") && client.credential.length < 16) errors.push(`Shadowsocks 2022 credential is too short for ${client.name}`);
  }
  if (errors.length > 0) throw new InboundConfigValidationError([...new Set(errors)]);
}

function buildUsers(inbound: DesiredInbound): XrayUser[] {
  return inbound.clients.filter((client) => client.enabled && (!client.expiresAt || Date.parse(client.expiresAt) > Date.now())).map((client) => {
    const email = client.email || `${client.publicId}@nr-panel.local`;
    if (inbound.protocol === "VLESS") return { id: client.credential, email, level: 0, ...(client.flow ? { flow: client.flow } : {}) };
    if (inbound.protocol === "VMess") return { id: client.credential, email, level: 0 };
    if (inbound.protocol === "Trojan") return { password: client.credential, email, level: 0 };
    return { password: client.credential, email, level: 0 };
  });
}

function buildFallbacks(fallbacks: XrayFallback[]) {
  return fallbacks.map((fallback) => ({
    ...(fallback.name ? { name: fallback.name } : {}), ...(fallback.alpn ? { alpn: fallback.alpn } : {}),
    ...(fallback.path ? { path: fallback.path } : {}), dest: fallback.destination, xver: fallback.proxyProtocolVersion,
  }));
}

function buildProtocolSettings(inbound: DesiredInbound, users: XrayUser[]) {
  switch (inbound.protocolConfig.kind) {
    case "VLESS": return { clients: users, decryption: inbound.protocolConfig.decryption, ...(inbound.fallbacks.length ? { fallbacks: buildFallbacks(inbound.fallbacks) } : {}) };
    case "VMess": return { users, default: { level: 0 }, disableInsecureEncryption: inbound.protocolConfig.disableInsecureEncryption };
    case "Trojan": return { users, ...(inbound.fallbacks.length ? { fallbacks: buildFallbacks(inbound.fallbacks) } : {}) };
    case "Shadowsocks": return { network: inbound.protocolConfig.network, method: inbound.protocolConfig.method, password: inbound.protocolConfig.serverPassword, users };
  }
}

function transportSettings(config: InboundTransportConfig, acceptProxyProtocol: boolean) {
  switch (config.kind) {
    case "TCP": return { method: "raw", rawSettings: { acceptProxyProtocol, header: config.headerType === "http" ? { type: "http", request: { path: [config.requestPath || "/"] }, response: {} } : { type: "none" } } };
    case "WEBSOCKET": return { method: "websocket", wsSettings: { path: config.path, ...(config.host ? { host: config.host } : {}), ...(config.heartbeatPeriod !== undefined ? { heartbeatPeriod: config.heartbeatPeriod } : {}), acceptProxyProtocol } };
    case "GRPC": return { method: "grpc", grpcSettings: { serviceName: config.serviceName, multiMode: config.multiMode, ...(config.idleTimeout !== undefined ? { idle_timeout: config.idleTimeout } : {}), ...(config.healthCheckTimeout !== undefined ? { health_check_timeout: config.healthCheckTimeout } : {}) } };
    case "XHTTP": return { method: "xhttp", xhttpSettings: { path: config.path, mode: config.mode, ...(config.host ? { host: config.host } : {}) } };
  }
}

function securitySettings(config: InboundSecurityConfig) {
  switch (config.kind) {
    case "NONE": return { security: "none" };
    case "TLS": return { security: "tls", tlsSettings: { ...(config.serverName ? { serverName: config.serverName } : {}), alpn: config.alpn, minVersion: config.minVersion, rejectUnknownSni: config.rejectUnknownSni, certificates: [{ certificateFile: config.certificateFile, keyFile: config.keyFile }] } };
    case "REALITY": return { security: "reality", realitySettings: { show: config.show, target: config.target, xver: config.proxyProtocolVersion, serverNames: config.serverNames, privateKey: config.privateKey, shortIds: config.shortIds } };
  }
}

function buildSockopt(config: SockoptConfig) {
  return {
    acceptProxyProtocol: config.acceptProxyProtocol, tcpFastOpen: config.tcpFastOpen, domainStrategy: config.domainStrategy,
    ...(config.tcpKeepAliveIdle !== undefined ? { tcpKeepAliveIdle: config.tcpKeepAliveIdle } : {}),
    ...(config.tcpKeepAliveInterval !== undefined ? { tcpKeepAliveInterval: config.tcpKeepAliveInterval } : {}),
    ...(config.tcpUserTimeout !== undefined ? { tcpUserTimeout: config.tcpUserTimeout } : {}),
    ...(config.congestion ? { tcpcongestion: config.congestion } : {}), ...(config.dialerProxy ? { dialerProxy: config.dialerProxy } : {}),
    ...(config.trustedXForwardedFor.length ? { trustedXForwardedFor: config.trustedXForwardedFor } : {}),
  };
}

export function buildXrayInbound(inbound: DesiredInbound, supportsXhttp = true): XrayInboundConfig {
  validateDesiredInbound(inbound, supportsXhttp);
  const users = buildUsers(inbound);
  const base: XrayInboundConfig = {
    tag: inbound.tag, listen: inbound.listenIp, port: inbound.port, protocol: protocolSlug(inbound.protocol),
    settings: buildProtocolSettings(inbound, users),
    streamSettings: { ...transportSettings(inbound.transportConfig, inbound.sockopt.acceptProxyProtocol), ...securitySettings(inbound.securityConfig), sockopt: buildSockopt(inbound.sockopt) },
    sniffing: { enabled: inbound.sniffing.enabled, destOverride: inbound.sniffing.destinationOverrides, metadataOnly: inbound.sniffing.metadataOnly, routeOnly: inbound.sniffing.routeOnly, domainsExcluded: inbound.sniffing.domainsExcluded, domainsOnly: inbound.sniffing.domainsOnly },
  };
  return inbound.advancedConfig ? { ...base, ...inbound.advancedConfig } : base;
}

export type XrayDocumentOptions = { logLevel: "debug" | "info" | "warning" | "error" | "none"; statsEnabled: boolean };
function documentOptions(options?: XrayDocumentOptions): Omit<XrayConfigDocument, "inbounds"> {
  if (!options) return {};
  return {
    log: { loglevel: options.logLevel },
    ...(options.statsEnabled ? {
      stats: {},
      policy: {
        levels: { "0": { statsUserUplink: true, statsUserDownlink: true, statsUserOnline: true } },
        system: { statsInboundUplink: true, statsInboundDownlink: true, statsOutboundUplink: true, statsOutboundDownlink: true },
      },
    } : {}),
  };
}

export function buildXrayDocument(inbound: DesiredInbound, supportsXhttp = true, options?: XrayDocumentOptions): XrayConfigDocument {
  return { ...documentOptions(options), inbounds: inbound.enabled ? [buildXrayInbound(inbound, supportsXhttp)] : [] };
}

export function buildXrayInstanceDocument(inbounds: DesiredInbound[], supportsXhttp = true, options?: XrayDocumentOptions): XrayConfigDocument {
  return { ...documentOptions(options), inbounds: inbounds.filter((inbound) => inbound.enabled).map((inbound) => buildXrayInbound(inbound, supportsXhttp)) };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
  return value;
}

export function stableJson(value: unknown) { return JSON.stringify(sortValue(value)); }
export function configHash(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
