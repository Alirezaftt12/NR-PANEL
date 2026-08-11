"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";

export function AuthBoundary({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "authenticated") return children;
  if (auth.status === "error") {
    return (
      <main className="auth-gate">
        <ShieldCheck size={26} />
        <h1>خطا در بررسی نشست</h1>
        <p>{auth.error}</p>
        <Button variant="primary" onClick={auth.retry}>تلاش دوباره</Button>
      </main>
    );
  }
  return <main className="auth-gate"><span className="auth-loader" /><p>در حال بررسی نشست امن…</p></main>;
}
