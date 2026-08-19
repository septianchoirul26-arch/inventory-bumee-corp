import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { PageHeader, KpiCard, Loading, Select } from "@/components/common";
import { StatusBadge, MovementBadge } from "@/components/StatusBadge";
import { formatRupiah, formatNumber, formatDate, formatDateTime } from "@/lib/format";
import { getRange, RANGE_PRESETS } from "@/lib/ranges";
import { Package, Stack, CurrencyDollar, TrendUp, Warning, WarningCircle, Money, ShoppingCart } from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function Dashboard() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [rangeKey, setRangeKey] = useState("this_month");
  const [custom, setCustom] = useState({ from: "", to: "" });

  useEffect(() => {
    const r = rangeKey === "custom" && custom.from ? custom : getRange(rangeKey);
    api.get("/dashboard", { params: { date_from: r.from, date_to: r.to } }).then(({ data }) => setData(data));
  }, [rangeKey, custom]);

  if (!data) return <Loading />;
  const k = data.kpis;
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Ringkasan inventory dan aktivitas terkini">
        <Select testid="dashboard-range-select" value={rangeKey} onChange={setRangeKey} options={RANGE_PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
        {rangeKey === "custom" && (<>
          <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="dashboard-custom-from" />
          <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-9 rounded-sm border border-slate-200 px-2 text-sm" data-testid="dashboard-custom-to" />
        </>)}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard testid="kpi-total-sku" label="SKU Aktif" value={formatNumber(k.total_sku)} icon={Package} onClick={() => nav("/produk")} />
        <KpiCard testid="kpi-total-stock" label="Total Stok" value={formatNumber(k.total_stock)} icon={Stack} />
        <KpiCard testid="kpi-inventory-value" label="Nilai Inventory" value={formatRupiah(k.inventory_value)} icon={CurrencyDollar} sub="stok × harga terkini" />
        <KpiCard testid="kpi-outstanding-debt" label="Hutang Outstanding" value={formatRupiah(k.outstanding_debt)} icon={Money} accent="text-[#B91C1C]" onClick={() => nav("/hutang")} />
        <KpiCard testid="kpi-stock-in-today" label="Stok Masuk Hari Ini" value={formatNumber(k.stock_in_today)} icon={TrendUp} accent="text-[#15803D]" />
        <KpiCard testid="kpi-purchase-value" label="Nilai Pembelian" value={formatRupiah(k.purchase_value)} icon={ShoppingCart} />
        <KpiCard testid="kpi-low-stock" label="Stok Rendah" value={formatNumber(k.low_stock)} icon={Warning} accent="text-[#B45309]" onClick={() => nav("/produk?filter=low")} />
        <KpiCard testid="kpi-critical-stock" label="Stok Kritis" value={formatNumber(k.critical_stock)} icon={WarningCircle} accent="text-[#B91C1C]" onClick={() => nav("/produk?filter=critical")} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 border border-slate-200 rounded-sm p-4">
          <h2 className="font-heading text-lg font-bold mb-3">Pergerakan Stok</h2>
          {data.chart.length === 0 ? <div className="h-72 flex items-center justify-center text-sm text-slate-400">Tidak ada pergerakan pada periode ini</div> : (
            <ResponsiveContainer width="100%" height={288}>
              <BarChart data={data.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => formatDate(d).slice(0, 6)} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 4, border: "1px solid #e2e8f0" }} labelFormatter={(d) => formatDate(d)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="stock_in" name="Stok Masuk" fill="#15803D" radius={[2, 2, 0, 0]} />
                <Bar dataKey="stock_out" name="Stok Keluar" fill="#B91C1C" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="border border-slate-200 rounded-sm p-4">
          <div className="flex items-center justify-between mb-3"><h2 className="font-heading text-lg font-bold">Peringatan Stok Rendah</h2><button className="text-xs text-slate-500 hover:text-slate-900" onClick={() => nav("/produk?filter=low")}>Lihat semua</button></div>
          {data.alerts.length === 0 ? <div className="text-sm text-slate-400 py-8 text-center">Semua stok aman</div> : (
            <div className="space-y-2 max-h-72 overflow-auto">
              {data.alerts.map((a) => (
                <button key={a.id} data-testid={`alert-${a.sku}`} onClick={() => nav(`/produk?open=${a.id}`)} className="w-full flex items-center justify-between p-2 rounded-sm hover:bg-slate-50 text-left border border-slate-100">
                  <div className="min-w-0"><div className="font-data text-[13px] font-semibold">{a.sku}</div><div className="text-xs text-slate-500 truncate">{a.name}</div></div>
                  <div className="text-right shrink-0 ml-2"><div className="font-data text-[13px] font-semibold">{formatNumber(a.current_stock)} / {formatNumber(a.minimum_stock)}</div><StatusBadge status={a.stock_status} /></div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border border-slate-200 rounded-sm mt-4">
        <h2 className="font-heading text-lg font-bold p-4 pb-2">Aktivitas Terkini</h2>
        <div className="overflow-auto">
          <table className="ims-table w-full">
            <thead><tr><th>Tanggal / Waktu</th><th>SKU</th><th>Produk</th><th>Jenis</th><th className="text-right">Qty</th><th className="text-right">Saldo</th><th>Pengguna</th></tr></thead>
            <tbody>
              {data.recent_activity.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-6">Belum ada aktivitas</td></tr>}
              {data.recent_activity.map((r) => (
                <tr key={r.id}>
                  <td className="text-slate-500">{formatDateTime(r.created_at)}</td>
                  <td className="font-data font-semibold">{r.sku}</td><td>{r.product_name}</td>
                  <td><MovementBadge type={r.movement_type} /></td>
                  <td className={`text-right font-data font-semibold ${r.quantity < 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>{r.quantity > 0 ? "+" : ""}{formatNumber(r.quantity)}</td>
                  <td className="text-right font-data">{formatNumber(r.balance_after)}</td><td className="text-slate-500">{r.created_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
