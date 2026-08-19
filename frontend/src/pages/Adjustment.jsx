import { useState, useEffect, useCallback } from "react";
import api, { apiError } from "@/lib/api";
import { PageHeader } from "@/components/common";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MagnifyingGlass, Sliders } from "@phosphor-icons/react";

export default function Adjustment() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("delta");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const doSearch = useCallback(async (q) => {
    if (!q) { setResults([]); return; }
    const { data } = await api.get("/products", { params: { search: q, active: "active", page_size: 8 } });
    setResults(data.items);
  }, []);
  useEffect(() => { const t = setTimeout(() => doSearch(search), 250); return () => clearTimeout(t); }, [search, doSearch]);

  const submit = async () => {
    if (!selected) { toast.error("Pilih produk"); return; }
    if (value === "" || isNaN(parseInt(value))) { toast.error("Isi nilai yang valid"); return; }
    setSaving(true);
    try {
      const { data } = await api.post("/adjustments", { product_id: selected.id, mode, value: parseInt(value), reason });
      toast.success(`Penyesuaian tercatat — stok baru ${formatNumber(data.new_stock)}`);
      setSelected(null); setValue(""); setReason(""); setSearch("");
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Adjustment" subtitle="Penyesuaian stok manual (bukan penjualan). Tercatat di ledger sebagai Penyesuaian Manual." />
      <div className="max-w-xl border border-slate-200 rounded-sm p-5 space-y-4">
        <div className="relative">
          <Label>Cari SKU / Produk</Label>
          <div className="relative">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ketik SKU atau nama" className="rounded-sm pl-9" data-testid="adj-search" />
          </div>
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-sm shadow-lg max-h-56 overflow-auto">
              {results.map((p) => (
                <button key={p.id} onClick={() => { setSelected(p); setSearch(""); setResults([]); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100" data-testid={`adj-result-${p.sku}`}>
                  <div className="font-data text-[13px] font-semibold">{p.sku}</div><div className="text-xs text-slate-500">{p.name} · stok {formatNumber(p.current_stock)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 space-y-3" data-testid="adj-selected">
            <div><div className="text-[11px] uppercase font-bold text-slate-400">Produk</div><div className="text-sm font-semibold">{selected.name}</div><div className="font-data text-xs text-slate-500">{selected.sku} · stok saat ini {formatNumber(selected.current_stock)}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[11px]">Mode</Label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="adj-mode">
                  <option value="delta">Selisih (+/-)</option><option value="set">Set ke nilai</option>
                </select>
              </div>
              <div><Label className="text-[11px]">{mode === "delta" ? "Perubahan" : "Stok Baru"}</Label><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="rounded-sm font-data h-9" data-testid="adj-value" placeholder={mode === "delta" ? "mis. -5 atau 10" : "mis. 120"} /></div>
            </div>
            <div><Label className="text-[11px]">Alasan / Catatan</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-sm" data-testid="adj-reason" placeholder="mis. koreksi barang rusak" /></div>
            <Button onClick={submit} disabled={saving} className="w-full h-9 rounded-sm gap-1" data-testid="adj-submit"><Sliders size={16} /> {saving ? "Menyimpan..." : "Simpan Penyesuaian"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
