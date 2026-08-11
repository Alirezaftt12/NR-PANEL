import type { ApplyPlan, XrayConfigDocument, XrayInboundConfig, XrayUser } from "./model.js";
import { stableJson } from "./config-builder.js";

function users(config: XrayInboundConfig | undefined) {
  const settings = config?.settings as { clients?: XrayUser[]; users?: XrayUser[] } | undefined;
  return settings?.clients || settings?.users || [];
}

function withoutUsers(config: XrayInboundConfig | undefined) {
  if (!config) return null;
  const settings = { ...config.settings };
  delete (settings as { clients?: unknown }).clients;
  delete (settings as { users?: unknown }).users;
  return { ...config, settings };
}

export function computeApplyPlan(previous: XrayConfigDocument, next: XrayConfigDocument, previousTag: string | null, nextTag: string): ApplyPlan {
  if (stableJson(previous) === stableJson(next)) return { strategy: "NOOP", reason: "Desired and applied Xray configs are identical", addedUsers: [], removedUserEmails: [] };
  const previousGlobal = { log: previous.log, stats: previous.stats, policy: previous.policy };
  const nextGlobal = { log: next.log, stats: next.stats, policy: next.policy };
  if (stableJson(previousGlobal) !== stableJson(nextGlobal)) return { strategy: "RESTART_REQUIRED", reason: "Global Xray log, statistics, or policy settings changed", addedUsers: [], removedUserEmails: [] };
  const previousInbound = previousTag ? previous.inbounds.find((inbound) => inbound.tag === previousTag) : undefined;
  const nextInbound = next.inbounds.find((inbound) => inbound.tag === nextTag);
  if (!previousInbound || !nextInbound) return { strategy: "HOT_INBOUND", reason: "Inbound enablement or lifecycle changed", addedUsers: [], removedUserEmails: [] };
  if (stableJson(withoutUsers(previousInbound)) === stableJson(withoutUsers(nextInbound))) {
    const previousUsers = new Map(users(previousInbound).map((user) => [user.email, user]));
    const nextUsers = new Map(users(nextInbound).map((user) => [user.email, user]));
    const removedUserEmails = [...previousUsers.keys()].filter((email) => !nextUsers.has(email) || stableJson(previousUsers.get(email)) !== stableJson(nextUsers.get(email)));
    const addedUsers = [...nextUsers.values()].filter((user) => !previousUsers.has(user.email) || stableJson(previousUsers.get(user.email)) !== stableJson(user));
    return { strategy: "HOT_CLIENTS", reason: "Only child client credentials or membership changed", addedUsers, removedUserEmails };
  }
  const advancedChanged = stableJson((previousInbound as { allocate?: unknown }).allocate) !== stableJson((nextInbound as { allocate?: unknown }).allocate);
  return advancedChanged
    ? { strategy: "RESTART_REQUIRED", reason: "Advanced inbound allocation changed", addedUsers: [], removedUserEmails: [] }
    : { strategy: "HOT_INBOUND", reason: "Typed inbound listener, protocol, transport, or security changed", addedUsers: [], removedUserEmails: [] };
}
