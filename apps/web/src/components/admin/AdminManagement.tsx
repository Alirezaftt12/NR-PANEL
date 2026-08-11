"use client";

import { type Permission, type Role } from "@nr/shared";
import { KeyRound, Plus, ShieldCheck, UserRoundCog } from "lucide-react";
import { useState } from "react";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

export type AdminSummary = {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  tenantId: string;
  lastLoginAt: string | null;
  createdAt: string;
  permissions: Permission[];
};
export type PermissionOption = { id: string; code: Permission; description: string };
export type TenantOption = { id: string; name: string; slug: string; status: string };

type Props = { initialAdmins: AdminSummary[]; permissions: PermissionOption[]; tenants: TenantOption[] };

export function AdminManagement({ initialAdmins, permissions, tenants }: Props) {
  const auth = useAuth();
  const [admins, setAdmins] = useState(initialAdmins);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isOwner = auth.status === "authenticated" && auth.user.role === "OWNER";

  async function reload() {
    setAdmins(await apiRequest<AdminSummary[]>("/admins"));
  }

  async function createAdmin(formData: FormData) {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/admins", {
        method: "POST",
        body: JSON.stringify({
          username: formData.get("username"),
          email: formData.get("email") || null,
          password: formData.get("password"),
          role: formData.get("role"),
          tenantId: formData.get("tenantId"),
          permissions: formData.getAll("permissions"),
        }),
      });
      await reload();
      setShowCreate(false);
      setMessage("حساب مدیریتی با موفقیت ایجاد شد.");
    } catch (error) {
      setMessage(error instanceof ClientApiError ? error.message : "ایجاد حساب انجام نشد.");
    } finally { setBusy(false); }
  }

  async function updateAdmin(formData: FormData) {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/admins/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: formData.get("role"), status: formData.get("status"), permissions: formData.getAll("permissions") }),
      });
      await reload();
      setEditing(null);
      setMessage("دسترسی‌های مدیر به‌روزرسانی شد.");
    } catch (error) {
      setMessage(error instanceof ClientApiError ? error.message : "به‌روزرسانی انجام نشد.");
    } finally { setBusy(false); }
  }

  return (
    <div className="management-page">
      <header className="section-page-heading">
        <div><p className="section-kicker">IDENTITY & ACCESS</p><h2>مدیران سیستم</h2><p>حساب‌ها، نقش‌ها، دسترسی‌ها و وضعیت نشست از PostgreSQL خوانده می‌شوند.</p></div>
        {isOwner ? <Button variant="primary" onClick={() => setShowCreate((value) => !value)}><Plus size={16} />ایجاد مدیر</Button> : null}
      </header>
      {message ? <div className="management-message" role="status">{message}</div> : null}

      {showCreate && isOwner ? (
        <Card as="section" className="admin-editor">
          <h3><UserRoundCog size={18} />ایجاد حساب مدیریتی</h3>
          <form action={createAdmin}>
            <div className="form-grid">
              <label>نام کاربری<input name="username" autoComplete="off" required minLength={3} /></label>
              <label>ایمیل اختیاری<input name="email" type="email" autoComplete="off" /></label>
              <label>گذرواژه اولیه<input name="password" type="password" autoComplete="new-password" required minLength={12} /></label>
              <label>نقش<select name="role" defaultValue="ADMIN"><option value="ADMIN">ADMIN</option><option value="RESELLER">RESELLER</option></select></label>
              <label>Tenant<select name="tenantId" required>{tenants.filter((tenant) => tenant.status === "ACTIVE").map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.name} — {tenant.slug}</option>)}</select></label>
            </div>
            <PermissionGrid options={permissions} selected={[]} />
            <div className="editor-actions"><Button onClick={() => setShowCreate(false)}>انصراف</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "در حال ایجاد…" : "ایجاد امن حساب"}</Button></div>
          </form>
        </Card>
      ) : null}

      {editing && isOwner ? (
        <Card as="section" className="admin-editor">
          <h3><KeyRound size={18} />ویرایش دسترسی {editing.username}</h3>
          <form action={updateAdmin}>
            <div className="form-grid">
              <label>نقش<select name="role" defaultValue={editing.role}><option value="ADMIN">ADMIN</option><option value="RESELLER">RESELLER</option></select></label>
              <label>وضعیت<select name="status" defaultValue={editing.status}><option value="ACTIVE">ACTIVE</option><option value="DISABLED">DISABLED</option></select></label>
            </div>
            <PermissionGrid options={permissions} selected={editing.permissions} />
            <div className="editor-actions"><Button onClick={() => setEditing(null)}>انصراف</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره دسترسی‌ها"}</Button></div>
          </form>
        </Card>
      ) : null}

      <Card as="section" className="data-table-card">
        <div className="table-heading"><h3>حساب‌های مدیریتی</h3><StatusBadge tone="info">{admins.length} ACCOUNT</StatusBadge></div>
        {admins.length === 0 ? <div className="compact-empty">حسابی برای نمایش وجود ندارد.</div> : (
          <div className="responsive-table"><table><thead><tr><th>حساب</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th><th>دسترسی‌ها</th><th>عملیات</th></tr></thead><tbody>{admins.map((admin) => (
            <tr key={admin.id}>
              <td><strong>{admin.username}</strong><small>{admin.email || "بدون ایمیل"}</small></td>
              <td dir="ltr">{admin.role}</td>
              <td><StatusBadge tone={admin.status === "ACTIVE" ? "healthy" : "disconnected"}>{admin.status}</StatusBadge></td>
              <td>{admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString("fa-IR") : "هنوز وارد نشده"}</td>
              <td>{admin.role === "OWNER" ? "تمام دسترسی‌ها" : `${admin.permissions.length} مجوز`}</td>
              <td>{isOwner && admin.role !== "OWNER" ? <Button compact onClick={() => setEditing(admin)}>ویرایش</Button> : <ShieldCheck size={16} aria-label="حساب محافظت‌شده" />}</td>
            </tr>
          ))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

function PermissionGrid({ options, selected }: { options: PermissionOption[]; selected: Permission[] }) {
  return (
    <fieldset className="permission-grid"><legend>مجوزهای اختصاصی</legend>{options.map((permission) => (
      <label key={permission.code}><input type="checkbox" name="permissions" value={permission.code} defaultChecked={selected.includes(permission.code)} /><span><strong>{permission.code}</strong><small>{permission.description}</small></span></label>
    ))}</fieldset>
  );
}
