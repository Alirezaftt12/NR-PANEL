export class ClientApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly requestId?: string) {
    super(message);
    this.name = "ClientApiError";
  }
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const stateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(stateChanging ? { "x-nr-csrf": "1" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { code?: string; message?: string; requestId?: string } } | null;
  if (!response.ok) {
    throw new ClientApiError(
      response.status,
      payload?.error?.code || "REQUEST_FAILED",
      payload?.error?.message || "Request failed",
      payload?.error?.requestId,
    );
  }
  return payload?.data as T;
}

export async function downloadApiFile(path: string, fallbackName: string) {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; requestId?: string } } | null;
    throw new ClientApiError(response.status, payload?.error?.code || "DOWNLOAD_FAILED", payload?.error?.message || "Download failed", payload?.error?.requestId);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = match?.[1] || fallbackName; anchor.click();
  URL.revokeObjectURL(url);
}
