import type { Metadata } from "next";
import { AdminManagement, type AdminSummary, type PermissionOption, type TenantOption } from "../../../components/admin/AdminManagement";
import { serverApiRequest } from "../../../lib/server-api";

export const metadata: Metadata = { title: "مدیران" };

export default async function AdminsPage() {
  const [admins, permissions, tenants] = await Promise.all([
    serverApiRequest<AdminSummary[]>("/admins"),
    serverApiRequest<PermissionOption[]>("/permissions"),
    serverApiRequest<TenantOption[]>("/tenants"),
  ]);
  return <AdminManagement initialAdmins={admins} permissions={permissions} tenants={tenants} />;
}
