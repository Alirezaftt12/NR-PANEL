import type { AgentAction } from "@nr/shared";
import { assertPermittedAction } from "../security/actions.js";
/** Production adapter invokes only explicit systemd unit actions; no user input reaches a shell. */
export interface XrayAdapter { status(): Promise<{running:boolean;version?:string}>; control(action: Extract<AgentAction,"xray.start"|"xray.stop"|"xray.restart">): Promise<void>; }
export class UnavailableXrayAdapter implements XrayAdapter { async status(){return{running:false}} async control(action: Extract<AgentAction,"xray.start"|"xray.stop"|"xray.restart">){assertPermittedAction(action);throw new Error("XRAY_ADAPTER_NOT_CONFIGURED")} }
