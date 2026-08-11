export async function sendHeartbeat(baseUrl: string, credential: string, metrics: Record<string, unknown>) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/agents/heartbeat`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credential}` }, body: JSON.stringify(metrics), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new Error(`Heartbeat rejected: ${payload?.error?.code || response.status}`);
  }
  return response.json();
}
