import { useEffect, useState, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { PageHeader, Pagination, EmptyState, Loading, Select } from "@/components/common";
import { SupplierTypeBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { MagnifyingGlass, TrayArrowDown, Trash } from "@phosphor-icons/react";

export default function StockIn() {
  const [tab, setTab] = useState("input");
  return (
    <div>
      <PageHeader title="Stock In" subtitle="Barang masuk per supplier. Harga otomatis dari harga efektif pada tanggal transaksi." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm"><TabsTrigger value="input" className="rounded-sm" data-testid="tab-input">Input Stock In</TabsTrigger><TabsTrigger value="history" className="rounded-sm" data-testid="tab-history">Riwayat Transaksi</TabsTrigger></TabsList>
        <TabsContent value="input" className="mt-4"><InputStockIn /></TabsContent>
        <TabsContent value="history" className="mt-4"><StockInHistory /></TabsContent>
      </Tabs>
    </div>
  );
}

function InputStockIn() {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierType, setSupplierType] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState({}); // product_id -> {sku,name,quantity,price,manual}
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get("/suppliers", { params: { active: "active" } }).then(({ data }) => setSuppliers(data)); }, []);

  const load = useCallback(async () => {
    if (!supplierId) { setData(null); return; }
    setLoading(true);
    try {
      const { data } = await api.get("/stock-in/products", { params: { supplier_id: supplierId, on_date: date, search, page, page_size: 50 } });
      setData(data); setSupplierType(data.supplier_type);
    } finally { setLoading(false); }
  }, [supplierId, date, search, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [supplierId, search, date]);

  const setQty = (row, qty) => {
    const q = parseInt(qty);
    setCart((c) => {
      const n = { ...c };
      if (!qty || isNaN(q) || q <= 0) delete n[row.product_id];
      else n[row.product_id] = { ...n[row.product_id], product_id: row.product_id, sku: row.sku, name: row.name, quantity: q, price: row.effective_price, manual: n[row.product_id]?.manual };
      return n;
    });
  };
  const setManual = (pid, val) => setCart((c) => ({ ...c, [pid]: { ...c[pid], manual: val === "" ? null : parseFloat(val) } }));

  const items = Object.values(cart);
  const batchTotal = items.reduce((s, it) => s + (it.quantity * (it.price != null ? it.price : (it.manual || 0))), 0);

  const submit = async () => {
    if (!items.length) { toast.error("Tambahkan minimal satu item"); return; }
    const payload = items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, manual_price: it.price == null ? it.manual : null }));
    if (items.some((it) => it.price == null && (it.manual == null || it.manual < 0))) { toast.error("Ada SKU tanpa harga efektif — isi harga manual"); return; }
    setSaving(true);
    try {
      const res = await api.post("/stock-in", { transaction_date: date, supplier_id: supplierId, items: payload });
      toast.success(`Stock In tercatat — ${res.data.transaction.reference}${res.data.payable_created ? " (hutang dibuat)" : " (titip jual, tanpa hutang)"}`);
      setCart({}); load();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="border border-slate-200 rounded-sm p-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1"><Label>Supplier *</Label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="stockin-supplier-select">
              <option value="">Pilih supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type === "consignment" ? "Titip Jual" : "Regular"})</option>)}
            </select>
          </div>
          <div><Label>Tanggal</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-sm" data-testid="stockin-date" /></div>
          {supplierType && <div className="pb-1"><SupplierTypeBadge type={supplierType} /></div>}
        </div>

        {!supplierId ? <EmptyState title="Pilih supplier" message="Sistem hanya menampilkan SKU yang terhubung dengan supplier terpilih." icon={TrayArrowDown} /> : (
          <>
            <div className="relative"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari SKU / nama produk" className="h-9 pl-9 rounded-sm" data-testid="stockin-search" /></div>
            <div className="border border-slate-200 rounded-sm overflow-auto">
              <table className="ims-table w-full">
                <thead><tr><th>SKU</th><th>Produk</th><th className="text-right">Harga Efektif</th><th className="text-right w-28">Qty</th><th className="text-right">Subtotal</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={5}><Loading /></td></tr>}
                  {!loading && data?.items.length === 0 && <tr><td colSpan={5}><EmptyState title="Tidak ada SKU" message="Hubungkan SKU ke supplier ini dari halaman Produk." /></td></tr>}
                  {!loading && data?.items.map((r) => {
                    const c = cart[r.product_id];
                    const price = r.effective_price != null ? r.effective_price : (c?.manual ?? null);
                    return (
                      <tr key={r.product_id} data-testid={`stockin-prod-${r.sku}`}>
                        <td className="font-data font-semibold">{r.sku}</td>
                        <td className="max-w-[200px] truncate">{r.name}</td>
                        <td className="text-right font-data">
                          {r.effective_price != null ? formatRupiah(r.effective_price) : (
                            <Input type="number" placeholder="harga manual" value={c?.manual ?? ""} onChange={(e) => setManual(r.product_id, e.target.value)} className="h-7 w-28 ml-auto text-right font-data rounded-sm" data-testid={`stockin-manual-${r.sku}`} />
                          )}
                        </td>
                        <td className="text-right"><Input type="number" value={c?.quantity ?? ""} onChange={(e) => setQty(r, e.target.value)} className="h-7 w-20 ml-auto text-right font-data rounded-sm" data-testid={`stockin-qty-${r.sku}`} placeholder="0" /></td>
                        <td className="text-right font-data">{c?.quantity && price != null ? formatRupiah(c.quantity * price) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data && <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />}
          </>
        )}
      </div>

      <div className="lg:col-span-1">
        <div className="border border-slate-200 rounded-sm sticky top-20">
          <div className="p-3 border-b border-slate-200"><h3 className="font-heading font-bold">Keranjang <span className="text-slate-400 font-sans font-normal text-sm">({items.length})</span></h3></div>
          {items.length === 0 ? <div className="p-6 text-center text-sm text-slate-400">Isi qty pada tabel untuk menambah item</div> : (
            <div className="max-h-80 overflow-auto divide-y divide-slate-100">
              {items.map((it) => (
                <div key={it.product_id} className="p-2 flex items-center justify-between text-sm" data-testid={`cart-${it.sku}`}>
                  <div className="min-w-0"><div className="font-data font-semibold text-[13px]">{it.sku}</div><div className="text-xs text-slate-500">{formatNumber(it.quantity)} × {formatRupiah(it.price != null ? it.price : it.manual)}</div></div>
                  <div className="flex items-center gap-2"><span className="font-data font-semibold">{formatRupiah(it.quantity * (it.price != null ? it.price : (it.manual || 0)))}</span>
                    <button onClick={() => setCart((c) => { const n = { ...c }; delete n[it.product_id]; return n; })} className="text-slate-400 hover:text-[#B91C1C]"><Trash size={14} /></button></div>
                </div>
              ))}
            </div>
          )}
          <div className="p-3 border-t border-slate-200 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-slate-500">Total Batch</span><span className="font-data font-bold">{formatRupiah(batchTotal)}</span></div>
            {supplierType === "consignment" && <p className="text-xs text-purple-700">Titip jual: tidak menimbulkan hutang saat stock in.</p>}
            <Button onClick={submit} disabled={saving || items.length === 0} className="w-full h-9 rounded-sm" data-testid="stockin-confirm-btn">{saving ? "Menyimpan..." : "Konfirmasi Stock In"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StockInHistory() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => { api.get("/stock-in", { params: { page, page_size: 20 } }).then(({ data }) => setData(data)); }, [page]);
  if (!data) return <Loading />;
  return (
    <div className="border border-slate-200 rounded-sm overflow-auto">
      <table className="ims-table w-full">
        <thead><tr><th>Referensi</th><th>Tanggal</th><th>Supplier</th><th>Tipe</th><th className="text-right">Total Qty</th><th className="text-right">Total Nilai</th><th>Oleh</th></tr></thead>
        <tbody>
          {data.items.length === 0 && <tr><td colSpan={7}><EmptyState title="Belum ada transaksi stock in" /></td></tr>}
          {data.items.map((t) => (
            <tr key={t.id} data-testid={`stockin-txn-${t.reference}`}>
              <td className="font-data font-semibold">{t.reference}</td><td>{formatDate(t.transaction_date)}</td><td>{t.supplier_name}</td>
              <td><SupplierTypeBadge type={t.supplier_type} /></td>
              <td className="text-right font-data">{formatNumber(t.total_quantity)}</td>
              <td className="text-right font-data font-semibold">{formatRupiah(t.total_value)}</td><td className="text-slate-500">{t.created_by_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
    </div>
  );
}
