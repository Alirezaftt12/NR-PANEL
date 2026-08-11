import { ApiError } from "../../lib/errors.js";
import type { RuntimeCapabilities, XrayConfigDocument, XrayRuntime } from "./model.js";

export class UnavailableXrayRuntime implements XrayRuntime {
  private unavailable(): never { throw new ApiError(503, "AGENT_UNAVAILABLE", "The server agent is disconnected; desired state was not applied"); }
  async capabilities(): Promise<RuntimeCapabilities> { return { available: false, handlerService: false, userMutation: false, xhttp: false, configTest: false, statsReset: false }; }
  async currentConfig(): Promise<XrayConfigDocument> { return this.unavailable(); }
  async validateConfig(): Promise<void> { this.unavailable(); }
  async hotAddUsers(): Promise<void> { this.unavailable(); }
  async hotRemoveUsers(): Promise<void> { this.unavailable(); }
  async hotReplaceInbound(): Promise<void> { this.unavailable(); }
  async restartWithConfig(): Promise<void> { this.unavailable(); }
  async healthCheck(): Promise<void> { this.unavailable(); }
  async restoreConfig(): Promise<void> { this.unavailable(); }
  async resetTraffic(): Promise<void> { this.unavailable(); }
}
