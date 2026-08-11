import { agentActions, type AgentAction } from "@nr/shared";
export function assertPermittedAction(action: string): asserts action is AgentAction { if (!agentActions.includes(action as AgentAction)) throw new Error("Action is not permitted by NR PANEL agent policy"); }
export const actionNeedsConfirmation = (action: AgentAction) => action === "system.reboot" || action === "system.shutdown" || action === "xray.stop";
