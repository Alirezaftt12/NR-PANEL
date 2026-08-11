import { AppShell } from "../../components/layout/AppShell";
import { AuthBoundary } from "../../components/auth/AuthBoundary";
import { AuthProvider } from "../../components/auth/AuthProvider";

export default function PanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthProvider>
      <AuthBoundary>
        <AppShell>{children}</AppShell>
      </AuthBoundary>
    </AuthProvider>
  );
}
