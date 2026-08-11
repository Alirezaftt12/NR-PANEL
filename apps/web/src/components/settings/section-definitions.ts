import type { MasterSettingsSection, RestartScope } from "@nr/shared";

export type SettingOption = { value: string; label: string };
export type SettingFieldDefinition = {
  key: string; label: string; description?: string; kind: "text" | "url" | "number" | "textarea" | "toggle" | "select" | "tags" | "secret" | "multiselect";
  options?: SettingOption[]; min?: number; max?: number; step?: number; placeholder?: string; restart?: RestartScope; disabled?: boolean; unavailable?: string;
};
export type SettingsSectionDefinition = { title: string; eyebrow: string; description: string; notice?: string; fields: SettingFieldDefinition[] };

const option = (...items: Array<[string, string]>): SettingOption[] => items.map(([value, label]) => ({ value, label }));
const toggle = (key: string, label: string, description?: string, extra: Partial<SettingFieldDefinition> = {}): SettingFieldDefinition => ({ key, label, description, kind: "toggle", ...extra });
const number = (key: string, label: string, min: number, max: number, description?: string, extra: Partial<SettingFieldDefinition> = {}): SettingFieldDefinition => ({ key, label, description, kind: "number", min, max, ...extra });
const text = (key: string, label: string, description?: string, extra: Partial<SettingFieldDefinition> = {}): SettingFieldDefinition => ({ key, label, description, kind: "text", ...extra });

const events = option(
  ["LOGIN", "ورود موفق"], ["LOGIN_FAILURE", "خطای ورود"], ["SECURITY_ALERT", "هشدار امنیتی"], ["SERVER_OFFLINE", "سرور آفلاین"],
  ["SERVER_ONLINE", "سرور آنلاین"], ["AGENT_OFFLINE", "Agent آفلاین"], ["XRAY_DOWN", "Xray متوقف"], ["HIGH_CPU", "CPU بالا"],
  ["HIGH_RAM", "RAM بالا"], ["HIGH_DISK", "دیسک بالا"], ["TRAFFIC_QUOTA", "هشدار سهمیه"], ["USER_EXPIRATION", "انقضای کاربر"],
  ["SUBPANEL_EXPIRATION", "انقضای زیرپنل"], ["BACKUP_COMPLETED", "بکاپ موفق"], ["BACKUP_FAILED", "خطای بکاپ"],
);

