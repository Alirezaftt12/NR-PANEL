import type { MasterDashboardData, ServerJoinCommand } from "@nr/shared";
import { ApiError } from "../../lib/errors.js";
import { environment } from "../../lib/environment.js";
import type { AuthContext, RequestMetadata } from "../identity.js";
import type { SettingsService } from "../settings/service.js";
import type { ServerRepository } from "./repository.js";
import type { AgentHeartbeatInput, ServerCreateInput } from "./schemas.js";

function shellQuote(value: string) { return `'${value.replace(/'/g, `'"'"'`)}'`; }

export class ServerService {
  constructor(private readonly repository: ServerRepository, private readonly settings?: SettingsService) {}
  list(auth: AuthContext) { return this.repository.list(auth); }
  create(input: ServerCreateInput, auth: AuthContext, metadata: RequestMetadata) { return this.repository.create(input, auth, metadata); }

  private async masterUrl() {
    const configured = (await this.settings?.value("general"))?.publicPanelUrl || environment.masterPublicUrl;
    if (!configured) throw new ApiError(503, "MASTER_PUBLIC_URL_REQUIRED", "Configure the public Master Panel URL before generating a server install command");
    return configured.replace(/\/$/, "");
  }

  async joinCommand(serverId: string, auth: AuthContext, metadata: RequestMetadata): Promise<ServerJoinCommand> {
    if (!environment.nodeInstallUrl) throw new ApiError(503, "NODE_INSTALL_SOURCE_REQUIRED", "NR_PANEL_NODE_INSTALL_URL is not configured for this installation");
    const issued = await this.repository.issueJoinToken(serverId, auth, metadata, environment.serverJoinTtlSeconds);
    const masterUrl = await this.masterUrl();
    return { serverId, joinToken: issued.token, expiresAt: issued.expiresAt.toISOString(), masterUrl, installCommand: `bash <(curl -fsSL ${shellQuote(environment.nodeInstallUrl)}) --master-url ${shellQuote(masterUrl)} --join-token ${shellQuote(issued.token)}` };
  }

  enroll(joinToken: string, input: { hostname: string; publicAddress: string | null; agentVersion: string }, requestIp: string | null) { return this.repository.enroll(joinToken, input, requestIp); }
  heartbeat(credential: string, input: AgentHeartbeatInput, requestIp: string | null) { return this.repository.heartbeat(credential, input, requestIp); }
  agentStatus(credential: string) { return this.repository.agentStatus(credential); }
  async dashboard(auth: AuthContext): Promise<MasterDashboardData> {
    const servers = await this.repository.list(auth);
    const server = servers.find((item) => item.status === "ONLINE") ?? servers[0] ?? null;
    return { state: server?.dataState ?? "DISCONNECTED", updatedAt: server?.lastMetricsAt ?? null, server };
  }
}
