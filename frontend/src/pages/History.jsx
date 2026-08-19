import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { PageHeader, Pagination, Select, EmptyState, Loading } from "@/components/common";
import { MovementBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, formatTime, formatDateTime } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MagnifyingGlass } from "@phosphor-icons/react";

export default function History() {
  return (
    <div>
      <PageHeader title="History" subtitle="Telusuri seluruh mutasi stok dan aktivitas sistem" />
      <Tabs defaultValue="movements">
        <TabsList className="rounded-sm"><TabsTrigger value="movements" className="rounded-sm" data-testid="tab-mutasi">Mutasi Stok</TabsTrigger><TabsTrigger value="audit" className="rounded-sm" data-testid="tab-audit">Aktivitas & Audit</TabsTrigger></TabsList>
        <TabsContent value="movements" className="mt-4"><Movements /></TabsContent>
        <TabsContent value="audit" className="mt-4"><Audit /></TabsContent>
      </Tabs>
    </div>
  );
}

function Movements() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ suppliers: [] });
  const [users, setUsers] = useState([]);
  const [detail, setDetail] = useState(null);
  const [f, setF] = useState({ date_from: "", date_to: "", type: "", supplier_id: "", user_id: "", search: "" });
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get("/products/filters").then(({ data }) => setFilters(data));
    api.get("/users").then(({ data }) => setUsers(data)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/movements", { params: { ...f, page, page_size: 30 } }); setData(data); } finally { setLoading(false); }
  }, [f, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [f]);
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={f.search} onChange={(e) => upd("search", e.target.value)} placeholder="Cari SKU / produk / referensi" className="h-9 pl-9 rounded-sm" data-testid="history-search" /></div>
        <input type="date" value={f.date_from} onChange={(e) => upd("date_from", e.target.value)} className="h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="history-from" />
        <input type="date" value={f.date_to} onChange={(e) => upd("date_to", e.target.value)} className="h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="history-to" />
        <Select testid="history-type" value={f.type} onChange={(v) => upd("type", v)} placeholder="Semua Jenis" options={[{ value: "STOCK_IN", label: "Stok Masuk" }, { value: "OPNAME_ADJUSTMENT", label: "Penyesuaian Opname" }, { value: "MANUAL_ADJUSTMENT", label: "Penyesuaian Manual" }]} />
        <Select testid="history-supplier" value={f.supplier_id} onChange={(v) => upd("supplier_id", v)} placeholder="Semua Supplier" options={filters.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <Select testid="history-user" value={f.user_id} onChange={(v) => upd("user_id", v)} placeholder="Semua Pengguna" options={users.map((u) => ({ value: u.id, label: u.name }))} />
      </div>
      <div className="border border-slate-200 rounded-sm overflow-auto">
        <table className="ims-table w-full">
          <thead><tr><th>Tanggal</th><th>Waktu</th><th>SKU</th><th>Produk</th><th>Jenis</th><th className="text-right">Qty</th><th className="text-right">Saldo</th><th>Pengguna</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8}><Loading /></td></tr>}
            {!loading && data?.items.length === 0 && <tr><td colSpan={8}><EmptyState title="Tidak ada mutasi" /></td></tr>}
            {!loading && data?.items.map((m) => (
              <tr key={m.id} className="cursor-pointer" onClick={() => setDetail(m)} data-testid={`history-row-${m.id}`}>
                <td className="text-slate-500">{formatDate(m.movement_date)}</td><td className="text-slate-400 font-data">{formatTime(m.created_at)}</td>
                <td className="font-data font-semibold">{m.sku}</td><td className="max-w-[200px] truncate">{m.product_name}</td>
                <td><MovementBadge type={m.movement_type} /></td>
                <td className={`text-right font-data font-semibold ${m.quantity < 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>{m.quantity > 0 ? "+" : ""}{formatNumber(m.quantity)}</td>
                <td className="text-right font-data">{formatNumber(m.balance_after)}</td><td className="text-slate-500">{m.created_by_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} pageSize={30} total={data.total} onPage={setPage} />}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent data-testid="movement-detail-dialog">
          <DialogHeader><DialogTitle>Detail Transaksi</DialogTitle><DialogDescription>Referensi {detail?.reference || "—"}</DialogDescription></DialogHeader>
          {detail && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <D label="Referensi" v={detail.reference || "—"} mono /><D label="Jenis" v={<MovementBadge type={detail.movement_type} />} />
              <D label="Tanggal" v={formatDate(detail.movement_date)} /><D label="Dicatat" v={formatDateTime(detail.created_at)} />
              <D label="SKU" v={detail.sku} mono /><D label="Produk" v={detail.product_name} />
              <D label="Qty" v={`${detail.quantity > 0 ? "+" : ""}${formatNumber(detail.quantity)}`} mono /><D label="Saldo Sesudah" v={formatNumber(detail.balance_after)} mono />
              {detail.purchase_price != null && <D label="Harga Beli" v={formatRupiah(detail.purchase_price)} mono />}
              {detail.total_value != null && <D label="Total Nilai" v={formatRupiah(detail.total_value)} mono />}
              {detail.reason && <D label="Alasan" v={detail.reason} />}
              <D label="Sumber" v={detail.reference_type} /><D label="Pengguna" v={detail.created_by_name} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Audit() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const load = useCallback(async () => { const { data } = await api.get("/audit", { params: { page, page_size: 40, search } }); setData(data); }, [page, search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const rv = (v) => v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <div>
      <div className="relative max-w-sm mb-3"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari referensi / pengguna" className="h-9 pl-9 rounded-sm" data-testid="audit-search" /></div>
      {!data ? <Loading /> : (
        <div className="border border-slate-200 rounded-sm overflow-auto">
          <table className="ims-table w-full">
            <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Entitas</th><th>Referensi</th><th>Perubahan</th></tr></thead>
            <tbody>
              {data.items.length === 0 && <tr><td colSpan={6}><EmptyState title="Belum ada aktivitas" /></td></tr>}
              {data.items.map((a) => (
                <tr key={a.id} data-testid={`audit-row-${a.id}`}>
                  <td className="text-slate-500">{formatDateTime(a.created_at)}</td><td className="font-medium">{a.user_name}</td>
                  <td><span className="text-[11px] font-semibold uppercase bg-slate-100 px-2 py-0.5 rounded-sm">{a.action.replace(/_/g, " ")}</span></td>
                  <td className="text-slate-500">{a.entity_type}</td><td className="font-data text-xs">{a.reference}</td>
                  <td className="text-xs text-slate-500 max-w-[240px] truncate">{a.before_value != null && `${rv(a.before_value)} → `}{rv(a.after_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={40} total={data.total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

function D({ label, v, mono }) { return <div><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div><div className={`mt-0.5 ${mono ? "font-data font-semibold" : ""}`}>{v}</div></div>; }
