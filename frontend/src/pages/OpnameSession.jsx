import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, Select } from "@/components/common";
import { OpnameStatusBadge } from "@/components/StatusBadge";
import BulkImport from "@/components/BulkImport";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatNumber } from "@/lib/format";
import { toast } from "sonner";
import { CaretLeft, MagnifyingGlass, FloppyDisk } from "@phosphor-icons/react";

export default function OpnameSession() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [edits, setEdits] = useState({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [override, setOverride] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/opname/${id}`, { params: { search, status_filter: statusFilter } });
    setSession(data.session); setItems(data.items);
  }, [id, search, statusFilter]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const finalized = session?.status === "finalized";
  const saveCounts = async () => {
    const counts = Object.entries(edits).map(([product_id, v]) => ({ product_id, physical_stock: v === "" ? null : parseInt(v) }));
    if (!counts.length) { toast.info("Tidak ada perubahan"); return; }
    setSaving(true);
    try { await api.patch(`/opname/${id}/counts`, { counts }); toast.success("Hitungan disimpan"); setEdits({}); load(); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  const doFinalize = async () => {
    try { const { data } = await api.post(`/opname/${id}/finalize`, { override_incomplete: override }); toast.success(`Opname difinalkan — ${data.adjustments_created} penyesuaian dibuat`); setFinalizeOpen(false); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  if (!session) return <Loading />;
  const pct = session.total_items ? Math.round((session.counted_items / session.total_items) * 100) : 0;
  const incomplete = session.counted_items < session.total_items;

  return (
    <div className="pb-24">
      <button onClick={() => nav("/stock-opname")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-3" data-testid="back-to-opname"><CaretLeft size={16} /> Semua sesi</button>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div><h1 className="font-heading text-2xl font-black tracking-tight flex items-center gap-3">{session.reference} <OpnameStatusBadge status={session.status} /></h1>
          <p className="text-sm text-slate-500 mt-0.5">{formatDate(session.opname_date)} · Snapshot {session.snapshot_time} · {session.created_by_name}</p></div>
      </div>

      {finalized ? (
        <div className="border border-slate-200 rounded-sm overflow-auto"><OpnameTable items={items} finalized /></div>
      ) : (
        <Tabs defaultValue="count">
          <TabsList className="rounded-sm"><TabsTrigger value="count" className="rounded-sm" data-testid="tab-count">Input Hitungan</TabsTrigger><TabsTrigger value="bulk" className="rounded-sm" data-testid="tab-bulk-opname">Impor Massal</TabsTrigger></TabsList>
          <TabsContent value="count" className="mt-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[200px]"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari SKU / produk" className="h-9 pl-9 rounded-sm" data-testid="opname-item-search" /></div>
              <Select testid="opname-status-filter" value={statusFilter} onChange={setStatusFilter} placeholder="Semua Item" options={[{ value: "counted", label: "Sudah Dihitung" }, { value: "uncounted", label: "Belum Dihitung" }, { value: "difference", label: "Ada Selisih" }]} />
              <Button onClick={saveCounts} disabled={saving || !Object.keys(edits).length} className="h-9 rounded-sm gap-1" data-testid="save-counts-btn"><FloppyDisk size={16} /> Simpan</Button>
            </div>
            <div className="border border-slate-200 rounded-sm overflow-auto max-h-[60vh]"><OpnameTable items={items} edits={edits} setEdits={setEdits} /></div>
          </TabsContent>
          <TabsContent value="bulk" className="mt-4">
            <div className="border border-slate-200 rounded-sm p-4">
              <BulkImport hint={"sku\tphysical_stock\nF001\t142\nF002\t80"} fields={[{ key: "sku" }, { key: "physical_stock" }]}
                previewColumns={[{ key: "sku", label: "SKU", mono: true }, { key: "product_name", label: "Produk" }, { key: "system_stock", label: "Sistem", num: true }, { key: "physical_stock", label: "Fisik", num: true }, { key: "difference", label: "Selisih", render: (r) => r.difference == null ? "—" : (r.difference > 0 ? "+" : "") + formatNumber(r.difference) }]}
                validate={async (rows) => (await api.post(`/opname/${id}/bulk/validate`, { rows })).data}
                onCommit={async (validRows) => { await api.patch(`/opname/${id}/counts`, { counts: validRows.map((r) => ({ product_id: r.product_id, physical_stock: r.physical_stock })) }); toast.success(`${validRows.length} hitungan disimpan`); load(); }} />
            </div>
          </TabsContent>
        </Tabs>
      )}

      <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-slate-200 px-4 lg:px-6 py-3 flex items-center gap-4 z-30">
        <div className="flex-1 max-w-md"><div className="flex justify-between text-xs text-slate-500 mb-1"><span>{formatNumber(session.counted_items)} / {formatNumber(session.total_items)} dihitung</span><span>{pct}%</span></div><Progress value={pct} className="h-2" data-testid="opname-progress" /></div>
        {!finalized && <Button className="h-9 rounded-sm bg-[#15803D] hover:bg-[#166534]" onClick={() => { setOverride(false); setFinalizeOpen(true); }} data-testid="finalize-btn">Finalisasi Opname</Button>}
      </div>

      <AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <AlertDialogContent data-testid="finalize-dialog">
          <AlertDialogHeader><AlertDialogTitle>Finalisasi Stock Opname?</AlertDialogTitle>
            <AlertDialogDescription>Ini membuat mutasi Penyesuaian Opname untuk merekonsiliasi stok sistem dengan hitungan fisik. Sesi final tidak bisa diubah.{incomplete && ` Baru ${session.counted_items} dari ${session.total_items} SKU dihitung.`}</AlertDialogDescription></AlertDialogHeader>
          {incomplete && <label className="flex items-center gap-2 text-sm bg-[#FEF3C7] text-[#B45309] p-2 rounded-sm"><Checkbox checked={override} onCheckedChange={setOverride} data-testid="override-checkbox" disabled={!isAdmin} /> Override administrator: finalisasi dengan SKU belum dihitung {!isAdmin && "(admin saja)"}</label>}
          <AlertDialogFooter><AlertDialogCancel className="rounded-sm">Batal</AlertDialogCancel>
            <AlertDialogAction className="rounded-sm bg-[#15803D] hover:bg-[#166534]" onClick={(e) => { e.preventDefault(); doFinalize(); }} data-testid="confirm-finalize-btn" disabled={incomplete && !override}>Finalisasi</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OpnameTable({ items, edits = {}, setEdits, finalized }) {
  return (
    <table className="ims-table w-full">
      <thead><tr><th>SKU</th><th>Produk</th><th className="text-right">Stok Sistem</th><th className="text-right">Stok Fisik</th><th className="text-right">Selisih</th><th>Status</th></tr></thead>
      <tbody>
        {items.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-6">Tidak ada item</td></tr>}
        {items.map((it) => {
          const editVal = edits[it.product_id];
          const cur = editVal !== undefined ? editVal : (it.physical_stock ?? "");
          const diff = cur === "" || cur == null ? null : parseInt(cur) - it.system_stock;
          const counted = cur !== "" && cur != null;
          return (
            <tr key={it.id} data-testid={`opname-item-${it.sku}`}>
              <td className="font-data font-semibold">{it.sku}</td><td className="max-w-[220px] truncate">{it.product_name}</td>
              <td className="text-right font-data">{formatNumber(it.system_stock)}</td>
              <td className="text-right">{finalized ? <span className="font-data">{it.physical_stock == null ? "—" : formatNumber(it.physical_stock)}</span> : <Input type="number" value={cur} onChange={(e) => setEdits({ ...edits, [it.product_id]: e.target.value })} className="h-7 w-24 ml-auto text-right font-data rounded-sm" data-testid={`physical-input-${it.sku}`} placeholder="—" />}</td>
              <td className={`text-right font-data font-semibold ${diff == null ? "text-slate-300" : diff < 0 ? "text-[#B91C1C]" : diff > 0 ? "text-[#15803D]" : "text-slate-500"}`}>{diff == null ? "—" : (diff > 0 ? "+" : "") + formatNumber(diff)}</td>
              <td>{!counted ? <span className="text-[11px] font-semibold text-slate-400 uppercase">Belum Dihitung</span> : diff === 0 ? <span className="text-[11px] font-semibold text-[#15803D] uppercase">Cocok</span> : <span className="text-[11px] font-semibold text-[#B45309] uppercase">Selisih</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
