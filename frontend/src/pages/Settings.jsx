import { useEffect, useState, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState } from "@/components/common";
import PhotoUpload from "@/components/PhotoUpload";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { formatDateTime, exportCsv } from "@/lib/format";
import { toast } from "sonner";
import { Plus, DownloadSimple, Trash, Lock } from "@phosphor-icons/react";

export default function Settings() {
  const { isAdmin } = useAuth();
  return (
    <div>
      <PageHeader title="Pengaturan" subtitle="Konfigurasi sistem inventory & purchasing" />
      <Tabs defaultValue="general">
        <TabsList className="rounded-sm flex-wrap h-auto">
          <TabsTrigger value="general" className="rounded-sm" data-testid="tab-general">Umum</TabsTrigger>
          <TabsTrigger value="inventory" className="rounded-sm" data-testid="tab-inventory">Inventory</TabsTrigger>
          <TabsTrigger value="users" className="rounded-sm" data-testid="tab-users">Pengguna</TabsTrigger>
          <TabsTrigger value="data" className="rounded-sm" data-testid="tab-data">Data</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4"><GeneralInventory isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="inventory" className="mt-4"><GeneralInventory isAdmin={isAdmin} inventory /></TabsContent>
        <TabsContent value="users" className="mt-4"><Users isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="data" className="mt-4"><DataManagement isAdmin={isAdmin} /></TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralInventory({ isAdmin, inventory }) {
  const { reloadSettings } = useAuth();
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get("/settings").then(({ data }) => setS(data)); }, []);
  if (!s) return null;
  const upd = (k, v) => setS({ ...s, [k]: v });
  const save = async () => { setSaving(true); try { await api.patch("/settings", s); toast.success("Pengaturan disimpan"); reloadSettings(); } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); } };
  return (
    <div className="border border-slate-200 rounded-sm p-5 max-w-2xl space-y-4">
      {!isAdmin && <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 p-2 rounded-sm"><Lock size={14} /> Hanya administrator yang dapat mengubah pengaturan.</div>}
      {!inventory ? (
        <div className="space-y-4">
          <div><Label>Logo Usaha</Label><PhotoUpload value={s.logo_url} onChange={(url) => upd("logo_url", url)} /></div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><Label>Nama Usaha</Label><Input value={s.business_name} onChange={(e) => upd("business_name", e.target.value)} disabled={!isAdmin} className="rounded-sm" data-testid="set-business-name" /></div>
            <div><Label>Mata Uang</Label><Input value={s.currency} onChange={(e) => upd("currency", e.target.value)} disabled={!isAdmin} className="rounded-sm" /></div>
            <div><Label>Zona Waktu</Label><Input value={s.timezone} onChange={(e) => upd("timezone", e.target.value)} disabled={!isAdmin} className="rounded-sm" /></div>
            <div><Label>Format Tanggal</Label><Input value={s.date_format} onChange={(e) => upd("date_format", e.target.value)} disabled={!isAdmin} className="rounded-sm" /></div>
            <div><Label>Tema</Label>
              <select value={s.theme} onChange={(e) => upd("theme", e.target.value)} disabled={!isAdmin} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm"><option value="light">Terang</option><option value="dark">Gelap</option></select>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div><Label>Minimum Stock Default</Label><Input type="number" value={s.default_minimum_stock} onChange={(e) => upd("default_minimum_stock", parseInt(e.target.value) || 0)} disabled={!isAdmin} className="rounded-sm font-data" /></div>
            <div><Label>Ambang Kritis (% dari minimum)</Label><Input type="number" value={s.critical_threshold_percent} onChange={(e) => upd("critical_threshold_percent", parseInt(e.target.value) || 0)} disabled={!isAdmin} className="rounded-sm font-data" data-testid="set-critical-threshold" /></div>
          </div>
          <div className="flex items-center justify-between border border-slate-200 rounded-sm p-3"><div><div className="font-medium text-sm">Izinkan Stok Negatif</div><div className="text-xs text-slate-500">Default nonaktif.</div></div><Switch checked={s.allow_negative_stock} onCheckedChange={(v) => upd("allow_negative_stock", v)} disabled={!isAdmin} data-testid="set-allow-negative" /></div>
          <div className="flex items-center justify-between border border-slate-200 rounded-sm p-3"><div><div className="font-medium text-sm">Konfirmasi Sebelum Finalisasi Opname</div><div className="text-xs text-slate-500">Tampilkan dialog konfirmasi.</div></div><Switch checked={s.require_opname_confirmation} onCheckedChange={(v) => upd("require_opname_confirmation", v)} disabled={!isAdmin} /></div>
        </div>
      )}
      {isAdmin && <Button onClick={save} disabled={saving} className="rounded-sm" data-testid="save-settings-btn">{saving ? "Menyimpan..." : "Simpan Perubahan"}</Button>}
    </div>
  );
}

