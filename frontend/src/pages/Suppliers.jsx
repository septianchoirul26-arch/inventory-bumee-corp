import { useEffect, useState, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Loading, Select } from "@/components/common";
import { SupplierTypeBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, MagnifyingGlass, Buildings, Trash } from "@phosphor-icons/react";

export default function Suppliers() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [active, setActive] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const toggleSel = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const load = useCallback(async () => {
    const { data } = await api.get("/suppliers", { params: { search, type, active } });
    setData(data);
  }, [search, type, active]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const allOnPage = data?.map((i) => i.id) || [];
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.includes(id));
  const toggleAll = () => setSelected((s) => allSelected ? s.filter((id) => !allOnPage.includes(id)) : [...new Set([...s, ...allOnPage])]);
  const doBulkDelete = async () => { await api.post("/suppliers/bulk-delete", { ids: selected }); toast.success(`${selected.length} supplier dihapus`); setSelected([]); setBulkDelOpen(false); load(); };

  return (
    <div>
      <PageHeader title="Supplier" subtitle="Master data supplier — regular & titip jual (consignment)">
        {isAdmin && selected.length > 0 && <Button variant="outline" className="h-9 rounded-sm gap-2 text-[#B91C1C] border-[#FEE2E2] hover:bg-[#FEE2E2]" onClick={() => setBulkDelOpen(true)} data-testid="bulk-delete-supplier-btn"><Trash size={16} /> Hapus ({selected.length})</Button>}
        {isAdmin && <Button className="h-9 rounded-sm gap-2" onClick={() => setOpen(true)} data-testid="add-supplier-btn"><Plus size={16} /> Tambah Supplier</Button>}
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama supplier" className="h-9 pl-9 rounded-sm" data-testid="supplier-search" /></div>
        <Select testid="supplier-type-filter" value={type} onChange={setType} placeholder="Semua Tipe" options={[{ value: "regular", label: "Regular" }, { value: "consignment", label: "Titip Jual" }]} />
        <Select testid="supplier-active-filter" value={active} onChange={setActive} placeholder="Aktif & Nonaktif" options={[{ value: "active", label: "Aktif" }, { value: "inactive", label: "Nonaktif" }]} />
      </div>
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="Belum ada supplier" message="Tambah supplier untuk mulai stock in." icon={Buildings} /> : (
        <div className="border border-slate-200 rounded-sm overflow-auto">
          <table className="ims-table w-full">
            <thead><tr>{isAdmin && <th className="w-8"><Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="select-all-supplier" /></th>}<th>Nama</th><th>Tipe</th><th>Kontak</th><th className="text-right">Jumlah SKU</th><th className="text-right">Hutang Outstanding</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} data-testid={`supplier-row-${s.name}`}>
                  {isAdmin && <td><Checkbox checked={selected.includes(s.id)} onCheckedChange={() => toggleSel(s.id)} data-testid={`select-supplier-${s.name}`} /></td>}
                  <td className="font-medium">{s.name}</td>
                  <td><SupplierTypeBadge type={s.type} /></td>
                  <td className="text-slate-500">{s.contact || "—"}</td>
                  <td className="text-right font-data">{formatNumber(s.product_count)}</td>
                  <td className="text-right font-data font-semibold">{s.outstanding_debt ? formatRupiah(s.outstanding_debt) : "—"}</td>
                  <td>{s.is_active ? <span className="text-[#15803D] text-xs font-semibold">Aktif</span> : <span className="text-slate-400 text-xs">Nonaktif</span>}</td>
                  {isAdmin && (
                    <td className="text-right">
                      <button className="text-xs text-slate-900 font-semibold hover:underline mr-2" onClick={() => setEdit(s)} data-testid={`edit-supplier-${s.name}`}>Edit</button>
                      {s.is_active ? <button className="text-xs text-[#B91C1C] hover:underline" onClick={async () => { await api.post(`/suppliers/${s.id}/deactivate`); toast.success("Supplier dinonaktifkan"); load(); }}>Nonaktif</button>
                        : <button className="text-xs text-[#15803D] hover:underline" onClick={async () => { await api.post(`/suppliers/${s.id}/activate`); toast.success("Supplier diaktifkan"); load(); }}>Aktifkan</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SupplierDialog open={open || !!edit} onClose={() => { setOpen(false); setEdit(null); }} supplier={edit} onSaved={load} />
      <AlertDialog open={bulkDelOpen} onOpenChange={setBulkDelOpen}>
        <AlertDialogContent data-testid="bulk-delete-supplier-dialog">
          <AlertDialogHeader><AlertDialogTitle>Hapus {selected.length} supplier?</AlertDialogTitle>
            <AlertDialogDescription>Supplier terpilih beserta relasi produk, riwayat harga, hutang, pembayaran, dan settlement-nya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel>
            <AlertDialogAction className="rounded-sm bg-[#B91C1C] hover:bg-[#991b1b]" onClick={(e) => { e.preventDefault(); doBulkDelete(); }} data-testid="confirm-bulk-delete-supplier-btn">Hapus Permanen</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SupplierDialog({ open, onClose, supplier, onSaved }) {
  const empty = { name: "", contact: "", address: "", notes: "", type: "regular" };
  const [form, setForm] = useState(empty);
  useEffect(() => { if (open) setForm(supplier ? { name: supplier.name, contact: supplier.contact || "", address: supplier.address || "", notes: supplier.notes || "", type: supplier.type } : empty); }, [open, supplier]);
  const save = async () => {
    if (!form.name) { toast.error("Nama wajib diisi"); return; }
    try {
      if (supplier) await api.patch(`/suppliers/${supplier.id}`, form);
      else await api.post("/suppliers", form);
      toast.success(supplier ? "Supplier diperbarui" : "Supplier dibuat"); onSaved(); onClose();
    } catch (e) { toast.error(apiError(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="supplier-dialog">
        <DialogHeader><DialogTitle>{supplier ? "Edit Supplier" : "Tambah Supplier"}</DialogTitle><DialogDescription>Supplier titip jual tidak menimbulkan hutang saat stock in.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nama *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm" data-testid="supplier-name-input" /></div>
          <div><Label>Tipe Supplier</Label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm" data-testid="supplier-type-select">
              <option value="regular">Regular (menimbulkan hutang)</option><option value="consignment">Titip Jual / Consignment (settlement)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Kontak</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="rounded-sm" /></div>
            <div><Label>Alamat</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-sm" /></div>
          </div>
          <div><Label>Catatan</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-sm" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} className="rounded-sm" data-testid="supplier-save-btn">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
