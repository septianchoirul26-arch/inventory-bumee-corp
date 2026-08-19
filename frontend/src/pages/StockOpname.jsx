import { useEffect, useState, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { PageHeader, Pagination, EmptyState, Loading } from "@/components/common";
import { SupplierTypeBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { MagnifyingGlass, ClipboardText } from "@phosphor-icons/react";

export default function StockOpname() {
  const [tab, setTab] = useState("input");
  return (
    <div>
      <PageHeader title="Stock Opname" subtitle="Hitung stok fisik harian per supplier. Stok keluar = Total Qty − Stok fisik." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm"><TabsTrigger value="input" className="rounded-sm" data-testid="tab-input">Input Opname</TabsTrigger><TabsTrigger value="history" className="rounded-sm" data-testid="tab-history">Riwayat Opname</TabsTrigger></TabsList>
        <TabsContent value="input" className="mt-4"><OpnameInput /></TabsContent>
        <TabsContent value="history" className="mt-4"><OpnameHistory /></TabsContent>
      </Tabs>
    </div>
  );
}

function OpnameInput() {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierType, setSupplierType] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState({}); // product_id -> physical (string)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get("/suppliers", { params: { active: "active" } }).then(({ data }) => setSuppliers(data)); }, []);
  const load = useCallback(async () => {
    if (!supplierId) { setData(null); return; }
    setLoading(true);
    try { const { data } = await api.get("/opname-daily/products", { params: { supplier_id: supplierId, on_date: date, search, page, page_size: 50 } }); setData(data); setSupplierType(data.supplier_type); }
    finally { setLoading(false); }
  }, [supplierId, date, search, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [supplierId, search, date]);

  const items = Object.entries(edits).filter(([, v]) => v !== "" && v != null).map(([product_id, v]) => ({ product_id, physical_stock: parseInt(v) }));
  const submit = async () => {
    if (!items.length) { toast.error("Isi minimal satu kolom Stok"); return; }
    setSaving(true);
    try {
      const res = await api.post("/opname-daily", { supplier_id: supplierId, opname_date: date, items });
      toast.success(`Opname tersimpan — total stok keluar ${formatNumber(res.data.total_out_qty)}${res.data.payable_created ? `, hutang titip jual ${formatRupiah(res.data.total_out_value)} dibuat` : ""}`);
      setEdits({}); setConfirmOpen(false); load();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="border border-slate-200 rounded-sm p-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><Label>Supplier *</Label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="opname-supplier-select">
            <option value="">Pilih supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type === "consignment" ? "Titip Jual" : "Regular"})</option>)}
          </select>
        </div>
        <div><Label>Tanggal</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-sm" data-testid="opname-date" /></div>
        {supplierType && <div className="pb-1"><SupplierTypeBadge type={supplierType} /></div>}
      </div>

      {!supplierId ? <EmptyState title="Pilih supplier" message="Pilih supplier dan tanggal untuk mulai menghitung stok fisik." icon={ClipboardText} /> : (
        <>
          <div className="relative"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari SKU / nama produk" className="h-9 pl-9 rounded-sm" data-testid="opname-search" /></div>
          {supplierType === "consignment" && <p className="text-xs text-purple-700">Titip jual: stok keluar otomatis menjadi hutang yang bisa dicicil.</p>}
          <div className="border border-slate-200 rounded-sm overflow-auto">
            <table className="ims-table w-full">
              <thead><tr><th>SKU</th><th>Produk</th><th className="text-right">Total Qty</th><th className="text-right w-28">Stok</th><th className="text-right">Stok Keluar</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5}><Loading /></td></tr>}
                {!loading && data?.items.length === 0 && <tr><td colSpan={5}><EmptyState title="Tidak ada SKU" message="Hubungkan SKU ke supplier ini." /></td></tr>}
                {!loading && data?.items.map((r) => {
                  const v = edits[r.product_id];
                  const phys = v === "" || v == null ? null : parseInt(v);
                  const keluar = phys == null ? null : r.total_qty - phys;
                  return (
                    <tr key={r.product_id} data-testid={`opname-prod-${r.sku}`}>
                      <td className="font-data font-semibold">{r.sku}</td>
                      <td className="max-w-[220px] truncate">{r.name}</td>
                      <td className="text-right font-data font-semibold">{formatNumber(r.total_qty)}</td>
                      <td className="text-right"><Input type="number" value={v ?? ""} onChange={(e) => setEdits({ ...edits, [r.product_id]: e.target.value })} className="h-7 w-24 ml-auto text-right font-data rounded-sm" data-testid={`opname-stok-${r.sku}`} placeholder="—" /></td>
                      <td className={`text-right font-data font-semibold ${keluar == null ? "text-slate-300" : keluar > 0 ? "text-[#B91C1C]" : keluar < 0 ? "text-[#15803D]" : "text-slate-500"}`}>{keluar == null ? "—" : formatNumber(keluar)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">{items.length} SKU diisi</span>
            <Button onClick={() => setConfirmOpen(true)} disabled={items.length === 0} className="h-9 rounded-sm" data-testid="opname-submit-btn">Simpan Opname</Button>
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="opname-confirm-dialog">
          <AlertDialogHeader><AlertDialogTitle>Simpan Opname Harian?</AlertDialogTitle>
            <AlertDialogDescription>Stok fisik akan menjadi stok terbaru. Stok keluar dicatat sebagai mutasi keluar.{supplierType === "consignment" && " Untuk titip jual, stok keluar otomatis menjadi hutang."}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel><AlertDialogAction className="rounded-sm" onClick={(e) => { e.preventDefault(); submit(); }} disabled={saving} data-testid="opname-confirm-btn">{saving ? "Menyimpan..." : "Simpan"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OpnameHistory() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => { api.get("/opname-daily", { params: { page, page_size: 20 } }).then(({ data }) => setData(data)); }, [page]);
  if (!data) return <Loading />;
  return (
    <div className="border border-slate-200 rounded-sm overflow-auto">
      <table className="ims-table w-full">
        <thead><tr><th>Referensi</th><th>Tanggal</th><th>Supplier</th><th>Tipe</th><th className="text-right">Total Stok Keluar</th><th className="text-right">Nilai Hutang</th><th>Oleh</th></tr></thead>
        <tbody>
          {data.items.length === 0 && <tr><td colSpan={7}><EmptyState title="Belum ada opname" /></td></tr>}
          {data.items.map((t) => (
            <tr key={t.id} data-testid={`opname-hist-${t.reference}`}>
              <td className="font-data font-semibold">{t.reference}</td><td>{formatDate(t.opname_date)}</td><td>{t.supplier_name}</td>
              <td><SupplierTypeBadge type={t.supplier_type} /></td>
              <td className="text-right font-data">{formatNumber(t.total_out_qty)}</td>
              <td className="text-right font-data font-semibold">{t.total_out_value ? formatRupiah(t.total_out_value) : "—"}</td>
              <td className="text-slate-500">{t.created_by_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
    </div>
  );
}
