"use client";

import { Bell, Expand, Menu, Moon, RefreshCw, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition } from "react";
import type { Theme } from "../../lib/theme-store";
import { IconButton } from "../ui/IconButton";
import { pageTitles } from "./navigation";

let currentSecond = Math.floor(Date.now() / 1000);
const timeListeners = new Set<() => void>();
let timeTimer: ReturnType<typeof setInterval> | undefined;

function subscribeToClock(listener: () => void) {
  timeListeners.add(listener);
  if (!timeTimer) {
    timeTimer = setInterval(() => {
      currentSecond = Math.floor(Date.now() / 1000);
      timeListeners.forEach((timeListener) => timeListener());
    }, 1000);
  }
  return () => {
    timeListeners.delete(listener);
    if (timeListeners.size === 0 && timeTimer) {
      clearInterval(timeTimer);
      timeTimer = undefined;
    }
  };
}

function getClockSnapshot() {
  return currentSecond;
}

function getServerClockSnapshot() {
  return 0;
}

type TopbarProps = {
  theme: Theme;
  onToggleTheme: () => void;
  onOpenMobile: () => void;
};

export function Topbar({ theme, onToggleTheme, onOpenMobile }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const second = useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);
  const title = pageTitles[pathname] ?? "NR PANEL";
  const currentTime = second === 0
    ? "--:--:--"
    : new Date(second * 1000).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function refreshPage() {
    startRefresh(() => router.refresh());
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  return (
    <header className="app-topbar">
      <div className="topbar-title-group">
        <IconButton className="mobile-menu-button" label="باز کردن منوی اصلی" onClick={onOpenMobile}>
          <Menu size={20} />
        </IconButton>
        <div>
          <h1>{title}</h1>
          <span className="topbar-production-state">REAL DATA ONLY</span>
        </div>
      </div>

      <div className="topbar-actions">
        <time className="topbar-clock" dateTime={second ? new Date(second * 1000).toISOString() : undefined} dir="ltr">
          {currentTime}
        </time>
        <IconButton label="تغییر پوسته" onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
        <Link className="icon-button notification-button" href="/notifications" aria-label="مشاهده اعلان‌ها" title="اعلان‌ها">
          <Bell size={18} />
          <span className="notification-dot" aria-label="اعلان خوانده‌نشده" />
        </Link>
        <IconButton label="نمایش تمام‌صفحه" onClick={toggleFullscreen}>
          <Expand size={18} />
        </IconButton>
        <IconButton label="تازه‌سازی دستی" onClick={refreshPage} disabled={refreshing}>
          <RefreshCw className={refreshing ? "is-spinning" : ""} size={18} />
        </IconButton>
      </div>
    </header>
  );
}
