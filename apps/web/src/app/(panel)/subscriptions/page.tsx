import type { Metadata } from "next";
import type { SubpanelSubscriptionSummary } from "@nr/shared";
import { MasterModulePlaceholder } from "../../../components/layout/MasterModulePlaceholder";
import { SubPanelSubscriptions } from "../../../components/subpanel/SubPanelSubscriptions";
import { currentPanelUser, isSubpanelUser } from "../../../lib/panel-auth";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "اشتراک‌ها" };

export default async function SubscriptionsPage() {
  const user = await currentPanelUser();
  if (!isSubpanelUser(user)) return <MasterModulePlaceholder title="اشتراک‌ها" description="مدیریت سراسری اشتراک‌ها در پنل مادر مستقل است." />;
  let data: SubpanelSubscriptionSummary[] = []; let initialError: string | null = null;
  try { data = await serverApiRequest<SubpanelSubscriptionSummary[]>("/subpanel/subscriptions"); }
  catch (error) { initialError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس اشتراک برقرار نشد."; }
  return <SubPanelSubscriptions subscriptions={data} error={initialError} />;
}
