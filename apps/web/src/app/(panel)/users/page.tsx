import type { Metadata } from "next";
import type { SubpanelUsersPageData } from "@nr/shared";
import { MasterModulePlaceholder } from "../../../components/layout/MasterModulePlaceholder";
import { SubPanelUsers } from "../../../components/subpanel/SubPanelUsers";
import { currentPanelUser, isSubpanelUser } from "../../../lib/panel-auth";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "کاربران" };
const empty: SubpanelUsersPageData = { quota: { userLimit: null, createdUsers: 0, remainingUsers: null, trafficCredit: null, allocatedTraffic: "0", remainingAllocatableTraffic: null, actualTrafficUsed: "0", expiresAt: null, status: "DISABLED" }, capabilities: { subscription: false, trafficReset: false, extend: false, credentialRotation: false }, assignedInbounds: [], users: [] };

export default async function UsersPage() {
  const user = await currentPanelUser();
  if (!isSubpanelUser(user)) return <MasterModulePlaceholder title="کاربران VPN" description="مدیریت سراسری کاربران از ماژول پنل مادر انجام می‌شود." />;
  let data = empty; let initialError: string | null = null;
  try { data = await serverApiRequest<SubpanelUsersPageData>("/subpanel/users"); }
  catch (error) { initialError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس کاربران برقرار نشد."; }
  return <SubPanelUsers initialData={data} initialError={initialError} />;
}
