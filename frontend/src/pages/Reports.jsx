import { useState } from "react";
import api from "@/lib/api";
import { PageHeader, Select, EmptyState } from "@/components/common";
import { StatusBadge, MovementBadge, DebtStatusBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, exportCsv } from "@/lib/format";
import { getRange, RANGE_PRESETS } from "@/lib/ranges";
import { Button } from "@/components/ui/button";
import { DownloadSimple, ChartBar } from "@phosphor-icons/react";
import { toast } from "sonner";

const REPORTS = [
  { key: "inventory-summary", label: "Inventory", ranged: true },
  { key: "purchases", label: "Pembelian", ranged: true },
  { key: "stock-movement", label: "Stok Keluar / Mutasi", ranged: true },
  { key: "supplier-debt", label: "Supplier (Hutang)", ranged: false },
  { key: "consignment-settlement", label: "Consignment Settlement", ranged: false },
  { key: "low-stock", label: "Low Stock", ranged: false },
];

export default function Reports() {
  const [type, setType] = useState("inventory-summary");
  const [rangeKey, setRangeKey] = useState("this_month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const cfg = REPORTS.find((r) => r.key === type);

  const run = async () => {
    setLoading(true);
    try {
      const params = {};
      if (cfg.ranged) { const r = rangeKey === "custom" && custom.from ? custom : getRange(rangeKey); params.date_from = r.from; params.date_to = r.to; }
      const { data } = await api.get(`/reports/${type}`, { params });
      setData({ type, ...data });
    } catch { toast.error("Gagal membuat laporan"); } finally { setLoading(false); }
  };

  const doExport = () => {
    if (!data?.rows?.length) return;
    const COLS = {
      "inventory-summary": [["sku", "SKU"], ["product", "Produk"], ["opening", "Saldo Awal"], ["stock_in", "Stok Masuk"], ["adjustment", "Penyesuaian"], ["closing", "Stok Akhir"], ["stock_status", "Status"]],
      "purchases": [["date", "Tanggal"], ["supplier", "Supplier"], ["sku", "SKU"], ["product", "Produk"], ["quantity", "Qty"], ["purchase_price", "Harga"], ["total", "Total"]],
      "stock-movement": [["date", "Tanggal"], ["sku", "SKU"], ["product", "Produk"], ["type", "Jenis"], ["quantity", "Qty"], ["balance", "Saldo"], ["user", "Pengguna"]],
      "supplier-debt": [["supplier", "Supplier"], ["reference", "Referensi"], ["date", "Tanggal"], ["amount_initial", "Total"], ["amount_paid", "Terbayar"], ["amount_remaining", "Sisa"], ["status", "Status"]],
      "consignment-settlement": [["reference", "Referensi"], ["supplier", "Supplier"], ["period", "Periode"], ["sku", "SKU"], ["qty_consumed", "Qty Keluar"], ["settlement_price", "Harga"], ["settlement_value", "Nilai"], ["status", "Status"]],
      "low-stock": [["sku", "SKU"], ["product", "Produk"], ["current_stock", "Stok"], ["minimum_stock", "Min"], ["stock_status", "Status"]],
    }[data.type];
    exportCsv(`laporan-${data.type}.csv`, data.rows, COLS.map(([key, label]) => ({ key, label })));
  };

  return (
    <div>
      <PageHeader title="Report" subtitle="Laporan bersumber dari ledger, transaksi, hutang, dan settlement">
        {data?.rows?.length > 0 && <Button onClick={doExport} className="h-9 rounded-sm gap-2" data-testid="report-export-btn"><DownloadSimple size={16} /> Export CSV</Button>}
      </PageHeader>
      <div className="border border-slate-200 rounded-sm p-4 mb-4 flex flex-wrap items-end gap-3">
        <div><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Jenis Laporan</label>
          <Select testid="report-type-select" value={type} onChange={(v) => { setType(v); setData(null); }} options={REPORTS.map((r) => ({ value: r.key, label: r.label }))} className="w-52" /></div>
        {cfg.ranged && (<>
          <div><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Periode</label><Select testid="report-range-select" value={rangeKey} onChange={setRangeKey} options={RANGE_PRESETS.map((p) => ({ value: p.key, label: p.label }))} /></div>
          {rangeKey === "custom" && (<>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="report-custom-from" />
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="report-custom-to" />
          </>)}
        </>)}
        <Button onClick={run} disabled={loading} className="h-9 rounded-sm" data-testid="report-run-btn">{loading ? "Memproses..." : "Buat Laporan"}</Button>
      </div>

      {!data && <EmptyState title="Belum ada laporan" message="Pilih jenis laporan dan periode, lalu buat laporan." icon={ChartBar} />}
      {data && (data.rows?.length === 0 ? <EmptyState title="Tidak ada data" message="Tidak ada catatan untuk kriteria ini." /> : (
        <div className="border border-slate-200 rounded-sm overflow-auto" data-testid="report-table">
          <table className="ims-table w-full">
            {data.type === "inventory-summary" && <>
              <thead><tr><th>SKU</th><th>Produk</th><th className="text-right">Saldo Awal</th><th className="text-right">Stok Masuk</th><th className="text-right">Penyesuaian</th><th className="text-right">Stok Akhir</th><th>Status</th></tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}><td className="font-data font-semibold">{r.sku}</td><td>{r.product}</td><td className="text-right font-data">{formatNumber(r.opening)}</td><td className="text-right font-data text-[#15803D]">{formatNumber(r.stock_in)}</td><td className="text-right font-data">{r.adjustment > 0 ? "+" : ""}{formatNumber(r.adjustment)}</td><td className="text-right font-data font-semibold">{formatNumber(r.closing)}</td><td><StatusBadge status={r.stock_status} /></td></tr>)}
                <tr className="bg-slate-50 font-semibold"><td colSpan={2}>Total</td><td className="text-right font-data">{formatNumber(data.totals.opening)}</td><td className="text-right font-data">{formatNumber(data.totals.stock_in)}</td><td className="text-right font-data">{formatNumber(data.totals.adjustment)}</td><td className="text-right font-data">{formatNumber(data.totals.closing)}</td><td></td></tr></tbody>
            </>}
            {data.type === "purchases" && <>
              <thead><tr><th>Tanggal</th><th>Supplier</th><th>SKU</th><th>Produk</th><th className="text-right">Qty</th><th className="text-right">Harga</th><th className="text-right">Total</th></tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}><td className="text-slate-500">{formatDate(r.date)}</td><td>{r.supplier}</td><td className="font-data font-semibold">{r.sku}</td><td>{r.product}</td><td className="text-right font-data">{formatNumber(r.quantity)}</td><td className="text-right font-data">{formatRupiah(r.purchase_price)}</td><td className="text-right font-data font-semibold">{formatRupiah(r.total)}</td></tr>)}
                <tr className="bg-slate-50 font-semibold"><td colSpan={4}>Total</td><td className="text-right font-data">{formatNumber(data.total_quantity)}</td><td></td><td className="text-right font-data">{formatRupiah(data.total_value)}</td></tr></tbody>
            </>}
            {data.type === "stock-movement" && <>
              <thead><tr><th>Tanggal</th><th>SKU</th><th>Produk</th><th>Jenis</th><th className="text-right">Qty</th><th className="text-right">Saldo</th><th>Pengguna</th></tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}><td className="text-slate-500">{formatDate(r.date)}</td><td className="font-data font-semibold">{r.sku}</td><td>{r.product}</td><td><MovementBadge type={r.type} /></td><td className={`text-right font-data ${r.quantity < 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>{r.quantity > 0 ? "+" : ""}{formatNumber(r.quantity)}</td><td className="text-right font-data">{formatNumber(r.balance)}</td><td className="text-slate-500">{r.user}</td></tr>)}</tbody>
            </>}
            {data.type === "supplier-debt" && <>
              <thead><tr><th>Supplier</th><th>Referensi</th><th>Tanggal</th><th className="text-right">Total</th><th className="text-right">Terbayar</th><th className="text-right">Sisa</th><th>Status</th></tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}><td>{r.supplier}</td><td className="font-data">{r.reference}</td><td className="text-slate-500">{formatDate(r.date)}</td><td className="text-right font-data">{formatRupiah(r.amount_initial)}</td><td className="text-right font-data text-[#15803D]">{formatRupiah(r.amount_paid)}</td><td className="text-right font-data font-semibold">{formatRupiah(r.amount_remaining)}</td><td><DebtStatusBadge status={r.status} /></td></tr>)}
                <tr className="bg-slate-50 font-semibold"><td colSpan={5}>Total Sisa Hutang</td><td className="text-right font-data">{formatRupiah(data.total_remaining)}</td><td></td></tr></tbody>
            </>}
            {data.type === "consignment-settlement" && <>
              <thead><tr><th>Referensi</th><th>Supplier</th><th>SKU</th><th className="text-right">Masuk</th><th className="text-right">Stok Akhir</th><th className="text-right">Qty Keluar</th><th className="text-right">Harga</th><th className="text-right">Nilai</th><th>Status</th></tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}><td className="font-data">{r.reference}</td><td>{r.supplier}</td><td className="font-data font-semibold">{r.sku}</td><td className="text-right font-data">{formatNumber(r.stock_in_period)}</td><td className="text-right font-data">{formatNumber(r.closing_stock)}</td><td className="text-right font-data font-semibold">{formatNumber(r.qty_consumed)}</td><td className="text-right font-data">{formatRupiah(r.settlement_price)}</td><td className="text-right font-data font-semibold">{formatRupiah(r.settlement_value)}</td><td><DebtStatusBadge status={r.status} /></td></tr>)}
                <tr className="bg-slate-50 font-semibold"><td colSpan={7}>Total Nilai</td><td className="text-right font-data">{formatRupiah(data.total_value)}</td><td></td></tr></tbody>
            </>}
            {data.type === "low-stock" && <>
              <thead><tr><th>SKU</th><th>Produk</th><th>Kategori</th><th className="text-right">Stok</th><th className="text-right">Min</th><th>Status</th></tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}><td className="font-data font-semibold">{r.sku}</td><td>{r.product}</td><td>{r.type}</td><td className="text-right font-data">{formatNumber(r.current_stock)}</td><td className="text-right font-data">{formatNumber(r.minimum_stock)}</td><td><StatusBadge status={r.stock_status} /></td></tr>)}</tbody>
            </>}
          </table>
        </div>
      ))}
    </div>
  );
}
