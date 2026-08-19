import { useEffect, useState, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Loading } from "@/components/common";
import { DebtStatusBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, HandCoins } from "@phosphor-icons/react";

export default function Settlements() {
  const { isAdmin } = useAuth();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const load = useCallback(() => api.get("/settlements").then(({ data }) => setList(data)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Titip Jual / Settlement" subtitle="Settlement periodik untuk supplier consignment. Hutang dibuat saat finalisasi.">
        {isAdmin && <Button className="h-9 rounded-sm gap-2" onClick={() => setOpen(true)} data-testid="new-settlement-btn"><Plus size={16} /> Settlement Baru</Button>}
      </PageHeader>
      {!list ? <Loading /> : list.length === 0 ? <EmptyState title="Belum ada settlement" message="Buat settlement untuk supplier titip jual." icon={HandCoins} /> : (
        <div className="border border-slate-200 rounded-sm overflow-auto">
          <table className="ims-table w-full">
            <thead><tr><th>Referensi</th><th>Supplier</th><th>Periode</th><th className="text-right">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} data-testid={`settlement-row-${s.reference}`}>
                  <td className="font-data font-semibold">{s.reference}</td><td>{s.supplier_name}</td>
                  <td className="text-slate-500">{formatDate(s.period_start)} – {formatDate(s.period_end)}</td>
                  <td className="text-right font-data font-semibold">{formatRupiah(s.total)}</td>
                  <td><DebtStatusBadge status={s.status} /></td>
                  <td className="text-right"><Button size="sm" variant="outline" className="h-7 rounded-sm text-xs" onClick={() => setDetailId(s.id)} data-testid={`settlement-detail-${s.reference}`}>Detail</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewSettlementDialog open={open} onClose={() => setOpen(false)} onSaved={(id) => { load(); setDetailId(id); }} />
      {detailId && <SettlementDetail id={detailId} onClose={() => setDetailId(null)} onChanged={load} isAdmin={isAdmin} />}
    </div>
  );
}

function NewSettlementDialog({ open, onClose, onSaved }) {
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ supplier_id: "", period_start: todayISO(), period_end: todayISO(), note: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) api.get("/suppliers", { params: { type: "consignment", active: "active" } }).then(({ data }) => setSuppliers(data)); }, [open]);
  const save = async () => {
    if (!form.supplier_id) { toast.error("Pilih supplier titip jual"); return; }
    setSaving(true);
    try { const { data } = await api.post("/settlements", form); toast.success("Settlement dibuat (draft)"); onClose(); onSaved(data.id); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="new-settlement-dialog">
        <DialogHeader><DialogTitle>Settlement Baru</DialogTitle><DialogDescription>Sistem menghitung barang tersedia, stok akhir, qty terkonsumsi, dan nilai per SKU.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Supplier Titip Jual</Label>
            <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm" data-testid="settlement-supplier-select">
              <option value="">Pilih supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Periode Awal</Label><Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} className="rounded-sm" data-testid="settlement-start" /></div>
            <div><Label>Periode Akhir</Label><Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} className="rounded-sm" data-testid="settlement-end" /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} disabled={saving} className="rounded-sm" data-testid="settlement-create-btn">{saving ? "Membuat..." : "Buat Draft"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettlementDetail({ id, onClose, onChanged, isAdmin }) {
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const load = useCallback(async () => { const { data } = await api.get(`/settlements/${id}`); setData(data); setEdits({}); }, [id]);
  useEffect(() => { load(); }, [load]);

  const s = data?.settlement;
  const draft = s?.status === "draft";
  const setEdit = (pid, field, val) => setEdits((e) => ({ ...e, [pid]: { ...e[pid], [field]: val } }));

  const saveItems = async () => {
    const items = Object.entries(edits).map(([product_id, v]) => ({ product_id, closing_stock: v.closing !== undefined ? (v.closing === "" ? null : parseInt(v.closing)) : undefined, settlement_price: v.price !== undefined ? (v.price === "" ? null : parseFloat(v.price)) : undefined, validated: v.validated }));
    try { const { data } = await api.patch(`/settlements/${id}/items`, { items }); setData(data); setEdits({}); toast.success("Perubahan disimpan"); onChanged(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const finalize = async () => {
    try { const { data } = await api.post(`/settlements/${id}/finalize`); toast.success(`Settlement difinalkan — hutang ${formatRupiah(data.total)} dibuat`); setFinalizeOpen(false); load(); onChanged(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="settlement-detail-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2">Settlement {s?.reference} {s && <DebtStatusBadge status={s.status} />}</DialogTitle>
          <DialogDescription>{s?.supplier_name} · {s && `${formatDate(s.period_start)} – ${formatDate(s.period_end)}`}</DialogDescription></DialogHeader>
        {!data ? <Loading /> : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Barang tersedia = saldo awal + barang masuk periode. Qty terkonsumsi = tersedia − stok akhir. Validasi stok akhir sebelum finalisasi.</p>
            <div className="border border-slate-200 rounded-sm overflow-auto max-h-[50vh]">
              <table className="ims-table w-full">
                <thead><tr><th>SKU</th><th>Produk</th><th className="text-right">Saldo Awal</th><th className="text-right">Masuk</th><th className="text-right">Stok Akhir</th><th className="text-right">Qty Keluar</th><th className="text-right">Harga</th><th className="text-right">Nilai</th><th>Valid</th></tr></thead>
                <tbody>
                  {data.items.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-4">Tidak ada item pada periode ini</td></tr>}
                  {data.items.map((it) => {
                    const e = edits[it.product_id] || {};
                    const closing = e.closing !== undefined ? e.closing : it.closing_stock;
                    const price = e.price !== undefined ? e.price : it.settlement_price;
                    const validated = e.validated !== undefined ? e.validated : it.validated;
                    const available = it.opening_stock + it.stock_in_period;
                    const qty = closing === "" || closing == null ? it.qty_consumed : available - parseInt(closing);
                    return (
                      <tr key={it.id} data-testid={`settlement-item-${it.sku}`}>
                        <td className="font-data font-semibold">{it.sku}</td><td className="max-w-[160px] truncate">{it.product_name}</td>
                        <td className="text-right font-data">{formatNumber(it.opening_stock)}</td><td className="text-right font-data">{formatNumber(it.stock_in_period)}</td>
                        <td className="text-right">{draft ? <Input type="number" value={closing ?? ""} onChange={(ev) => setEdit(it.product_id, "closing", ev.target.value)} className="h-7 w-20 ml-auto text-right font-data rounded-sm" data-testid={`settlement-closing-${it.sku}`} /> : <span className="font-data">{formatNumber(it.closing_stock)}</span>}</td>
                        <td className="text-right font-data font-semibold">{formatNumber(qty)}</td>
                        <td className="text-right">{draft ? <Input type="number" value={price ?? ""} onChange={(ev) => setEdit(it.product_id, "price", ev.target.value)} className="h-7 w-24 ml-auto text-right font-data rounded-sm" data-testid={`settlement-price-${it.sku}`} /> : <span className="font-data">{formatRupiah(it.settlement_price)}</span>}</td>
                        <td className="text-right font-data font-semibold">{formatRupiah(Math.max(qty, 0) * (price || 0))}</td>
                        <td>{draft ? <Checkbox checked={!!validated} onCheckedChange={(v) => setEdit(it.product_id, "validated", v)} data-testid={`settlement-valid-${it.sku}`} /> : (it.validated ? "✓" : "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm">Total: <span className="font-data font-bold">{formatRupiah(s.total)}</span></div>
              {draft && isAdmin && (
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 rounded-sm" onClick={saveItems} disabled={!Object.keys(edits).length} data-testid="settlement-save-items">Simpan Perubahan</Button>
                  <Button className="h-9 rounded-sm bg-[#15803D] hover:bg-[#166534]" onClick={() => setFinalizeOpen(true)} data-testid="settlement-finalize-btn">Finalisasi & Buat Hutang</Button>
                </div>
              )}
            </div>
          </div>
        )}
        <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Finalisasi Settlement?</AlertDialogTitle><AlertDialogDescription>Semua stok akhir harus tervalidasi. Setelah final, hutang supplier dibuat sebesar total settlement dan settlement tidak bisa diubah.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel><AlertDialogAction className="rounded-sm bg-[#15803D] hover:bg-[#166534]" onClick={(e) => { e.preventDefault(); finalize(); }} data-testid="confirm-settlement-finalize">Finalisasi</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
