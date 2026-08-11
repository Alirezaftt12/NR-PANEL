import { createPrivateKey, createPublicKey } from "node:crypto";
import type { InboundProtocol, InboundSecurityConfig, InboundTransportConfig } from "@nr/shared";

export type AssignedInboundConfig = {
  name: string;
  protocol: InboundProtocol;
  host: string;
  port: number;
  transport: InboundTransportConfig;
  security: InboundSecurityConfig;
  protocolConfig: Record<string, unknown>;
};

function base64Url(value: string) { return Buffer.from(value, "utf8").toString("base64url"); }

function realityPublicKey(privateKey: string) {
  try {
    const raw = Buffer.from(privateKey, "base64url");
    if (raw.length !== 32) return null;
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), raw]);
    const publicDer = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }) as Buffer;
    return publicDer.subarray(-32).toString("base64url");
  } catch { return null; }
}

function commonQuery(config: AssignedInboundConfig) {
  const query = new URLSearchParams();
  const transportType = config.transport.kind === "WEBSOCKET" ? "ws" : config.transport.kind.toLowerCase();
  query.set("type", transportType);
  if (config.transport.kind === "WEBSOCKET" || config.transport.kind === "XHTTP") {
    query.set("path", config.transport.path);
    if (config.transport.host) query.set("host", config.transport.host);
  }
  if (config.transport.kind === "GRPC") query.set("serviceName", config.transport.serviceName);
  if (config.transport.kind === "TCP" && config.transport.headerType !== "none") query.set("headerType", config.transport.headerType);
  if (config.security.kind === "NONE") query.set("security", "none");
  if (config.security.kind === "TLS") {
    query.set("security", "tls");
    if (config.security.serverName) query.set("sni", config.security.serverName);
    if (config.security.alpn.length) query.set("alpn", config.security.alpn.join(","));
  }
  if (config.security.kind === "REALITY") {
    query.set("security", "reality");
    query.set("sni", config.security.serverNames[0] || config.host);
    query.set("sid", config.security.shortIds[0] || "");
    const publicKey = realityPublicKey(config.security.privateKey);
    if (publicKey) query.set("pbk", publicKey);
    query.set("fp", "chrome");
  }
  return query;
}

export function generateClientUri(config: AssignedInboundConfig, credential: string, label: string) {
  const name = encodeURIComponent(label || config.name);
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  if (config.protocol === "VMess") {
    const query = commonQuery(config);
    const payload = {
      v: "2", ps: label, add: config.host, port: String(config.port), id: credential, aid: "0", scy: "auto",
      net: query.get("type") || "tcp", type: "none", host: query.get("host") || "", path: query.get("path") || query.get("serviceName") || "",
      tls: config.security.kind === "NONE" ? "" : config.security.kind.toLowerCase(), sni: query.get("sni") || "", alpn: query.get("alpn") || "",
    };
    return `vmess://${base64Url(JSON.stringify(payload))}`;
  }
  if (config.protocol === "Shadowsocks") {
    const method = typeof config.protocolConfig.method === "string" ? config.protocolConfig.method : "chacha20-poly1305";
    return `ss://${base64Url(`${method}:${credential}`)}@${host}:${config.port}#${name}`;
  }
  const query = commonQuery(config);
  if (config.protocol === "VLESS") query.set("encryption", "none");
  const scheme = config.protocol === "Trojan" ? "trojan" : "vless";
  return `${scheme}://${encodeURIComponent(credential)}@${host}:${config.port}?${query.toString()}#${name}`;
}
