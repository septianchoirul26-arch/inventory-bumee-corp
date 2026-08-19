import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CaretLeft, CaretRight, Tray } from "@phosphor-icons/react";

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
      <div>
        <h1 className="font-heading text-2xl lg:text-3xl font-black tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export function KpiCard({ label, value, sub, icon: Icon, accent, onClick, testid }) {
  return (
    <div
      data-testid={testid}
      onClick={onClick}
      className={cn(
        "border border-slate-200 rounded-sm p-4 bg-white",
        onClick && "cursor-pointer hover:border-slate-400 transition-colors duration-150"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        {Icon && <Icon size={16} className={accent || "text-slate-400"} />}
      </div>
      <div className={cn("font-heading text-2xl font-black mt-2 tracking-tight tabular-nums", accent || "text-slate-900")}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, message, icon: Icon = Tray }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
      <Icon size={40} className="text-slate-300 mb-3" />
      <h3 className="font-semibold text-slate-700">{title}</h3>
      {message && <p className="text-sm text-slate-400 mt-1 max-w-sm">{message}</p>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between px-1 py-3 text-sm text-slate-500">
      <span data-testid="pagination-info">{start}–{end} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pagination-prev">
          <CaretLeft size={14} />
        </Button>
        <span className="px-2 text-xs">Page {page} / {pages}</span>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="pagination-next">
          <CaretRight size={14} />
        </Button>
      </div>
    </div>
  );
}

export function Select({ value, onChange, options, className, testid, placeholder }) {
  return (
    <select
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-9 rounded-sm border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10", className)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Loading() {
  return <div className="py-12 text-center text-sm text-slate-400" data-testid="loading">Loading...</div>;
}
