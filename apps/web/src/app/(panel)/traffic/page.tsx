import type { Metadata } from "next";
import type { SubpanelTrafficData } from "@nr/shared";
import { MasterModulePlaceholder } from "../../../components/layout/MasterModulePlaceholder";
import { SubPanelTraffic } from "../../../components/subpanel/SubPanelTraffic";
import { currentPanelUser, isSubpanelUser } from "../../../lib/panel-auth";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "ترافیک" };

export default async function TrafficPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await currentPanelUser();
  if (!isSubpanelUser(user)) return <MasterModulePlaceholder title="ترافیک" description="گزارش سراسری ترافیک در فضای پنل مادر نگه‌داری می‌شود." />;
  const value = (await searchParams).range;
  const range = value === "24h" || value === "30d" || value === "all" ? value : "7d";
  const empty: SubpanelTrafficData = { range, quota: { userLimit: null, createdUsers: 0, remainingUsers: null, trafficCredit: null, allocatedTraffic: "0", remainingAllocatableTraffic: null, actualTrafficUsed: "0", expiresAt: null, status: "DISABLED" }, series: [], topUsers: [], byInbound: [], dataState: "DISCONNECTED" };
  let data = empty; let initialError: string | null = null;
  try { data = await serverApiRequest<SubpanelTrafficData>(`/subpanel/traffic?range=${range}`); }
  catch (error) { initialError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس ترافیک برقرار نشد."; }
  return <SubPanelTraffic data={data} error={initialError} />;
}
