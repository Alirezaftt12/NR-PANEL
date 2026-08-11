import "server-only";
import { cookies } from "next/headers";

const apiBaseUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

export class ServerApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export async function serverApiRequest<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    headers: { cookie: cookieStore.toString() },
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new ServerApiError(response.status, payload?.error?.code || "REQUEST_FAILED", payload?.error?.message || "Request failed");
  return payload?.data as T;
}
