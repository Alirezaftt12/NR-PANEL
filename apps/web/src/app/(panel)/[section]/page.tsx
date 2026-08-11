import { AlertCircle, Database, LockKeyhole, Plus, Server, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/StatusBadge";

type SectionContent = { title: string; description: string; cta?: string };

const content: Record<string, SectionContent> = {
  users: { title: "کاربران VPN", description: "مدیریت کاربران و دسترسی‌ها در فاز مدیریت کاربران تکمیل می‌شود.", cta: "ایجاد کاربر" },
  subpanels: { title: "زیرپنل‌ها", description: "مدیریت نمایندگان، سهمیه‌ها و سرورهای تخصیص‌یافته.", cta: "ایجاد زیرپنل" },
  configs: { title: "کانفیگ‌ها", description: "تولید کانفیگ‌های VLESS، VMess، Trojan و Shadowsocks از سرویس backend." },
  subscriptions: { title: "اشتراک‌ها", description: "اشتراک‌های tenantها و کاربران با کنترل دسترسی سمت سرور." },
  servers: { title: "سرورها", description: "گره‌های زیرساخت پس از ثبت عامل امن قابل مدیریت خواهند بود.", cta: "افزودن سرور" },
  xray: { title: "Xray Core", description: "وضعیت و کنترل سرویس فقط از طریق عامل امن سرور انجام می‌شود." },
  inbounds: { title: "Inbounds", description: "ورودی‌های Xray پس از اتصال backend و عامل سرور نمایش داده می‌شوند." },
  protocols: { title: "پروتکل‌ها", description: "سیاست‌ها و قابلیت‌های پروتکل‌ها در این بخش مدیریت می‌شوند." },
  traffic: { title: "ترافیک", description: "نمودارها تنها از aggregateهای واقعی ساخته می‌شوند." },
  monitor: { title: "مانیتور سیستم", description: "متریک‌های زنده سیستم بعد از اتصال agent در دسترس خواهند بود." },
  logs: { title: "مرکز لاگ‌ها", description: "جست‌وجو و فیلتر رویدادهای دسته‌بندی‌شده سیستم." },
  backups: { title: "پشتیبان‌گیری", description: "ایجاد، تاریخچه و بازیابی امن نسخه‌های پشتیبان." },
  admins: { title: "مدیران", description: "حساب‌های مدیریتی، نقش‌ها، نشست‌ها و مجوزها." },
  security: { title: "مرکز امنیت", description: "ورودهای ناموفق، نشست‌ها، خطاهای agent و انکار مجوزها." },
  settings: { title: "تنظیمات", description: "تنظیمات عمومی و سیاست‌های امنیت و حریم خصوصی." },
  notifications: { title: "اعلان‌ها", description: "هشدارهای مهم مدیریتی و وضعیت زیرساخت." },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const data = content[section] ?? { title: "بخش ناشناخته", description: "این مسیر در NR PANEL تعریف نشده است." };
  const EmptyIcon = section === "logs" ? Database : section === "servers" ? Server : LockKeyhole;

  return (
    <div className="section-page">
      <header className="section-page-heading">
        <div><p className="section-kicker">MANAGEMENT MODULE</p><h2>{data.title}</h2><p>{data.description}</p></div>
        {data.cta ? <Button variant="primary"><Plus size={16} />{data.cta}</Button> : null}
      </header>
      <Card as="section" className="section-readiness">
        <span className="card-icon card-icon-red"><ShieldCheck size={19} /></span>
        <div><h3>آماده برای داده واقعی</h3><p>هیچ رکورد نمایشی به‌عنوان داده عملیاتی ارائه نمی‌شود.</p></div>
        <StatusBadge tone="disconnected"><AlertCircle size={13} /> DISCONNECTED</StatusBadge>
      </Card>
      <Card as="section" className="empty-state">
        <span className="empty-state-icon"><EmptyIcon size={22} /></span>
        <h3>داده‌ای برای نمایش وجود ندارد</h3>
        <p>پس از اتصال سرویس‌های مجاز، این بخش بر اساس سطح دسترسی شما تکمیل می‌شود.</p>
      </Card>
    </div>
  );
}
