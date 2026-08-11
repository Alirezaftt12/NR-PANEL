import type { Metadata } from "next";
import { DashboardOverview } from "../../../components/dashboard/DashboardOverview";
import { disconnectedDashboardData, mapDashboardData } from "../../../lib/dashboard-data";
import type { MasterDashboardData } from "@nr/shared";
import type { SubpanelDashboardData } from "@nr/shared";
import { SubPanelDashboard } from "../../../components/subpanel/SubPanelDashboard";
import { currentPanelUser, isSubpanelUser } from "../../../lib/panel-auth";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = {
  title: "داشبورد",
};

export default async function DashboardPage() {
  const user = await currentPanelUser();
  if (isSubpanelUser(user)) {
    const disconnected: SubpanelDashboardData = { panelName: "NR SUB PANEL", quota: { userLimit: null, createdUsers: 0, remainingUsers: null, trafficCredit: null, allocatedTraffic: "0", remainingAllocatableTraffic: null, actualTrafficUsed: "0", expiresAt: null, status: "DISABLED" }, capabilities: { subscription: false, trafficReset: false, extend: false, credentialRotation: false }, servers: [] };
    let portalData = disconnected; let portalError: string | null = null;
    try { portalData = await serverApiRequest<SubpanelDashboardData>("/subpanel/dashboard"); }
    catch (error) { portalError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس زیرپنل برقرار نشد."; }
    return <SubPanelDashboard data={portalData} error={portalError} />;
  }
  let dashboardData = disconnectedDashboardData;
  try { dashboardData = mapDashboardData(await serverApiRequest<MasterDashboardData>("/dashboard")); }
  catch { /* The disconnected state deliberately contains no fallback metrics. */ }
  return <DashboardOverview data={dashboardData} />;
}
