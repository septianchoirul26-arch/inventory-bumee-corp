import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  SquaresFour, Package, TrayArrowDown, ClipboardText, ClockCounterClockwise,
  ChartBar, Gear, MagnifyingGlass, SignOut, List, X, Users, Money, HandCoins, Sliders, Buildings,
} from "@phosphor-icons/react";

const NAV = [
  { type: "item", to: "/", label: "Dashboard", icon: SquaresFour, end: true },
  { type: "section", label: "Master Data" },
  { type: "item", to: "/produk", label: "Produk / SKU", icon: Package },
  { type: "item", to: "/supplier", label: "Supplier", icon: Buildings },
  { type: "section", label: "Inventory" },
  { type: "item", to: "/stock-in", label: "Stock In", icon: TrayArrowDown },
  { type: "item", to: "/stock-opname", label: "Stock Opname", icon: ClipboardText },
  { type: "item", to: "/adjustment", label: "Adjustment", icon: Sliders },
  { type: "item", to: "/history", label: "History", icon: ClockCounterClockwise },
  { type: "section", label: "Supplier" },
  { type: "item", to: "/hutang", label: "Hutang & Pembayaran", icon: Money },
  { type: "item", to: "/settlement", label: "Titip Jual / Settlement", icon: HandCoins },
  { type: "section", label: "Lainnya" },
  { type: "item", to: "/report", label: "Report", icon: ChartBar },
  { type: "item", to: "/pengaturan", label: "Pengaturan", icon: Gear },
];

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    if (!q) { setResults(null); return; }
    const t = setTimeout(async () => {
      try { const { data } = await api.get("/search", { params: { q } }); setResults(data); setOpen(true); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      <input data-testid="global-search-input" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results && setOpen(true)}
        placeholder="Cari SKU, produk, supplier..." className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400" />
      {open && results && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-sm shadow-lg max-h-96 overflow-auto">
          {results.products?.length === 0 && results.suppliers?.length === 0 && <div className="p-3 text-sm text-slate-500">Tidak ada hasil</div>}
          {results.products?.map((p) => (
            <button key={p.id} onClick={() => { setOpen(false); setQ(""); nav(`/produk?open=${p.id}`); }} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100">
              <div><div className="font-data text-[13px] font-semibold">{p.sku}</div><div className="text-xs text-slate-500">{p.name}</div></div>
              <div className="text-xs text-slate-400">Stok {formatNumber(p.current_stock)}</div>
            </button>
          ))}
          {results.suppliers?.map((s) => (
            <button key={s.id} onClick={() => { setOpen(false); setQ(""); nav(`/supplier`); }} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0">
              <Buildings size={14} className="text-slate-400" /><div className="text-sm">{s.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, settings } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="h-14 flex items-center px-5 border-b border-slate-200 shrink-0">
        {settings?.logo_url ? (
          <img src={settings.logo_url.startsWith("http") ? settings.logo_url : `${process.env.REACT_APP_BACKEND_URL}${settings.logo_url}`} alt="logo" className="w-7 h-7 rounded-sm object-cover mr-2" />
        ) : (
          <div className="w-7 h-7 bg-slate-900 rounded-sm flex items-center justify-center mr-2"><Package className="text-white" size={16} weight="bold" /></div>
        )}
        <div className="font-heading font-black text-slate-900 tracking-tight leading-none">{settings?.business_name || "Inventory"}
          <div className="text-[10px] font-sans font-medium text-slate-400 uppercase tracking-widest">Inventory & Purchasing</div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-auto">
        {NAV.map((n, i) => n.type === "section" ? (
          <div key={i} className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{n.label}</div>
        ) : (
          <NavLink key={n.to} to={n.to} end={n.end} data-testid={`nav-${n.to === "/" ? "dashboard" : n.to.slice(1)}`}
            className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors duration-150", isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
            <n.icon size={18} /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-slate-200 shrink-0">
        <div className="flex items-center gap-2 px-1 mb-2">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">{user?.name?.charAt(0)?.toUpperCase()}</div>
          <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{user?.name}</div><div className="text-[11px] text-slate-400 uppercase tracking-wide">{user?.role === "admin" ? "Administrator" : "Staff"}</div></div>
        </div>
        <button data-testid="logout-btn" onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 rounded-sm text-sm text-slate-600 hover:bg-slate-100"><SignOut size={16} /> Keluar</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <aside className="hidden lg:block fixed left-0 top-0 h-screen w-64 border-r border-slate-200 bg-slate-50">{sidebar}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-64 bg-slate-50 border-r border-slate-200 h-full">{sidebar}</div>
          <div className="flex-1 bg-black/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}
      <div className="lg:ml-64 flex flex-col min-h-screen">
        <header className="h-14 border-b border-slate-200 flex items-center gap-3 px-4 lg:px-6 bg-white sticky top-0 z-40">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} data-testid="mobile-menu-btn"><List size={22} /></button>
          <GlobalSearch />
          <div className="flex-1" />
          <span className="hidden sm:block text-xs text-slate-500">{settings?.currency || "Rp"} · {settings?.timezone}</span>
        </header>
        <main className="flex-1 p-4 lg:p-6 bg-white"><Outlet /></main>
      </div>
    </div>
  );
}
