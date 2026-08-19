import { useEffect, useState, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { PageHeader, Pagination, Select, EmptyState, Loading, KpiCard } from "@/components/common";
import { DebtStatusBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MagnifyingGlass, Money, Plus, Trash } from "@phosphor-icons/react";

export default function Payables() {
  return (
    <div>
      <PageHeader title="Hutang & Pembayaran" subtitle="Hutang supplier regular (stock in) & titip jual (opname/settlement)" />
      <Tabs defaultValue="list">
        <TabsList className="rounded-sm"><TabsTrigger value="list" className="rounded-sm" data-testid="tab-list">Daftar Hutang</TabsTrigger><TabsTrigger value="card" className="rounded-sm" data-testid="tab-debt-card">Kartu Utang Supplier</TabsTrigger><TabsTrigger value="bulk" className="rounded-sm" data-testid="tab-bulk-payment">Pembayaran Massal</TabsTrigger></TabsList>
        <TabsContent value="list" className="mt-4"><PayableList /></TabsContent>
        <TabsContent value="card" className="mt-4"><DebtCard /></TabsContent>
        <TabsContent value="bulk" className="mt-4"><BulkPayment /></TabsContent>
      </Tabs>
    </div>
  );
}

function PayableList() {
  const [data, setData] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [f, setF] = useState({ supplier_id: "", status: "", search: "" });
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(null);
  useEffect(() => { api.get("/suppliers").then(({ data }) => setSuppliers(data)); }, []);
  const load = useCallback(async () => { const { data } = await api.get("/payables", { params: { ...f, page, page_size: 25 } }); setData(data); }, [f, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(1); }, [f]);
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4"><KpiCard testid="payable-outstanding" label="Total Outstanding" value={formatRupiah(data?.total_outstanding ?? 0)} icon={Money} accent="text-[#B91C1C]" /></div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="Cari referensi" className="h-9 pl-9 rounded-sm" data-testid="payable-search" /></div>
        <Select testid="payable-supplier" value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} placeholder="Semua Supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <Select testid="payable-status" value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder="Semua Status" options={[{ value: "open", label: "Belum Bayar" }, { value: "partial", label: "Sebagian" }, { value: "paid", label: "Lunas" }]} />
      </div>
      {!data ? <Loading /> : data.items.length === 0 ? <EmptyState title="Belum ada hutang" icon={Money} /> : (
        <div className="border border-slate-200 rounded-sm overflow-auto">
          <table className="ims-table w-full">
            <thead><tr><th>Referensi</th><th>Supplier</th><th>Sumber</th><th>Tanggal</th><th className="text-right">Total</th><th className="text-right">Terbayar</th><th className="text-right">Sisa</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.items.map((p) => (
              <tr key={p.id} data-testid={`payable-row-${p.reference}`}>
                <td className="font-data font-semibold">{p.reference}</td><td>{p.supplier_name}</td>
                <td className="text-slate-500">{p.source_type === "settlement" ? "Settlement" : p.source_type === "consignment_opname" ? "Opname Titip Jual" : "Stock In"}</td>
                <td className="text-slate-500">{formatDate(p.date)}</td>
                <td className="text-right font-data">{formatRupiah(p.amount_initial)}</td><td className="text-right font-data text-[#15803D]">{formatRupiah(p.amount_paid)}</td>
                <td className="text-right font-data font-semibold">{formatRupiah(p.amount_remaining)}</td><td><DebtStatusBadge status={p.status} /></td>
                <td className="text-right"><Button size="sm" variant="outline" className="h-7 rounded-sm text-xs" onClick={() => setDetailId(p.id)} data-testid={`payable-detail-${p.reference}`}>Detail</Button></td>
              </tr>
            ))}</tbody>
          </table>
          <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
        </div>
      )}
      {detailId && <PayableDetail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function PayableDetail({ id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { const { data } = await api.get(`/payables/${id}`); setData(data); }, [id]);
  useEffect(() => { load(); }, [load]);
  const pay = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Nominal harus > 0"); return; }
    setSaving(true);
    try { await api.post(`/payables/${id}/payments`, { amount: amt, payment_date: payDate, note }); toast.success("Pembayaran tercatat"); setAmount(""); setNote(""); load(); onChanged(); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  const p = data?.payable;
  const locked = p && (p.status === "paid" || p.status === "void");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="payable-detail-dialog">
        <DialogHeader><DialogTitle>Hutang {p?.reference}</DialogTitle><DialogDescription>{p?.supplier_name}</DialogDescription></DialogHeader>
        {p && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-[11px] uppercase font-bold text-slate-400">Total</div><div className="font-data font-semibold">{formatRupiah(p.amount_initial)}</div></div>
              <div><div className="text-[11px] uppercase font-bold text-slate-400">Terbayar</div><div className="font-data font-semibold text-[#15803D]">{formatRupiah(p.amount_paid)}</div></div>
              <div><div className="text-[11px] uppercase font-bold text-slate-400">Sisa</div><div className="font-data font-semibold text-[#B91C1C]">{formatRupiah(p.amount_remaining)}</div></div>
            </div>
            {!locked && (
              <div className="border border-slate-200 rounded-sm p-3 space-y-2">
                <div className="text-sm font-semibold">Catat Pembayaran (cicilan diperbolehkan)</div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-[11px]">Nominal (Rp)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-sm font-data h-9" data-testid="payment-amount" /></div>
                  <div><Label className="text-[11px]">Tanggal</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="rounded-sm h-9" /></div>
                </div>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="rounded-sm" />
                <Button onClick={pay} disabled={saving} className="w-full h-9 rounded-sm" data-testid="payment-submit">{saving ? "Menyimpan..." : "Simpan Pembayaran"}</Button>
              </div>
            )}
            <div>
              <div className="text-[11px] uppercase font-bold text-slate-400 mb-1">Riwayat Pembayaran</div>
              <div className="border border-slate-200 rounded-sm overflow-auto max-h-52">
                <table className="ims-table w-full"><thead><tr><th>Tanggal</th><th className="text-right">Nominal</th><th>Oleh</th></tr></thead>
                  <tbody>{data.payments.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-3">Belum ada pembayaran</td></tr>}
                    {data.payments.map((pm) => <tr key={pm.id}><td>{formatDate(pm.payment_date)}</td><td className="text-right font-data font-semibold">{formatRupiah(pm.amount)}</td><td className="text-slate-500">{pm.created_by_name}</td></tr>)}
                  </tbody></table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DebtCard() {
  const [suppliers, setSuppliers] = useState([]);
  const [sid, setSid] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/suppliers").then(({ data }) => setSuppliers(data)); }, []);
  useEffect(() => { if (!sid) { setData(null); return; } api.get(`/suppliers/${sid}/debt-card`).then(({ data }) => setData(data)); }, [sid]);
  return (
    <div className="space-y-4">
      <div className="max-w-sm"><Label>Supplier</Label>
        <select value={sid} onChange={(e) => setSid(e.target.value)} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm" data-testid="debtcard-supplier">
          <option value="">Pilih supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {!sid ? <EmptyState title="Pilih supplier" message="Pilih supplier untuk melihat kartu utang lengkap." icon={Money} /> : !data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard testid="dc-total" label="Total Hutang" value={formatRupiah(data.totals.initial)} icon={Money} />
            <KpiCard testid="dc-paid" label="Terbayar" value={formatRupiah(data.totals.paid)} accent="text-[#15803D]" />
            <KpiCard testid="dc-remaining" label="Sisa Hutang" value={formatRupiah(data.totals.remaining)} accent="text-[#B91C1C]" />
            <KpiCard testid="dc-count" label="Jumlah Invoice" value={formatNumber(data.totals.invoice_count)} />
          </div>
          {data.payables.length === 0 ? <EmptyState title="Tidak ada hutang" message="Supplier ini belum memiliki catatan hutang." /> : (
            <div className="space-y-3">
              {data.payables.map((p) => (
                <div key={p.id} className="border border-slate-200 rounded-sm overflow-hidden" data-testid={`debtcard-inv-${p.reference}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-slate-100 bg-slate-50">
                    <div><span className="font-data font-semibold text-[13px]">{p.reference}</span><span className="text-xs text-slate-500 ml-2">{formatDate(p.date)} · {p.source_type === "settlement" ? "Settlement" : p.source_type === "consignment_opname" ? "Opname Titip Jual" : "Stock In"}</span></div>
                    <div className="flex items-center gap-3 text-sm"><span className="font-data">Total {formatRupiah(p.amount_initial)}</span><span className="font-data text-[#15803D]">Bayar {formatRupiah(p.amount_paid)}</span><span className="font-data font-semibold text-[#B91C1C]">Sisa {formatRupiah(p.amount_remaining)}</span><DebtStatusBadge status={p.status} /></div>
                  </div>
                  <table className="ims-table w-full">
                    <thead><tr><th>Tanggal Bayar</th><th className="text-right">Nominal</th><th>Catatan</th><th>Oleh</th></tr></thead>
                    <tbody>
                      {p.payments.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-2 text-xs">Belum ada pembayaran</td></tr>}
                      {p.payments.map((pm) => <tr key={pm.id}><td>{formatDate(pm.payment_date)}</td><td className="text-right font-data font-semibold">{formatRupiah(pm.amount)}</td><td className="text-slate-500">{pm.note || "—"}</td><td className="text-slate-500">{pm.created_by_name}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BulkPayment() {
  const [summary, setSummary] = useState([]);
  const [rows, setRows] = useState([{ supplier_id: "", amount: "", payment_date: todayISO(), note: "" }]);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api.get("/payables-summary").then(({ data }) => setSummary(data.rows)), []);
  useEffect(() => { load(); }, [load]);
  const sMap = Object.fromEntries(summary.map((s) => [s.supplier_id, s]));

  const upd = (i, k, v) => setRows((r) => r.map((row, idx) => idx === i ? { ...row, [k]: v } : row));
  const addRow = () => setRows((r) => [...r, { supplier_id: "", amount: "", payment_date: todayISO(), note: "" }]);
  const delRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  const submit = async () => {
    const payments = rows.filter((r) => r.supplier_id && parseFloat(r.amount) > 0).map((r) => ({ supplier_id: r.supplier_id, amount: parseFloat(r.amount), payment_date: r.payment_date, note: r.note }));
    if (!payments.length) { toast.error("Isi minimal satu baris pembayaran"); return; }
    setSaving(true);
    try { await api.post("/payables/bulk-payment", { payments }); toast.success("Pembayaran massal tersimpan — diterapkan ke invoice terlama dulu"); setRows([{ supplier_id: "", amount: "", payment_date: todayISO(), note: "" }]); load(); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Pembayaran diterapkan otomatis ke invoice terlama (FIFO) untuk tiap supplier. Nominal tidak boleh melebihi total hutang.</p>
      <div className="border border-slate-200 rounded-sm overflow-auto">
        <table className="ims-table w-full">
          <thead><tr><th>Supplier</th><th className="text-right">Total Hutang</th><th className="text-right w-40">Nominal Bayar</th><th className="w-40">Tanggal</th><th>Catatan</th><th></th></tr></thead>
          <tbody>
            {rows.map((row, i) => {
              const info = sMap[row.supplier_id];
              return (
                <tr key={i} data-testid={`bulk-row-${i}`}>
                  <td><select value={row.supplier_id} onChange={(e) => upd(i, "supplier_id", e.target.value)} className="h-8 rounded-sm border border-slate-200 px-2 text-sm w-full" data-testid={`bulk-supplier-${i}`}>
                    <option value="">Pilih supplier</option>{summary.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name} ({s.invoice_count} inv)</option>)}
                  </select></td>
                  <td className="text-right font-data font-semibold">{info ? formatRupiah(info.total_remaining) : "—"}</td>
                  <td className="text-right"><Input type="number" value={row.amount} onChange={(e) => upd(i, "amount", e.target.value)} className="h-8 text-right font-data rounded-sm" data-testid={`bulk-amount-${i}`} /></td>
                  <td><Input type="date" value={row.payment_date} onChange={(e) => upd(i, "payment_date", e.target.value)} className="h-8 rounded-sm" /></td>
                  <td><Input value={row.note} onChange={(e) => upd(i, "note", e.target.value)} className="h-8 rounded-sm" placeholder="opsional" /></td>
                  <td>{rows.length > 1 && <button onClick={() => delRow(i)} className="text-slate-400 hover:text-[#B91C1C]"><Trash size={15} /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <Button variant="outline" className="h-9 rounded-sm gap-1" onClick={addRow} data-testid="bulk-add-row"><Plus size={16} /> Tambah Baris</Button>
        <Button className="h-9 rounded-sm" onClick={submit} disabled={saving} data-testid="bulk-submit">{saving ? "Menyimpan..." : "Bayar"}</Button>
      </div>
    </div>
  );
}
