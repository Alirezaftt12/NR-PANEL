import type { Metadata } from "next";
import type { MasterSubpanelOptions, MasterSubpanelSummary } from "@nr/shared";
import { MasterModulePlaceholder } from "../../../components/layout/MasterModulePlaceholder";
import { MasterSubpanels } from "../../../components/subpanel/MasterSubpanels";
import { currentPanelUser } from "../../../lib/panel-auth";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "زیرپنل‌ها" };

export default async function SubpanelsPage() {
  const user = await currentPanelUser();
  if (user?.role !== "OWNER") return <MasterModulePlaceholder title="دسترسی مجاز نیست" description="تنظیم زیرپنل‌ها فقط برای OWNER در دسترس است." />;
  let items: MasterSubpanelSummary[] = []; let options: MasterSubpanelOptions = { servers: [], inbounds: [] }; let initialError: string | null = null;
  try { [items, options] = await Promise.all([serverApiRequest<MasterSubpanelSummary[]>("/subpanels"), serverApiRequest<MasterSubpanelOptions>("/subpanels/options")]); }
  catch (error) { initialError = error instanceof ServerApiError ? error.message : "ارتباط با سرویس زیرپنل‌ها برقرار نشد."; }
  return <MasterSubpanels initialData={items} options={options} error={initialError} />;
}
