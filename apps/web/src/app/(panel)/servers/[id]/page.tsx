import type { Metadata } from "next";
import type { ServerSummary } from "@nr/shared";
import { ServerDetails } from "../../../../components/servers/ServerDetails";
import { serverApiRequest } from "../../../../lib/server-api";

export const metadata: Metadata = { title: "جزئیات سرور" };
export default async function ServerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServerDetails server={await serverApiRequest<ServerSummary>(`/servers/${encodeURIComponent(id)}`)} />;
}
