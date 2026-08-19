import { cn } from "@/lib/utils";

const MAP = {
  safe: { label: "Aman", cls: "bg-[#DCFCE7] text-[#15803D]" },
  low: { label: "Stok Rendah", cls: "bg-[#FEF3C7] text-[#B45309]" },
  critical: { label: "Kritis", cls: "bg-[#FEE2E2] text-[#B91C1C]" },
};
export function StatusBadge({ status, className }) {
  const cfg = MAP[status] || { label: status, cls: "bg-slate-100 text-slate-600" };
  return <span data-testid={`status-badge-${status}`} className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", cfg.cls, className)}>{cfg.label}</span>;
}

const MOVEMENT_MAP = {
  STOCK_IN: { label: "Stok Masuk", cls: "bg-[#DCFCE7] text-[#15803D]" },
  STOCK_OUT: { label: "Stok Keluar", cls: "bg-[#FEE2E2] text-[#B91C1C]" },
  OPNAME_ADJUSTMENT: { label: "Penyesuaian Opname", cls: "bg-slate-100 text-slate-700" },
  MANUAL_ADJUSTMENT: { label: "Penyesuaian Manual", cls: "bg-blue-50 text-blue-700" },
};
export function MovementBadge({ type }) {
  const cfg = MOVEMENT_MAP[type] || { label: type, cls: "bg-slate-100 text-slate-600" };
  return <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold", cfg.cls)}>{cfg.label}</span>;
}

const OPNAME_STATUS = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  in_progress: { label: "Berjalan", cls: "bg-blue-50 text-blue-700" },
  completed: { label: "Selesai", cls: "bg-[#FEF3C7] text-[#B45309]" },
  finalized: { label: "Final", cls: "bg-[#DCFCE7] text-[#15803D]" },
};
export function OpnameStatusBadge({ status }) {
  const cfg = OPNAME_STATUS[status] || { label: status, cls: "bg-slate-100 text-slate-600" };
  return <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", cfg.cls)}>{cfg.label}</span>;
}

const DEBT_STATUS = {
  open: { label: "Belum Bayar", cls: "bg-[#FEE2E2] text-[#B91C1C]" },
  partial: { label: "Sebagian", cls: "bg-[#FEF3C7] text-[#B45309]" },
  paid: { label: "Lunas", cls: "bg-[#DCFCE7] text-[#15803D]" },
  void: { label: "Batal", cls: "bg-slate-100 text-slate-500" },
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  finalized: { label: "Final", cls: "bg-blue-50 text-blue-700" },
};
export function DebtStatusBadge({ status }) {
  const cfg = DEBT_STATUS[status] || { label: status, cls: "bg-slate-100 text-slate-600" };
  return <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", cfg.cls)}>{cfg.label}</span>;
}

export function SupplierTypeBadge({ type }) {
  const cfg = type === "consignment" ? { label: "Titip Jual", cls: "bg-purple-50 text-purple-700" } : { label: "Regular", cls: "bg-slate-100 text-slate-700" };
  return <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold", cfg.cls)}>{cfg.label}</span>;
}
