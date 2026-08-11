import type { Metadata } from "next";
import { SecurityCenter } from "../../../components/security/SecurityCenter";
import { serverApiRequest } from "../../../lib/server-api";

export const metadata: Metadata = { title: "مرکز امنیت" };

export default async function SecurityPage() {
  const data = await serverApiRequest<Parameters<typeof SecurityCenter>[0]["data"]>("/security/summary");
  return <SecurityCenter data={data} />;
}