export const settingsDefinitions: Record<MasterSettingsSection, SettingsSectionDefinition> = {
  general: { title: "عمومی", eyebrow: "GENERAL", description: "هویت پنل، زبان، ظاهر و رفتار عمومی.", fields: [
    text("panelName", "نام پنل"), text("applicationTitle", "عنوان مرورگر / برنامه"), { ...text("description", "توضیح پنل"), kind: "textarea" },
    { key: "publicPanelUrl", label: "آدرس عمومی پنل", kind: "url", placeholder: "https://panel.example.com" },
    { key: "language", label: "زبان پیش‌فرض", kind: "select", options: option(["fa", "فارسی"], ["en", "English"]) },
    { key: "theme", label: "پوسته پیش‌فرض", kind: "select", options: option(["light", "روشن"], ["dark", "تیره"], ["system", "سیستم"]) },
    toggle("maintenanceMode", "حالت نگهداری", "جهش‌های مدیریتی حساب‌های غیر OWNER متوقف می‌شود؛ Xray و اتصال‌های VPN متوقف نمی‌شوند."),
    { key: "logoUrl", label: "نشانی لوگو", kind: "url", description: "فقط تصویر؛ CSS، HTML و JavaScript پذیرفته نمی‌شود." },
    number("pageSize", "تعداد ردیف هر صفحه", 10, 200), { key: "supportUrl", label: "لینک پشتیبانی", kind: "url" },
  ] },
  security: { title: "امنیت", eyebrow: "SECURITY", description: "نشست‌ها، محدودسازی ورود و سیاست گذرواژه.", notice: "TOTP در این نسخه کامل نشده و عمداً هیچ کلید فعال‌سازی ساختگی ندارد.", fields: [
    number("sessionTtlMinutes", "طول عمر نشست (دقیقه)", 15, 43200), number("autoLogoutMinutes", "خروج خودکار (دقیقه)", 5, 10080),
    number("maximumConcurrentSessions", "حداکثر نشست همزمان", 0, 100, "صفر یعنی بدون محدودیت."), number("loginRateLimit", "حد تلاش ورود", 3, 100),
    number("failedLoginThreshold", "آستانه خطای ورود", 3, 100), number("lockoutMinutes", "مدت قفل موقت (دقیقه)", 1, 10080),
    number("minimumPasswordLength", "حداقل طول گذرواژه", 12, 128), toggle("requireUppercase", "الزام حرف بزرگ"), toggle("requireLowercase", "الزام حرف کوچک"),
    toggle("requireNumber", "الزام عدد"), toggle("requireSpecial", "الزام نویسه ویژه"), { key: "ipAllowlist", label: "IP Allowlist (CIDR)", kind: "tags", description: "خالی یعنی بدون محدودیت. نمونه: 203.0.113.0/24" },
    number("securityEventRetentionDays", "نگهداری رخداد امنیتی (روز)", 7, 3650),
  ] },
  network: { title: "شبکه و پنل", eyebrow: "PANEL NETWORK", description: "وضعیت مطلوب دسترسی پنل؛ تغییرات پس از ذخیره نیازمند راه‌اندازی مجدد مدیریت‌شده هستند.", fields: [
    text("listenAddress", "آدرس Listen", undefined, { restart: "PANEL" }), number("port", "پورت پنل", 1, 65535, undefined, { restart: "PANEL" }),
    text("publicDomain", "دامنه عمومی", undefined, { restart: "PANEL" }), text("basePath", "مسیر پایه", "مسیر نرمال‌شده و بدون traversal.", { restart: "PANEL", placeholder: "/nr-panel/" }),
    { key: "trustedProxyCidrs", label: "Trusted Proxy CIDRs", kind: "tags", restart: "PANEL" }, { key: "publicUrl", label: "Public URL", kind: "url", restart: "PANEL" },
    { key: "allowedOrigins", label: "Allowed Origins / CORS", kind: "tags", restart: "PANEL" }, toggle("reverseProxyAware", "آگاهی از Reverse Proxy", undefined, { restart: "PANEL" }),
    { key: "sessionTransport", label: "انتقال نشست", kind: "select", options: option(["COOKIE", "HttpOnly Cookie"]), disabled: true },
  ] },
  tls: { title: "SSL / TLS", eyebrow: "CERTIFICATES", description: "پیکربندی امن مسیر گواهی؛ محتوای کلید خصوصی هیچ‌گاه به مرورگر بازگردانده نمی‌شود.", fields: [
    text("certificatePath", "مسیر فایل گواهی", undefined, { restart: "PANEL", placeholder: "/etc/letsencrypt/live/example/fullchain.pem" }),
    { key: "privateKeyPath", label: "مسیر کلید خصوصی", kind: "secret", restart: "PANEL", description: "پس از ذخیره فقط وضعیت تنظیم‌شده نمایش داده می‌شود." },
    toggle("httpsEnabled", "HTTPS فعال", undefined, { restart: "PANEL" }),
  ] },
  xray: { title: "Xray", eyebrow: "XRAY CORE", description: "سیاست نسخه و خط لوله امن اعمال پیکربندی.", notice: "اعتبارسنجی، پشتیبان و rollback قابل غیرفعال‌سازی نیستند. اعمال زنده فقط با Agent متصل انجام می‌شود.", fields: [
    text("desiredVersion", "نسخه مطلوب / Pin", "خالی یعنی بدون pin.", { restart: "XRAY" }), { key: "updateChannel", label: "کانال نسخه", kind: "select", options: option(["stable", "Stable"], ["preview", "Preview"]), restart: "XRAY" },
    toggle("automaticUpdates", "بروزرسانی خودکار Xray", "به‌صورت پیش‌فرض خاموش است.", { restart: "XRAY", disabled: true, unavailable: "Agent update runtime متصل نیست" }), toggle("validateBeforeApply", "اعتبارسنجی پیش از اعمال", undefined, { disabled: true }),
    toggle("backupBeforeApply", "بکاپ پیش از اعمال", undefined, { disabled: true }), toggle("hotApply", "Hot Apply", undefined, { restart: "XRAY" }),
    toggle("restartOnlyWhenRequired", "Restart فقط در صورت نیاز", undefined, { restart: "XRAY", disabled: true }), toggle("rollbackOnFailure", "Rollback روی خطا", undefined, { disabled: true }),
    { key: "logLevel", label: "سطح لاگ", kind: "select", options: option(["debug", "Debug"], ["info", "Info"], ["warning", "Warning"], ["error", "Error"], ["none", "None"]), restart: "XRAY" },
    toggle("statsEnabled", "آمار Xray", "برای حسابداری کاربر و Inbound لازم است.", { restart: "XRAY" }),
  ] },
  subscription: { title: "Subscription", eyebrow: "DELIVERY", description: "تحویل عمومی، توکن‌های پرآنتروپی و مشخصات پروفایل.", fields: [
    toggle("enabled", "فعال‌سازی Subscription", "غیرفعال‌سازی، مصرف لینک عمومی را متوقف می‌کند.", { restart: "SUBSCRIPTION" }), text("publicDomain", "دامنه عمومی", undefined, { restart: "SUBSCRIPTION" }),
    text("listenAddress", "Listen Address", undefined, { restart: "SUBSCRIPTION" }), number("port", "پورت", 1, 65535, undefined, { restart: "SUBSCRIPTION" }),
    text("basePath", "Base Path", undefined, { restart: "SUBSCRIPTION" }), { key: "publicUrl", label: "Public Subscription URL", kind: "url", restart: "SUBSCRIPTION" },
    { key: "reverseProxyUrl", label: "Reverse Proxy URL", kind: "url", restart: "SUBSCRIPTION" }, { key: "protection", label: "حفاظت", kind: "select", options: option(["TOKEN", "Token"], ["TOKEN_AND_EXPIRY", "Token + Expiry"]), restart: "SUBSCRIPTION" },
    number("updateIntervalHours", "فاصله بروزرسانی (ساعت)", 1, 720), text("remarkTemplate", "قالب Remark"), text("profileTitle", "عنوان پروفایل"),
    { key: "profileSupportUrl", label: "لینک پشتیبانی پروفایل", kind: "url" }, number("profileUpdateIntervalHours", "بروزرسانی پروفایل (ساعت)", 1, 720),
  ] },
  subscriptionFormats: { title: "فرمت‌های Subscription", eyebrow: "OUTPUT ADAPTERS", description: "فرمت Raw فعال است؛ آداپتورهای JSON و Mihomo تا پیاده‌سازی کامل غیرفعال می‌مانند.", fields: [
    toggle("rawEnabled", "Raw", undefined, { disabled: true }), toggle("jsonEnabled", "JSON", undefined, { disabled: true, unavailable: "آداپتور خروجی هنوز پیاده‌سازی نشده" }),
    toggle("mihomoEnabled", "Clash / Mihomo", undefined, { disabled: true, unavailable: "آداپتور خروجی هنوز پیاده‌سازی نشده" }), text("remarkFormat", "قالب Remark"),
    toggle("muxEnabled", "Mux", undefined, { disabled: true, unavailable: "در خروجی Raw فعلی پشتیبانی نمی‌شود" }), toggle("xudpEnabled", "XUDP", undefined, { disabled: true }),
    toggle("directRulesEnabled", "Direct Rules", undefined, { disabled: true }), { key: "routingBehavior", label: "رفتار Routing", kind: "select", options: option(["PANEL", "Panel"]), disabled: true },
    toggle("clientDetection", "تشخیص User-Agent", undefined, { disabled: true }), { key: "finalRoute", label: "Final Route", kind: "select", options: option(["PROXY", "Proxy"]), disabled: true },
    { key: "dnsMode", label: "DNS Output", kind: "select", options: option(["PRESERVE", "Preserve"]), disabled: true },
  ] },
  telegram: { title: "Telegram", eyebrow: "INTEGRATION", description: "اتصال واقعی Bot API با توکن رمزگذاری‌شده و رویدادهای انتخابی.", fields: [
    toggle("enabled", "فعال"), { key: "botToken", label: "Bot Token", kind: "secret" }, { key: "adminChatIds", label: "Chat ID مدیران", kind: "tags" },
    { key: "language", label: "زبان اعلان", kind: "select", options: option(["fa", "فارسی"], ["en", "English"]) },
    { key: "proxyUrl", label: "Proxy", kind: "url", disabled: true, unavailable: "Proxy adapter در این نسخه متصل نیست" },
    { key: "apiEndpoint", label: "Telegram API Endpoint", kind: "url", disabled: true }, { key: "schedule", label: "زمان‌بندی", kind: "select", options: option(["IMMEDIATE", "فوری"], ["DIGEST_HOURLY", "خلاصه ساعتی"], ["DIGEST_DAILY", "خلاصه روزانه"]) },
    { key: "events", label: "رویدادها", kind: "multiselect", options: events },
  ] },
  email: { title: "Email", eyebrow: "SMTP", description: "ارسال واقعی SMTP؛ گذرواژه رمزگذاری و در پاسخ‌ها ماسک می‌شود.", fields: [
    toggle("enabled", "فعال"), text("smtpHost", "SMTP Host"), number("smtpPort", "SMTP Port", 1, 65535), { key: "encryption", label: "رمزنگاری", kind: "select", options: option(["TLS", "TLS"], ["STARTTLS", "STARTTLS"]) },
    text("username", "نام کاربری"), { key: "password", label: "گذرواژه SMTP", kind: "secret" }, { key: "fromAddress", label: "From Address", kind: "text" }, text("fromName", "From Name"),
    { key: "recipients", label: "گیرندگان مدیر", kind: "tags" },
  ] },
  notifications: { title: "اعلان‌ها", eyebrow: "ALERT ROUTING", description: "مرکز انتخاب کانال، رویداد و آستانه‌های هشدار.", fields: [
    { key: "channels", label: "کانال‌ها", kind: "multiselect", options: option(["IN_APP", "درون‌برنامه"], ["TELEGRAM", "Telegram"], ["EMAIL", "Email"]) },
    { key: "events", label: "رویدادها", kind: "multiselect", options: events }, number("cpuWarning", "CPU هشدار %", 1, 99), number("cpuCritical", "CPU بحرانی %", 2, 100),
    number("ramWarning", "RAM هشدار %", 1, 99), number("ramCritical", "RAM بحرانی %", 2, 100), number("storageWarning", "Storage هشدار %", 1, 99),
    number("storageCritical", "Storage بحرانی %", 2, 100), number("trafficWarning", "Traffic هشدار %", 1, 99), number("trafficCritical", "Traffic بحرانی %", 2, 100),
    number("expirationWarningDays", "هشدار انقضا (روز)", 1, 365), number("expirationCriticalDays", "انقضای بحرانی (روز)", 0, 364),
  ] },
  users: { title: "کاربران", eyebrow: "NEW USER DEFAULTS", description: "پیش‌فرض‌های ایجاد کاربر VPN جدید؛ کاربران فعلی تغییر نمی‌کنند.", notice: "این تنظیمات فقط برای کاربران جدید اعمال می‌شود.", fields: [
    text("trafficLimitBytes", "سقف ترافیک پیش‌فرض (Byte)", "خالی یعنی نامحدود."), number("durationDays", "مدت پیش‌فرض (روز)", 1, 3650), toggle("enabled", "فعال به‌صورت پیش‌فرض"),
    toggle("subscriptionEnabled", "Subscription پیش‌فرض"), { key: "trafficResetPolicy", label: "ریست ترافیک", kind: "select", options: option(["NEVER", "بدون ریست"]), disabled: true, unavailable: "زمان‌بندی ریست خودکار هنوز متصل نیست" },
    { key: "expirationBehavior", label: "رفتار انقضا", kind: "select", options: option(["DISABLE", "غیرفعال"]), disabled: true, unavailable: "پاک‌سازی خودکار هنوز متصل نیست" },
    { key: "protocol", label: "پروتکل پیش‌فرض", kind: "select", options: option(["VLESS", "VLESS"], ["VMess", "VMess"], ["Trojan", "Trojan"], ["Shadowsocks", "Shadowsocks"]) },
  ] },
  subpanels: { title: "زیرپنل‌ها", eyebrow: "NEW SUB PANEL DEFAULTS", description: "پیش‌فرض‌های زیرپنل جدید؛ قابلیت ساخت یا ویرایش Inbound عمداً وجود ندارد.", fields: [
    number("userLimit", "سقف کاربر", 0, 1000000), text("trafficCreditBytes", "اعتبار ترافیک (Byte)", "خالی یعنی نامحدود."), number("expirationDays", "مدت انقضا (روز)", 1, 3650),
    toggle("subscriptionPermission", "مجوز Subscription"), toggle("trafficResetPermission", "مجوز ریست ترافیک"), toggle("userExtendPermission", "مجوز تمدید کاربر"), toggle("credentialRotationPermission", "مجوز چرخش اعتبارنامه"),
  ] },
  agents: { title: "Agent و سرورها", eyebrow: "CONTROL PLANE", description: "زمان‌بندی heartbeat، health و فرمان‌های whitelist‌شده Agent.", fields: [
    number("heartbeatIntervalSeconds", "Heartbeat (ثانیه)", 5, 3600, undefined, { restart: "AGENT" }), number("offlineTimeoutSeconds", "Offline Timeout", 10, 86400, undefined, { restart: "AGENT" }),
    number("commandTimeoutSeconds", "Command Timeout", 5, 3600, undefined, { restart: "AGENT" }), number("metricsSamplingSeconds", "نمونه‌برداری متریک", 5, 3600, undefined, { restart: "AGENT" }),
    { key: "reconnectPolicy", label: "Reconnect Policy", kind: "select", options: option(["EXPONENTIAL", "Exponential"], ["FIXED", "Fixed"]), restart: "AGENT" },
    { key: "updatePolicy", label: "Agent Update Policy", kind: "select", options: option(["MANUAL", "Manual"], ["NOTIFY", "Notify"]), restart: "AGENT" },
    number("serverHealthIntervalSeconds", "Server Health Interval", 5, 3600, undefined, { restart: "AGENT" }), number("xrayHealthIntervalSeconds", "Xray Health Interval", 5, 3600, undefined, { restart: "AGENT" }),
  ] },
  traffic: { title: "ترافیک", eyebrow: "ACCOUNTING", description: "دوره نمونه‌برداری و نگهداری؛ ترافیک فیزیکی سرور از مصرف منطقی کاربر جدا می‌ماند.", fields: [
    number("metricsSamplingSeconds", "نمونه‌برداری (ثانیه)", 5, 3600, undefined, { restart: "AGENT" }), number("rawRetentionDays", "نگهداری Raw (روز)", 1, 365),
    number("hourlyRetentionDays", "نگهداری ساعتی (روز)", 7, 1825), number("dailyRetentionDays", "نگهداری روزانه (روز)", 30, 3650),
    { key: "displayUnit", label: "واحد نمایش", kind: "select", options: option(["AUTO", "خودکار"], ["GB", "GB"], ["TB", "TB"]) }, number("quotaWarningPercent", "هشدار سهمیه %", 1, 100),
    { key: "resetDefault", label: "ریست پیش‌فرض", kind: "select", options: option(["MANUAL", "دستی"], ["MONTHLY", "ماهانه"]) },
    { key: "aggregationSchedule", label: "تجمیع تاریخی", kind: "select", options: option(["HOURLY", "ساعتی"], ["DAILY", "روزانه"]) },
  ] },
  backup: { title: "بکاپ", eyebrow: "RECOVERY", description: "سیاست بکاپ مدیریت‌شده. اجرای بکاپ تا اتصال runtime واقعی به‌عنوان ناموجود گزارش می‌شود.", fields: [
    toggle("database", "پایگاه داده"), toggle("applicationSettings", "تنظیمات برنامه"), toggle("xrayConfigurations", "پیکربندی Xray"), toggle("subpanelData", "داده زیرپنل"), toggle("subscriptionMetadata", "متادیتای Subscription"),
    { key: "schedule", label: "زمان‌بندی", kind: "select", options: option(["MANUAL", "دستی"], ["DAILY", "روزانه"], ["WEEKLY", "هفتگی"]) }, text("scheduleTime", "ساعت اجرا", "HH:mm"),
    number("retentionCount", "تعداد نگهداری", 1, 1000), number("retentionDays", "روز نگهداری", 1, 3650), { key: "storageProvider", label: "فضای ذخیره", kind: "select", options: option(["LOCAL_MANAGED", "Local Managed"]), disabled: true },
  ] },
  datetime: { title: "تاریخ و زمان", eyebrow: "LOCALIZATION", description: "ذخیره timestampها به UTC و قالب‌بندی نمایش با timezone و تقویم استاندارد.", fields: [
    text("timezone", "Timezone (IANA)", undefined, { restart: "PANEL", placeholder: "Asia/Tehran" }), { key: "dateFormat", label: "قالب تاریخ", kind: "select", options: option(["YYYY-MM-DD", "YYYY-MM-DD"], ["DD/MM/YYYY", "DD/MM/YYYY"], ["YYYY/MM/DD", "YYYY/MM/DD"]) },
    { key: "timeFormat", label: "قالب ساعت", kind: "select", options: option(["24H", "۲۴ ساعته"], ["12H", "۱۲ ساعته"]) }, { key: "calendar", label: "تقویم", kind: "select", options: option(["GREGORIAN", "میلادی"], ["JALALI", "جلالی / شمسی"]) },
  ] },
  updates: { title: "بروزرسانی", eyebrow: "UPDATE CENTER", description: "هیچ بروزرسانی خاموش یا installer دلخواه اجرا نمی‌شود.", fields: [
    { key: "channel", label: "کانال", kind: "select", options: option(["stable", "Stable"], ["preview", "Preview"]) }, toggle("automaticPanelUpdates", "بروزرسانی خودکار پنل", undefined, { disabled: true, unavailable: "سیاست امنیتی: فقط اقدام صریح OWNER" }),
    toggle("notifyWhenAvailable", "اعلان نسخه جدید"), toggle("automaticAgentUpdates", "بروزرسانی خودکار Agent", undefined, { disabled: true, unavailable: "Agent update فقط دستی و امضاشده است" }),
  ] },
};
