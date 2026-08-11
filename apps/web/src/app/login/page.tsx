"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { refreshAuth, type AuthUser } from "../../lib/auth-store";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(formData: FormData) {
    setBusy(true);
    setError("");
    try {
      await apiRequest<AuthUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: formData.get("identifier"), password: formData.get("password") }),
      });
      await refreshAuth();
      router.replace("/dashboard");
    } catch (loginError) {
      if (loginError instanceof ClientApiError && loginError.code === "AUTH_RATE_LIMITED") {
        setError("تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره امتحان کنید.");
      } else if (loginError instanceof ClientApiError && loginError.status === 401) {
        setError("نام کاربری/ایمیل یا گذرواژه نامعتبر است.");
      } else {
        setError("ارتباط با سرویس احراز هویت برقرار نشد.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form action={submit} className="login-card">
        <div className="brand-mark"><ShieldCheck size={26} /></div>
        <h1>NR PANEL</h1>
        <p>ورود امن به پنل مدیریت زیرساخت</p>
        <label>
          نام کاربری یا ایمیل
          <input name="identifier" autoComplete="username" required />
        </label>
        <label>
          گذرواژه
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <div aria-live="polite">{error ? <p className="form-error">{error}</p> : null}</div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "در حال ورود…" : "ورود به پنل"}
        </Button>
        <small>ورود فقط با حسابی که از طریق فرآیند امن OWNER ایجاد شده امکان‌پذیر است.</small>
      </form>
    </main>
  );
}
