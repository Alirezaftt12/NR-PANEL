import QRCode from "qrcode";
import type { AuthContext } from "../identity.js";
import type { InboundService } from "../inbounds/service.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/security.js";
import type { KyselySubpanelRepository, PortalMutationResult } from "./repository.js";
import type { SettingsService } from "../settings/service.js";
import type {
  MasterSubpanelCreateInput,
  MasterSubpanelPatchInput,
  PortalBulkActionInput,
  PortalSettingsPatchInput,
  PortalUserActionInput,
  PortalUserCreateInput,
  PortalUserPatchInput,
} from "./schemas.js";

type RequestContext = { requestId: string; ip: string | null };

export class SubpanelService {
  constructor(private readonly repository: KyselySubpanelRepository, private readonly inbounds: InboundService, private readonly masterSettings?: SettingsService) {}

  dashboard(auth: AuthContext) { return this.repository.dashboard(auth); }
  usersPage(auth: AuthContext) { return this.repository.usersPage(auth); }
  traffic(auth: AuthContext, range: "24h" | "7d" | "30d" | "all") { return this.repository.traffic(auth, range); }
  subscriptions(auth: AuthContext) { return this.repository.subscriptions(auth); }
  settings(auth: AuthContext) { return this.repository.portalSettings(auth); }
  updateSettings(auth: AuthContext, input: PortalSettingsPatchInput, request: RequestContext) { return this.repository.updatePortalSettings(auth, input, request); }
  configUri(auth: AuthContext, userId: string) { return this.repository.configUri(auth, userId); }
  async subscriptionUrl(auth: AuthContext, userId: string) {
    const settings = await this.masterSettings?.value("subscription");
    if (settings && !settings.enabled) throw new ApiError(404, "SUBSCRIPTION_DISABLED", "Public subscriptions are disabled by the OWNER");
    const current = await this.repository.subscriptionUrl(auth, userId);
    if (!settings?.publicUrl) return current;
    return `${settings.publicUrl.replace(/\/$/, "")}/${current.slice(current.lastIndexOf("/") + 1)}`;
  }
  async rotateSubscription(auth: AuthContext, userId: string, request: RequestContext) {
    const settings = await this.masterSettings?.value("subscription");
    if (settings && !settings.enabled) throw new ApiError(409, "SUBSCRIPTION_DISABLED", "Public subscriptions are disabled by the OWNER");
    return this.repository.rotateSubscription(auth, userId, request);
  }
  async setSubscriptionEnabled(auth: AuthContext, userId: string, enabled: boolean, request: RequestContext) {
    if (enabled && this.masterSettings && !(await this.masterSettings.value("subscription")).enabled) throw new ApiError(409, "SUBSCRIPTION_DISABLED", "Public subscriptions are disabled by the OWNER");
    return this.repository.setSubscriptionEnabled(auth, userId, enabled, request);
  }
  async consumeSubscription(token: string) {
    if (this.masterSettings && !(await this.masterSettings.value("subscription")).enabled) throw new ApiError(404, "SUBSCRIPTION_DISABLED", "Public subscriptions are disabled");
    return this.repository.consumeSubscription(token);
  }
  exportUsers(auth: AuthContext, kind: "configs" | "subscriptions", request: RequestContext) { return this.repository.exportUsers(auth, kind, request); }
  listMaster(auth: AuthContext) { return this.repository.listMaster(auth); }
  async masterOptions(auth: AuthContext) {
    const [options, defaults] = await Promise.all([this.repository.masterOptions(auth), this.masterSettings?.subpanelDefaults()]);
    return { ...options, ...(defaults ? { defaults } : {}) };
  }

  private async withQuotaAudit<T>(auth: AuthContext, request: RequestContext, operation: () => Promise<T>) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ApiError && (error.code === "USER_LIMIT_EXCEEDED" || error.code === "TRAFFIC_QUOTA_EXCEEDED")) {
        await this.repository.recordPortalRejection(auth, error.code, request);
      }
      throw error;
    }
  }

  private async apply(result: PortalMutationResult, auth: AuthContext, shouldApply = true) {
    const apply = shouldApply
      ? await Promise.all(result.inboundIds.map(async (inboundId) => ({ inboundId, outcome: await this.inbounds.applyAssignedClientChange(inboundId, auth.userId) })))
      : [];
    return { ...result, apply };
  }

  private async resetRuntimeTraffic(result: PortalMutationResult, auth: AuthContext) {
    await Promise.all((result.trafficTargets ?? []).map((target) => this.inbounds.resetAssignedClientTraffic(target.inboundId, target.clientId, auth.userId)));
    return { ...result, apply: [] };
  }

  async createUser(auth: AuthContext, input: PortalUserCreateInput, request: RequestContext) {
    if (input.subscriptionEnabled && this.masterSettings && !(await this.masterSettings.value("subscription")).enabled) throw new ApiError(409, "SUBSCRIPTION_DISABLED", "Public subscriptions are disabled by the OWNER");
    return this.withQuotaAudit(auth, request, async () => this.apply(await this.repository.createUser(auth, input, request), auth));
  }

  updateUser(auth: AuthContext, userId: string, input: PortalUserPatchInput, request: RequestContext) {
    return this.withQuotaAudit(auth, request, async () => this.apply(await this.repository.updateUser(auth, userId, input, request), auth));
  }

  userAction(auth: AuthContext, userId: string, input: PortalUserActionInput, request: RequestContext) {
    return this.withQuotaAudit(auth, request, async () => {
      const result = await this.repository.userAction(auth, userId, input, request);
      return input.action === "RESET_TRAFFIC" ? this.resetRuntimeTraffic(result, auth) : this.apply(result, auth, input.action !== "INCREASE_TRAFFIC");
    });
  }

  bulkAction(auth: AuthContext, input: PortalBulkActionInput, request: RequestContext) {
    return this.withQuotaAudit(auth, request, async () => {
      const result = await this.repository.bulkAction(auth, input, request);
      return input.action === "RESET_TRAFFIC" ? this.resetRuntimeTraffic(result, auth) : this.apply(result, auth, input.action !== "INCREASE_TRAFFIC");
    });
  }

  async qrDataUrl(value: string) {
    const svg = await QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#10131a", light: "#ffffff" } });
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  }

  async createMaster(auth: AuthContext, input: MasterSubpanelCreateInput, request: RequestContext) {
    return this.repository.createMaster(auth, input, await hashPassword(input.password), request);
  }

  async updateMaster(auth: AuthContext, tenantId: string, input: MasterSubpanelPatchInput, request: RequestContext) {
    return this.repository.updateMaster(auth, tenantId, input, input.password ? await hashPassword(input.password) : null, request);
  }
}
