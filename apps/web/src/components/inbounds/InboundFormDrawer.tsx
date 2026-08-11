"use client";

import { PRESERVE_SECRET_VALUE, type InboundDetail, type InboundProtocol, type InboundSecurity, type InboundServerOption, type InboundTransport } from "@nr/shared";
import { Braces, Cable, KeyRound, Network, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

export type InboundFormPayload = Record<string, unknown>;

function dateTimeValue(value: string | null | undefined) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }
function optionalNumber(data: FormData, key: string) { const value = String(data.get(key) || ""); return value ? Number(value) : undefined; }
function lines(value: FormDataEntryValue | null) { return String(value || "").split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean); }

export function InboundFormDrawer({ open, inbound, servers, supportsXhttp, advancedAllowed, busy, onClose, onSubmit }: {
  open: boolean; inbound: InboundDetail | null; servers: InboundServerOption[]; supportsXhttp: boolean; advancedAllowed: boolean; busy: boolean;
  onClose: () => void; onSubmit: (payload: InboundFormPayload) => Promise<void>;
}) {
  const [protocol, setProtocol] = useState<InboundProtocol>(inbound?.protocol || "VLESS");
  const [transport, setTransport] = useState<InboundTransport>(inbound?.transport || "TCP");
  const [security, setSecurity] = useState<InboundSecurity>(inbound?.security || "NONE");
  const [formError, setFormError] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    const data = new FormData(event.currentTarget);
    let advancedConfig: Record<string, unknown> | null = inbound?.advancedConfig || null;
    if (advancedAllowed) {
      const raw = String(data.get("advancedConfig") || "").trim();
      try { advancedConfig = raw ? JSON.parse(raw) as Record<string, unknown> : null; }
      catch { setFormError("JSON پیشرفته معتبر نیست."); return; }
    }
    const fallbackDestination = String(data.get("fallbackDestination") || "").trim();
    const expires = String(data.get("expiresAt") || "");
    const protocolConfig = protocol === "VLESS" ? { kind: "VLESS", decryption: "none" }
      : protocol === "VMess" ? { kind: "VMess", disableInsecureEncryption: data.get("disableInsecureEncryption") === "on" }
        : protocol === "Trojan" ? { kind: "Trojan" }
          : { kind: "Shadowsocks", method: data.get("shadowsocksMethod"), network: data.get("shadowsocksNetwork"), serverPassword: data.get("serverPassword") };
    const transportConfig = transport === "TCP" ? { kind: "TCP", headerType: data.get("httpObfuscation") === "on" ? "http" : "none", requestPath: String(data.get("requestPath") || "/") }
      : transport === "WEBSOCKET" ? { kind: "WEBSOCKET", path: String(data.get("path") || "/"), host: String(data.get("host") || "") || undefined, heartbeatPeriod: optionalNumber(data, "heartbeatPeriod") }
        : transport === "GRPC" ? { kind: "GRPC", serviceName: String(data.get("serviceName") || "grpc"), multiMode: data.get("multiMode") === "on", idleTimeout: optionalNumber(data, "idleTimeout"), healthCheckTimeout: optionalNumber(data, "healthCheckTimeout") }
          : { kind: "XHTTP", path: String(data.get("path") || "/"), host: String(data.get("host") || "") || undefined, mode: data.get("xhttpMode") || "auto" };
    const securityConfig = security === "NONE" ? { kind: "NONE" }
      : security === "TLS" ? { kind: "TLS", serverName: String(data.get("serverName") || "") || undefined, alpn: lines(data.get("alpn")), minVersion: data.get("minVersion") || "1.2", certificateFile: data.get("certificateFile"), keyFile: data.get("keyFile"), rejectUnknownSni: data.get("rejectUnknownSni") === "on" }
        : { kind: "REALITY", target: data.get("realityTarget"), serverNames: lines(data.get("realityServerNames")), privateKey: data.get("realityPrivateKey"), shortIds: lines(data.get("realityShortIds")), show: false, proxyProtocolVersion: Number(data.get("realityXver") || 0) };
    await onSubmit({
      serverId: data.get("serverId"), name: data.get("name"), tag: data.get("tag"), enabled: data.get("enabled") === "on", listenIp: data.get("listenIp"), port: Number(data.get("port")),
      protocol, transport, security, protocolConfig, transportConfig, securityConfig,
      trafficLimit: String(data.get("trafficLimit") || "") || null, expiresAt: expires ? new Date(expires).toISOString() : null,
      sniffing: { enabled: data.get("sniffingEnabled") === "on", destinationOverrides: lines(data.get("destinationOverrides")), metadataOnly: data.get("metadataOnly") === "on", routeOnly: data.get("routeOnly") === "on", domainsExcluded: lines(data.get("domainsExcluded")), domainsOnly: lines(data.get("domainsOnly")) },
      sockopt: { acceptProxyProtocol: data.get("acceptProxyProtocol") === "on", tcpFastOpen: data.get("tcpFastOpen") === "on", tcpKeepAliveIdle: optionalNumber(data, "tcpKeepAliveIdle"), tcpKeepAliveInterval: optionalNumber(data, "tcpKeepAliveInterval"), tcpUserTimeout: optionalNumber(data, "tcpUserTimeout"), congestion: String(data.get("congestion") || "") || undefined, domainStrategy: data.get("domainStrategy") || "AsIs", dialerProxy: String(data.get("dialerProxy") || "") || undefined, trustedXForwardedFor: lines(data.get("trustedXForwardedFor")) },
      fallbacks: fallbackDestination ? [{ name: String(data.get("fallbackName") || "") || undefined, alpn: data.get("fallbackAlpn") || undefined, path: String(data.get("fallbackPath") || "") || undefined, destination: fallbackDestination, proxyProtocolVersion: Number(data.get("fallbackXver") || 0) }] : [],
      routing: { outboundTag: String(data.get("outboundTag") || "") || undefined, balancerTag: String(data.get("balancerTag") || "") || undefined }, advancedConfig,
    });
  }

  const protocolConfig = inbound?.protocolConfig;
  const transportConfig = inbound?.transportConfig;
  const securityConfig = inbound?.securityConfig;
  const fallback = inbound?.fallbacks[0];
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="inbound-drawer" role="dialog" aria-modal="true" aria-labelledby="inbound-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header"><div><span className="drawer-icon"><Cable size={18} /></span><div><h2 id="inbound-drawer-title">{inbound ? "ویرایش ورودی" : "افزودن ورودی"}</h2><p>پیکربندی تایپ‌شده و اعتبارسنجی‌شده Xray</p></div></div><IconButton label="بستن فرم ورودی" onClick={onClose}><X size={18} /></IconButton></header>
        <form className="inbound-drawer-form" onSubmit={submit}>
          {formError ? <div className="drawer-form-error" role="alert">{formError}</div> : null}
          <section className="drawer-section"><h3><SlidersHorizontal size={16} />تنظیمات پایه</h3><div className="drawer-form-grid">
            <label className="toggle-field"><span>فعال</span><input name="enabled" type="checkbox" defaultChecked={inbound?.enabled ?? true} /></label>
            <label>سرور<select name="serverId" required defaultValue={inbound?.serverId || servers[0]?.id || ""} disabled={Boolean(inbound)}><option value="" disabled>انتخاب سرور</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.status}</option>)}</select></label>
            <label>نام<input name="name" required minLength={2} defaultValue={inbound?.name || ""} placeholder="ورودی اصلی" /></label>
            <label>Tag<input name="tag" required pattern="[A-Za-z0-9_.-]{2,120}" dir="ltr" defaultValue={inbound?.tag || ""} placeholder="main-vless" /></label>
            <label>پروتکل<select name="protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as InboundProtocol)}><option>VLESS</option><option>VMess</option><option>Trojan</option><option>Shadowsocks</option></select></label>
            <label>آی‌پی اتصال<input name="listenIp" required dir="ltr" defaultValue={inbound?.listenIp || "127.0.0.1"} /></label>
            <label>پورت<input name="port" required type="number" min={1} max={65535} dir="ltr" defaultValue={inbound?.port || 443} /></label>
            <label>ترافیک کل (Byte)<input name="trafficLimit" type="number" min={0} dir="ltr" defaultValue={inbound?.trafficLimit || ""} placeholder="نامحدود" /></label>
            <label>بازنشانی ترافیک<select disabled aria-describedby="reset-policy-note"><option>بدون بازنشانی دوره‌ای</option></select><small id="reset-policy-note">زمان‌بندی خودکار هنوز به scheduler متصل نیست.</small></label>
            <label>مدت زمان<input name="expiresAt" type="datetime-local" dir="ltr" defaultValue={dateTimeValue(inbound?.expiresAt)} /></label>
          </div></section>

          <details className="drawer-section" open><summary><UserRound size={16} />کاربر و پروتکل</summary><div className="drawer-form-grid">
            <label>Authentication<input disabled value={protocol === "VLESS" || protocol === "VMess" ? "UUID per child user" : "Password per child user"} readOnly /></label>
            <label>Decryption<input disabled value={protocol === "VLESS" ? "none" : "managed by adapter"} readOnly /></label>
            {protocol === "VMess" ? <label className="toggle-field"><span>رد رمزنگاری ناامن</span><input name="disableInsecureEncryption" type="checkbox" defaultChecked={protocolConfig?.kind === "VMess" ? protocolConfig.disableInsecureEncryption : true} /></label> : null}
            {protocol === "Shadowsocks" ? <><label>Encryption<select name="shadowsocksMethod" defaultValue={protocolConfig?.kind === "Shadowsocks" ? protocolConfig.method : "2022-blake3-aes-256-gcm"}><option>2022-blake3-aes-256-gcm</option><option>2022-blake3-aes-128-gcm</option><option>aes-256-gcm</option><option>aes-128-gcm</option><option>chacha20-poly1305</option></select></label><label>شبکه<select name="shadowsocksNetwork" defaultValue={protocolConfig?.kind === "Shadowsocks" ? protocolConfig.network : "tcp,udp"}><option value="tcp,udp">TCP + UDP</option><option value="tcp">TCP</option><option value="udp">UDP</option></select></label><label>کلید سرور<input name="serverPassword" required minLength={16} dir="ltr" defaultValue={protocolConfig?.kind === "Shadowsocks" ? protocolConfig.serverPassword : ""} /></label></> : null}
            <label>Fallback مقصد<input name="fallbackDestination" dir="ltr" defaultValue={fallback?.destination || ""} placeholder="127.0.0.1:80" /></label><label>Fallback SNI<input name="fallbackName" dir="ltr" defaultValue={fallback?.name || ""} /></label><label>Fallback ALPN<select name="fallbackAlpn" defaultValue={fallback?.alpn || ""}><option value="">Any</option><option>http/1.1</option><option>h2</option></select></label><label>Fallback Path<input name="fallbackPath" dir="ltr" defaultValue={fallback?.path || ""} /></label><label>Fallback Proxy Protocol<select name="fallbackXver" defaultValue={fallback?.proxyProtocolVersion || 0}><option value="0">خاموش</option><option value="1">v1</option><option value="2">v2</option></select></label>
          </div><div className="inline-form-actions"><Button compact onClick={() => setKeyMessage("تولید کلید X25519 باید توسط عامل امضاشده سرور انجام شود؛ کلید ساختگی ایجاد نشد.")}><KeyRound size={14} />Get New Keys</Button><Button compact type="reset">Clear</Button>{keyMessage ? <small role="status">{keyMessage}</small> : null}</div></details>

          <details className="drawer-section" open><summary><Network size={16} />انتقال و شبکه</summary><div className="drawer-form-grid">
            <label>راه اتصال / Transport<select name="transport" value={transport} onChange={(event) => setTransport(event.target.value as InboundTransport)}><option value="TCP">TCP / RAW</option><option value="WEBSOCKET">WebSocket</option><option value="GRPC">gRPC</option><option value="XHTTP" disabled={!supportsXhttp}>XHTTP {!supportsXhttp ? "(قابلیت تأیید نشده)" : ""}</option></select></label>
            <label className="toggle-field"><span>Proxy Protocol</span><input name="acceptProxyProtocol" type="checkbox" defaultChecked={inbound?.sockopt.acceptProxyProtocol} /></label>
            {transport === "TCP" ? <><label className="toggle-field"><span>مهمان‌سازی HTTP</span><input name="httpObfuscation" type="checkbox" defaultChecked={transportConfig?.kind === "TCP" && transportConfig.headerType === "http"} /></label><label>مسیر HTTP<input name="requestPath" dir="ltr" defaultValue={transportConfig?.kind === "TCP" ? transportConfig.requestPath || "/" : "/"} /></label></> : null}
            {transport === "WEBSOCKET" || transport === "XHTTP" ? <><label>Path<input name="path" required dir="ltr" defaultValue={transportConfig?.kind === transport ? transportConfig.path : "/"} /></label><label>Host<input name="host" dir="ltr" defaultValue={transportConfig?.kind === transport ? transportConfig.host || "" : ""} /></label></> : null}
            {transport === "WEBSOCKET" ? <label>Heartbeat (s)<input name="heartbeatPeriod" type="number" min={0} defaultValue={transportConfig?.kind === "WEBSOCKET" ? transportConfig.heartbeatPeriod : undefined} /></label> : null}
            {transport === "GRPC" ? <><label>Service Name<input name="serviceName" required dir="ltr" defaultValue={transportConfig?.kind === "GRPC" ? transportConfig.serviceName : "grpc"} /></label><label className="toggle-field"><span>Multi Mode</span><input name="multiMode" type="checkbox" defaultChecked={transportConfig?.kind === "GRPC" && transportConfig.multiMode} /></label><label>Idle timeout<input name="idleTimeout" type="number" min={0} /></label><label>Health timeout<input name="healthCheckTimeout" type="number" min={0} /></label></> : null}
            {transport === "XHTTP" ? <label>Mode<select name="xhttpMode" defaultValue={transportConfig?.kind === "XHTTP" ? transportConfig.mode : "auto"}><option value="auto">Auto</option><option value="packet-up">Packet Up</option><option value="stream-up">Stream Up</option></select></label> : null}
            <label className="toggle-field"><span>TCP Fast Open</span><input name="tcpFastOpen" type="checkbox" defaultChecked={inbound?.sockopt.tcpFastOpen} /></label><label>KeepAlive Idle<input name="tcpKeepAliveIdle" type="number" defaultValue={inbound?.sockopt.tcpKeepAliveIdle} /></label><label>KeepAlive Interval<input name="tcpKeepAliveInterval" type="number" defaultValue={inbound?.sockopt.tcpKeepAliveInterval} /></label><label>TCP User Timeout<input name="tcpUserTimeout" type="number" defaultValue={inbound?.sockopt.tcpUserTimeout} /></label>
            <label>Congestion<select name="congestion" defaultValue={inbound?.sockopt.congestion || ""}><option value="">پیش‌فرض سیستم</option><option>bbr</option><option>cubic</option><option>reno</option></select></label><label>Domain Strategy<select name="domainStrategy" defaultValue={inbound?.sockopt.domainStrategy || "AsIs"}><option>AsIs</option><option>UseIP</option><option>UseIPv4</option><option>UseIPv6</option><option>ForceIP</option><option>ForceIPv4</option><option>ForceIPv6</option></select></label><label>External Proxy / Dialer<input name="dialerProxy" dir="ltr" defaultValue={inbound?.sockopt.dialerProxy || ""} /></label><label>Trusted XFF Headers<textarea name="trustedXForwardedFor" dir="ltr" defaultValue={inbound?.sockopt.trustedXForwardedFor.join("\n")} /></label>
            <label>UDP Masks<input disabled value="نیازمند FinalMask adapter" readOnly /><small>تا اضافه شدن قابلیت عامل، مقداری ذخیره یا جعل نمی‌شود.</small></label>
          </div></details>

          <details className="drawer-section" open><summary><ShieldCheck size={16} />امنیت</summary><div className="security-choice" role="radiogroup" aria-label="امنیت انتقال">{(["NONE", "REALITY", "TLS"] as InboundSecurity[]).map((item) => <label key={item} className={security === item ? "is-selected" : ""}><input type="radio" name="security" value={item} checked={security === item} onChange={() => setSecurity(item)} /><span>{item === "NONE" ? "هیچ" : item}</span></label>)}</div><div className="drawer-form-grid">
            {security === "TLS" ? <><label>Server Name<input name="serverName" dir="ltr" defaultValue={securityConfig?.kind === "TLS" ? securityConfig.serverName || "" : ""} /></label><label>ALPN<textarea name="alpn" dir="ltr" defaultValue={securityConfig?.kind === "TLS" ? securityConfig.alpn.join("\n") : "h2\nhttp/1.1"} /></label><label>حداقل TLS<select name="minVersion" defaultValue={securityConfig?.kind === "TLS" ? securityConfig.minVersion : "1.2"}><option>1.2</option><option>1.3</option></select></label><label>Certificate File<input name="certificateFile" required dir="ltr" defaultValue={securityConfig?.kind === "TLS" ? securityConfig.certificateFile : ""} /></label><label>Key File<input name="keyFile" required dir="ltr" defaultValue={securityConfig?.kind === "TLS" ? securityConfig.keyFile : ""} /></label><label className="toggle-field"><span>Reject Unknown SNI</span><input name="rejectUnknownSni" type="checkbox" defaultChecked={securityConfig?.kind === "TLS" && securityConfig.rejectUnknownSni} /></label></> : null}
            {security === "REALITY" ? <><label>Target<input name="realityTarget" required dir="ltr" defaultValue={securityConfig?.kind === "REALITY" ? securityConfig.target : ""} placeholder="example.com:443" /></label><label>Server Names<textarea name="realityServerNames" required dir="ltr" defaultValue={securityConfig?.kind === "REALITY" ? securityConfig.serverNames.join("\n") : ""} /></label><label>Private Key<input name="realityPrivateKey" type="password" required minLength={32} dir="ltr" autoComplete="new-password" defaultValue={securityConfig?.kind === "REALITY" ? PRESERVE_SECRET_VALUE : ""} /><small>{securityConfig?.kind === "REALITY" ? "مقدار فعلی محافظت شده و دوباره نمایش داده نمی‌شود؛ برای چرخش، کلید جدید وارد کنید." : "کلید خصوصی هرگز دوباره از API خوانده نمی‌شود."}</small></label><label>Short IDs<textarea name="realityShortIds" required dir="ltr" defaultValue={securityConfig?.kind === "REALITY" ? securityConfig.shortIds.join("\n") : ""} /></label><label>Proxy Protocol<select name="realityXver" defaultValue={securityConfig?.kind === "REALITY" ? securityConfig.proxyProtocolVersion : 0}><option value="0">خاموش</option><option value="1">v1</option><option value="2">v2</option></select></label></> : null}
          </div></details>

          <details className="drawer-section"><summary><Cable size={16} />Sniffing و مسیریابی</summary><div className="drawer-form-grid"><label className="toggle-field"><span>Sniffing</span><input name="sniffingEnabled" type="checkbox" defaultChecked={inbound?.sniffing.enabled} /></label><label>Destination Overrides<textarea name="destinationOverrides" dir="ltr" defaultValue={inbound?.sniffing.destinationOverrides.join("\n") || "http\ntls\nquic"} /></label><label className="toggle-field"><span>Metadata Only</span><input name="metadataOnly" type="checkbox" defaultChecked={inbound?.sniffing.metadataOnly} /></label><label className="toggle-field"><span>Route Only</span><input name="routeOnly" type="checkbox" defaultChecked={inbound?.sniffing.routeOnly} /></label><label>Domains Excluded<textarea name="domainsExcluded" dir="ltr" defaultValue={inbound?.sniffing.domainsExcluded.join("\n")} /></label><label>Domains Only<textarea name="domainsOnly" dir="ltr" defaultValue={inbound?.sniffing.domainsOnly.join("\n")} /></label><label>Outbound Reference<input name="outboundTag" dir="ltr" defaultValue={inbound?.routing.outboundTag || ""} /></label><label>Balancer Reference<input name="balancerTag" dir="ltr" defaultValue={inbound?.routing.balancerTag || ""} /></label></div></details>
          {advancedAllowed ? <details className="drawer-section advanced-json"><summary><Braces size={16} />JSON پیشرفته</summary><p>فقط فیلدهای افزوده‌ی Inbound پذیرفته می‌شوند؛ tag، port، protocol، settings و streamSettings قابل بازنویسی نیستند.</p><textarea name="advancedConfig" dir="ltr" spellCheck={false} defaultValue={inbound?.advancedConfig ? JSON.stringify(inbound.advancedConfig, null, 2) : ""} /></details> : null}
          <footer className="drawer-footer"><Button onClick={onClose}>انصراف</Button><Button variant="primary" type="submit" disabled={busy || servers.length === 0}>{busy ? "در حال ذخیره…" : inbound ? "ذخیره و اعمال امن" : "ایجاد و اعمال امن"}</Button></footer>
        </form>
      </aside>
    </div>
  );
}
