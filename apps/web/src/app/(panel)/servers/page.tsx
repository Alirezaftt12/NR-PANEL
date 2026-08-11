import type { Metadata } from "next";
import type { ServerSummary } from "@nr/shared";
import { ServersManagement } from "../../../components/servers/ServersManagement";
import { serverApiRequest, ServerApiError } from "../../../lib/server-api";

export const metadata: Metadata = { title: "سرورها" };

export default async function ServersPage() {
  let servers: ServerSummary[] = [];
  let errorMessage: string | undefined;
  try { servers = await serverApiRequest<ServerSummary[]>("/servers"); }
  catch (error) { errorMessage = error instanceof ServerApiError ? error.message : "ارتباط با سرویس سرورها برقرار نشد."; }
  return <ServersManagement initialServers={servers} initialError={errorMessage} />;
}
