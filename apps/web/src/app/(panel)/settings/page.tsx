import type { Metadata } from "next";
import type { ApiTokenSummary, MasterSettingsSnapshot, SubpanelSettingsData } from "@nr/shared";
import { MasterSettingsCenter } from "../../../components/settings/MasterSettingsCenter";
import { SubPanelSettings, type AccountSession } from "../../../components/subpanel/SubPanelSettings";
import { currentPanelUser, isSubpanelUser } from "../../../lib/panel-auth";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "تنظیمات" };
const empty: SubpanelSettingsData = { panelName: "NR SUB PANEL", displayName: "—", username: "—", email: null, theme: "light", language: "fa", capabilities: { subscription: false, trafficReset: false, extend: false, credentialRotation: false } };

export default async function SettingsPage() {
  const user = await currentPanelUser();
  if (!isSubpanelUser(user)) {
    let snapshot: MasterSettingsSnapshot | null = null; let tokens: ApiTokenSummary[] = []; let initialError: string | null = null;
    try { [snapshot, tokens] = await Promise.all([serverApiRequest<MasterSettingsSnapshot>("/settings"), serverApiRequest<ApiTokenSummary[]>("/settings/api-tokens")]); }
    catch (error) { initialError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس تنظیمات برقرار نشد."; }
    return <MasterSettingsCenter initialSnapshot={snapshot} initialTokens={tokens} initialError={initialError} />;
  }
  let settings = { ...empty, username: user?.username ?? "—" }; let sessions: AccountSession[] = []; let initialError: string | null = null;
  try { [settings, sessions] = await Promise.all([serverApiRequest<SubpanelSettingsData>("/subpanel/settings"), serverApiRequest<AccountSession[]>("/auth/sessions")]); }
  catch (error) { initialError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس تنظیمات برقرار نشد."; }
  return <SubPanelSettings settings={settings} sessions={sessions} error={initialError} />;
}
