import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NR PANEL",
    template: "%s | NR PANEL",
  },
  description: "پنل فارسی مدیریت زیرساخت VPN و Xray",
};

const themeInitializer = `
  try {
    const storedTheme = localStorage.getItem('nr-theme');
    document.documentElement.dataset.theme = storedTheme === 'dark' ? 'dark' : 'light';
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
  }
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" data-theme="light" suppressHydrationWarning>
      <body>
        <Script id="nr-theme-initializer" strategy="beforeInteractive">
          {themeInitializer}
        </Script>
        {children}
      </body>
    </html>
  );
}
