import type { InboundDetail, InboundProtocol } from "@nr/shared";

export type DesiredClient = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  publicId: string;
  credential: string;
  flow: string | null;
  enabled: boolean;
  trafficLimit: string | null;
  trafficUsed: string;
  expiresAt: string | null;
  subscriptionEnabled: boolean;
};

export type DesiredInbound = Omit<InboundDetail, "clients" | "clientCount" | "activeClientCount"> & {
  xrayInstanceId: string;
  clients: DesiredClient[];
};

export type XrayUser = { email: string; id?: string; password?: string; flow?: string; level: number; method?: string };
export type XrayInboundConfig = Record<string, unknown> & { tag: string; listen: string; port: number; protocol: string; settings: Record<string, unknown>; streamSettings: Record<string, unknown> };
export type XrayConfigDocument = {
  inbounds: XrayInboundConfig[];
  log?: { loglevel: "debug" | "info" | "warning" | "error" | "none" };
  stats?: Record<string, never>;
  policy?: {
    levels: { "0": { statsUserUplink: boolean; statsUserDownlink: boolean; statsUserOnline: boolean } };
    system: { statsInboundUplink: boolean; statsInboundDownlink: boolean; statsOutboundUplink: boolean; statsOutboundDownlink: boolean };
  };
};

export type ApplyStrategy = "NOOP" | "HOT_CLIENTS" | "HOT_INBOUND" | "RESTART_REQUIRED";
export type ApplyPlan = {
  strategy: ApplyStrategy;
  reason: string;
  addedUsers: XrayUser[];
  removedUserEmails: string[];
};

export type RuntimeCapabilities = { available: boolean; handlerService: boolean; userMutation: boolean; xhttp: boolean; configTest: boolean; statsReset: boolean };

export interface XrayRuntime {
  capabilities(instanceId: string): Promise<RuntimeCapabilities>;
  currentConfig(instanceId: string): Promise<XrayConfigDocument>;
  validateConfig(instanceId: string, config: XrayConfigDocument): Promise<void>;
  hotAddUsers(instanceId: string, inboundTag: string, users: XrayUser[]): Promise<void>;
  hotRemoveUsers(instanceId: string, inboundTag: string, emails: string[]): Promise<void>;
  hotReplaceInbound(instanceId: string, previousTag: string | null, inbound: XrayInboundConfig | null): Promise<void>;
  restartWithConfig(instanceId: string, config: XrayConfigDocument): Promise<void>;
  healthCheck(instanceId: string): Promise<void>;
  restoreConfig(instanceId: string, config: XrayConfigDocument): Promise<void>;
  resetTraffic(instanceId: string, inboundTag?: string, userEmail?: string): Promise<void>;
}

export function protocolSlug(protocol: InboundProtocol) {
  return protocol.toLowerCase();
}