function Users({ isAdmin }) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const load = () => api.get("/users").then(({ data }) => setUsers(data)).catch(() => {});
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);
  if (!isAdmin) return <div className="border border-slate-200 rounded-sm p-5 text-sm text-slate-500 flex items-center gap-2"><Lock size={16} /> Hanya administrator yang dapat mengelola pengguna.</div>;
  return (
    <div>
      <div className="flex justify-between items-center mb-3"><p className="text-sm text-slate-500">Administrator: akses penuh. Staff: lihat inventory, stock in, opname, history, report.</p><Button className="h-9 rounded-sm gap-2" onClick={() => setOpen(true)} data-testid="add-user-btn"><Plus size={16} /> Tambah Pengguna</Button></div>
      <div className="border border-slate-200 rounded-sm overflow-auto">
        <table className="ims-table w-full">
          <thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Status</th><th>Dibuat</th><th></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} data-testid={`user-row-${u.email}`}>
              <td className="font-medium">{u.name}</td><td className="font-data text-xs">{u.email}</td>
              <td><span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-sm bg-slate-100">{u.role === "admin" ? "Admin" : "Staff"}</span></td>
              <td>{u.is_active !== false ? <span className="text-[#15803D] text-xs font-semibold">Aktif</span> : <span className="text-slate-400 text-xs">Nonaktif</span>}</td>
              <td className="text-slate-500">{formatDateTime(u.created_at)}</td>
              <td>{u.id !== me.id && <button onClick={() => setDelTarget(u)} className="text-slate-400 hover:text-[#B91C1C]" data-testid={`delete-user-${u.email}`}><Trash size={15} /></button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <AddUserDialog open={open} onClose={() => setOpen(false)} onSaved={load} />
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Hapus {delTarget?.name}?</AlertDialogTitle><AlertDialogDescription>Menghapus akses pengguna. Tidak bisa dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel><AlertDialogAction className="rounded-sm bg-[#B91C1C] hover:bg-[#991b1b]" onClick={async () => { await api.delete(`/users/${delTarget.id}`); toast.success("Pengguna dihapus"); setDelTarget(null); load(); }} data-testid="confirm-delete-user">Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddUserDialog({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" });
  useEffect(() => { if (open) setForm({ name: "", email: "", password: "", role: "staff" }); }, [open]);
  const save = async () => {
    if (!form.name || !form.email || !form.password) { toast.error("Semua field wajib diisi"); return; }
    try { await api.post("/users", form); toast.success("Pengguna dibuat"); onSaved(); onClose(); } catch (e) { toast.error(apiError(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="add-user-dialog">
        <DialogHeader><DialogTitle>Tambah Pengguna</DialogTitle><DialogDescription>Buat akun administrator atau staff.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nama</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm" data-testid="user-name-input" /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-sm font-data" data-testid="user-email-input" /></div>
          <div><Label>Kata Sandi</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-sm" data-testid="user-password-input" /></div>
          <div><Label>Peran</Label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm" data-testid="user-role-select"><option value="staff">Staff</option><option value="admin">Administrator</option></select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} className="rounded-sm" data-testid="user-save-btn">Buat</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DataManagement({ isAdmin }) {
  const [busy, setBusy] = useState(false);
  const exportProducts = async () => { setBusy(true); try { const { data } = await api.get("/products", { params: { page_size: 100000, page: 1 } }); exportCsv("produk.csv", data.items, [{ key: "sku", label: "SKU" }, { key: "name", label: "Nama" }, { key: "type", label: "Kategori" }, { key: "current_stock", label: "Stok" }, { key: "minimum_stock", label: "Min" }, { key: "current_purchase_price", label: "Harga Beli" }, { key: "stock_status", label: "Status" }]); } finally { setBusy(false); } };
  const exportInventory = async () => { setBusy(true); try { const { data } = await api.get("/movements", { params: { page_size: 100000, page: 1 } }); exportCsv("mutasi-inventory.csv", data.items, [{ key: "movement_date", label: "Tanggal" }, { key: "sku", label: "SKU" }, { key: "product_name", label: "Produk" }, { key: "movement_type", label: "Jenis" }, { key: "quantity", label: "Qty" }, { key: "balance_after", label: "Saldo" }, { key: "created_by_name", label: "Pengguna" }]); } finally { setBusy(false); } };
  return (
    <div className="border border-slate-200 rounded-sm p-5 max-w-2xl">
      <h3 className="font-heading font-bold mb-1">Ekspor Data</h3>
      <p className="text-sm text-slate-500 mb-3">Unduh data sebagai CSV untuk analisis atau cadangan.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-sm gap-2" onClick={exportProducts} disabled={busy} data-testid="export-products-btn"><DownloadSimple size={16} /> Ekspor Produk</Button>
        <Button variant="outline" className="rounded-sm gap-2" onClick={exportInventory} disabled={busy} data-testid="export-inventory-btn"><DownloadSimple size={16} /> Ekspor Inventory</Button>
      </div>
    </div>
  );
}
