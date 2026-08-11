import type { InboundsPageData } from "@nr/shared";
import type { Metadata } from "next";
import { InboundsManagement } from "../../../components/inbounds/InboundsManagement";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "مدیریت ورودی‌های Xray" };

const disconnectedData: InboundsPageData = {
  inbounds: [], servers: [],
  runtime: { state: "DISCONNECTED", message: "API یا پایگاه داده در دسترس نیست؛ هیچ داده نمایشی یا موفقیت ساختگی تولید نشده است.", supportsXhttp: false, supportsHotApply: false },
};

export default async function InboundsPage() {
  let data = disconnectedData;
  let initialError: string | null = null;
  try {
    data = await serverApiRequest<InboundsPageData>("/inbounds");
  } catch (error) {
    initialError = error instanceof ServerApiError ? error.message : "اتصال به API ورودی‌ها برقرار نشد.";
  }
  return <InboundsManagement initialData={data} initialError={initialError} />;
}
