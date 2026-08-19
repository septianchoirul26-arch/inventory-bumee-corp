import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, KpiCard, Pagination, Select, EmptyState, Loading } from "@/components/common";
import { StatusBadge } from "@/components/StatusBadge";
import ProductDetailSheet from "@/components/ProductDetailSheet";
import BulkImport from "@/components/BulkImport";
import PhotoUpload from "@/components/PhotoUpload";
import { formatRupiah, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, UploadSimple, MagnifyingGlass, Package, CheckCircle, Warning, WarningCircle, CaretUp, CaretDown, DownloadSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Products() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ types: [], suppliers: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [statusFilter, setStatusFilter] = useState(params.get("filter") || "");
  const [active, setActive] = useState("");
  const [sort, setSort] = useState("sku");
  const [order, setOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(params.get("open") || null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const toggleSel = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const loadMeta = useCallback(async () => {
    const [s, f] = await Promise.all([api.get("/products/summary"), api.get("/products/filters")]);
    setSummary(s.data); setFilters(f.data);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/products", { params: { search, type, supplier_id: supplierId, stock_status_filter: statusFilter, active, sort, order, page, page_size: 25 } });
      setData(data);
    } finally { setLoading(false); }
  }, [search, type, supplierId, statusFilter, active, sort, order, page]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [search, type, supplierId, statusFilter, active]);

  const toggleSort = (key) => { if (sort === key) setOrder(order === "asc" ? "desc" : "asc"); else { setSort(key); setOrder("asc"); } };
  const SortHead = ({ label, k, right }) => (
    <th className={`cursor-pointer select-none ${right ? "text-right" : ""}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{label}{sort === k && (order === "asc" ? <CaretUp size={11} /> : <CaretDown size={11} />)}</span>
    </th>
  );
  const refresh = () => { load(); loadMeta(); };
  const allOnPage = data?.items.map((i) => i.id) || [];
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.includes(id));
  const toggleAll = () => setSelected((s) => allSelected ? s.filter((id) => !allOnPage.includes(id)) : [...new Set([...s, ...allOnPage])]);
  const doBulkDelete = async () => { await api.post("/products/bulk-delete", { ids: selected }); toast.success(`${selected.length} produk dihapus`); setSelected([]); setBulkDelOpen(false); refresh(); };

  return (
    <div>
      <PageHeader title="Produk / SKU" subtitle="Master data seluruh item inventory">
        {isAdmin && selected.length > 0 && <Button variant="outline" className="h-9 rounded-sm gap-2 text-[#B91C1C] border-[#FEE2E2] hover:bg-[#FEE2E2]" onClick={() => setBulkDelOpen(true)} data-testid="bulk-delete-btn"><Trash size={16} /> Hapus ({selected.length})</Button>}
        {isAdmin && <Button data-testid="import-csv-btn" variant="outline" className="h-9 rounded-sm gap-2" onClick={() => setImportOpen(true)}><UploadSimple size={16} /> Impor CSV/Excel</Button>}
        {isAdmin && <Button data-testid="add-sku-btn" className="h-9 rounded-sm gap-2" onClick={() => setAddOpen(true)}><Plus size={16} /> Tambah SKU</Button>}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard testid="summary-total" label="Total SKU" value={formatNumber(summary?.total_sku ?? 0)} icon={Package} />
        <KpiCard testid="summary-active" label="SKU Aktif" value={formatNumber(summary?.active_sku ?? 0)} icon={CheckCircle} accent="text-[#15803D]" />
        <KpiCard testid="summary-low" label="Stok Rendah" value={formatNumber(summary?.low_stock ?? 0)} icon={Warning} accent="text-[#B45309]" onClick={() => setStatusFilter("low")} />
        <KpiCard testid="summary-critical" label="Stok Kritis" value={formatNumber(summary?.critical_stock ?? 0)} icon={WarningCircle} accent="text-[#B91C1C]" onClick={() => setStatusFilter("critical")} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input data-testid="product-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari SKU atau nama produk" className="h-9 pl-9 rounded-sm" />
        </div>
        <Select testid="filter-type" value={type} onChange={setType} placeholder="Semua Kategori" options={filters.types.map((t) => ({ value: t, label: t }))} />
        <Select testid="filter-supplier" value={supplierId} onChange={setSupplierId} placeholder="Semua Supplier" options={filters.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <Select testid="filter-status" value={statusFilter} onChange={setStatusFilter} placeholder="Semua Status" options={[{ value: "safe", label: "Aman" }, { value: "low", label: "Rendah" }, { value: "critical", label: "Kritis" }]} />
        <Select testid="filter-active" value={active} onChange={setActive} placeholder="Aktif & Nonaktif" options={[{ value: "active", label: "Aktif" }, { value: "inactive", label: "Nonaktif" }]} />
      </div>

      <div className="border border-slate-200 rounded-sm overflow-auto">
        <table className="ims-table w-full">
          <thead><tr>
            {isAdmin && <th className="w-8"><Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="select-all" /></th>}
            <SortHead label="SKU" k="sku" /><SortHead label="Nama" k="name" /><th>Kategori</th>
            <SortHead label="Stok" k="stock" right /><th className="text-right">Min</th>
            <SortHead label="Harga Beli" k="price" right /><th>Status</th>{isAdmin && <th></th>}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={isAdmin ? 9 : 8}><Loading /></td></tr>}
            {!loading && data?.items.length === 0 && <tr><td colSpan={isAdmin ? 9 : 8}><EmptyState title="Tidak ada produk" message="Sesuaikan filter atau tambah SKU baru." /></td></tr>}
            {!loading && data?.items.map((p) => (
              <tr key={p.id} className="cursor-pointer" onClick={() => setOpenId(p.id)} data-testid={`product-row-${p.sku}`}>
                {isAdmin && <td onClick={(e) => e.stopPropagation()}><Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggleSel(p.id)} data-testid={`select-${p.sku}`} /></td>}
                <td className="font-data font-semibold">{p.sku}{!p.is_active && <span className="ml-2 text-[10px] uppercase text-slate-400">(nonaktif)</span>}</td>
                <td className="max-w-[240px] truncate">{p.name}</td>
                <td className="text-slate-600">{p.type || "—"}</td>
                <td className="text-right font-data font-semibold">{formatNumber(p.current_stock)}</td>
                <td className="text-right font-data text-slate-500">{formatNumber(p.minimum_stock)}</td>
                <td className="text-right font-data">{formatRupiah(p.current_purchase_price)}</td>
                <td><StatusBadge status={p.stock_status} /></td>
                {isAdmin && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {p.is_active ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-[#B91C1C] hover:bg-[#FEE2E2] rounded-sm" onClick={() => setDeactivateTarget(p)} data-testid={`deactivate-${p.sku}`}>Nonaktifkan</Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-[#15803D] hover:bg-[#DCFCE7] rounded-sm" onClick={async () => { await api.post(`/products/${p.id}/activate`); toast.success("SKU diaktifkan"); refresh(); }} data-testid={`activate-${p.sku}`}>Aktifkan</Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}

      <ProductDetailSheet productId={openId} open={!!openId} onClose={() => { setOpenId(null); setParams({}); }} onChanged={refresh} />
      <AddSkuDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={refresh} />

      <Dialog open={importOpen} onOpenChange={(o) => !o && setImportOpen(false)}>
        <DialogContent className="max-w-3xl" data-testid="import-products-dialog">
          <DialogHeader><DialogTitle>Impor Produk</DialogTitle><DialogDescription>Impor SKU massal dari CSV/Excel dengan validasi & pratinjau.</DialogDescription></DialogHeader>
          <a href="/contoh-import-produk.xlsx" download className="text-sm text-slate-900 underline inline-flex items-center gap-1 mb-1 w-fit" data-testid="download-template-btn"><DownloadSimple size={14} /> Unduh contoh file (.xlsx)</a>
          <BulkImport hint={"sku\tname\ttype\tminimum_stock\nF010\tMolten V10\tFutsal\t15"}
            fields={[{ key: "sku" }, { key: "name" }, { key: "type" }, { key: "minimum_stock" }]}
            previewColumns={[{ key: "sku", label: "SKU", mono: true }, { key: "name", label: "Nama" }, { key: "type", label: "Kategori" }, { key: "minimum_stock", label: "Min", num: true }]}
            validate={async (rows) => (await api.post("/products/import/validate", { rows })).data}
            onCommit={async (validRows) => { const res = await api.post("/products/import/commit", { rows: validRows }); toast.success(`${res.data.created} produk diimpor`); setImportOpen(false); refresh(); }} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDelOpen} onOpenChange={setBulkDelOpen}>
        <AlertDialogContent data-testid="bulk-delete-dialog">
          <AlertDialogHeader><AlertDialogTitle>Hapus {selected.length} produk?</AlertDialogTitle>
            <AlertDialogDescription>Produk terpilih beserta relasi supplier, riwayat harga, dan mutasi stoknya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel>
            <AlertDialogAction className="rounded-sm bg-[#B91C1C] hover:bg-[#991b1b]" onClick={(e) => { e.preventDefault(); doBulkDelete(); }} data-testid="confirm-bulk-delete-btn">Hapus Permanen</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent data-testid="deactivate-dialog">
          <AlertDialogHeader><AlertDialogTitle>Nonaktifkan {deactivateTarget?.sku}?</AlertDialogTitle>
            <AlertDialogDescription>SKU tidak akan muncul di transaksi baru atau sesi opname, namun tetap ada di seluruh riwayat dan laporan. SKU dengan riwayat tidak pernah dihapus permanen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel>
            <AlertDialogAction className="rounded-sm bg-[#B91C1C] hover:bg-[#991b1b]" data-testid="confirm-deactivate-btn" onClick={async () => { await api.post(`/products/${deactivateTarget.id}/deactivate`); toast.success("SKU dinonaktifkan"); setDeactivateTarget(null); refresh(); }}>Nonaktifkan</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddSkuDialog({ open, onClose, onSaved }) {
  const empty = { sku: "", name: "", type: "", photo_url: "", minimum_stock: "", critical_stock: "", supplier_id: "", price: "" };
  const [form, setForm] = useState(empty);
  const [suppliers, setSuppliers] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setForm(empty); api.get("/suppliers", { params: { active: "active" } }).then(({ data }) => setSuppliers(data)); } /* eslint-disable-next-line */ }, [open]);
  const save = async () => {
    if (!form.sku || !form.name) { toast.error("SKU dan Nama wajib diisi"); return; }
    if (!form.supplier_id) { toast.error("Supplier wajib dipilih"); return; }
    setSaving(true);
    try {
      await api.post("/products", { sku: form.sku, name: form.name, type: form.type, photo_url: form.photo_url, minimum_stock: parseInt(form.minimum_stock) || 0, critical_stock: form.critical_stock ? parseInt(form.critical_stock) : null, supplier_id: form.supplier_id, price: form.price ? parseFloat(form.price) : null });
      toast.success("SKU dibuat"); onSaved(); onClose();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="add-sku-dialog">
        <DialogHeader><DialogTitle>Tambah SKU</DialogTitle><DialogDescription>Buat item inventory baru. Supplier wajib dipilih.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>SKU *</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-sm font-data" data-testid="add-sku-input" placeholder="F001" /></div>
            <div><Label>Kategori</Label><Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-sm" placeholder="Futsal Lokal" /></div>
          </div>
          <div><Label>Nama Produk *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm" data-testid="add-name-input" placeholder="Molten V5000 Hijau" /></div>
          <div><Label>Supplier *</Label>
            <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm" data-testid="add-supplier-select">
              <option value="">Pilih supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type === "consignment" ? "Titip Jual" : "Regular"})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Harga Beli (Rp)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="rounded-sm font-data" data-testid="add-price-input" /></div>
            <div><Label>Min Stock</Label><Input type="number" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })} className="rounded-sm font-data" data-testid="add-min-input" /></div>
            <div><Label>Critical</Label><Input type="number" value={form.critical_stock} onChange={(e) => setForm({ ...form, critical_stock: e.target.value })} className="rounded-sm font-data" placeholder="50% min" /></div>
          </div>
          <div><Label>Foto Produk (opsional)</Label><PhotoUpload value={form.photo_url} onChange={(url) => setForm({ ...form, photo_url: url })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} disabled={saving} className="rounded-sm" data-testid="add-save-btn">{saving ? "Menyimpan..." : "Buat SKU"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
