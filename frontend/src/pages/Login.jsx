import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Warning, Eye, EyeSlash } from "@phosphor-icons/react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try { await login(email, password); nav("/"); }
    catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-slate-900 p-12 text-white">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-white rounded-sm flex items-center justify-center"><Package className="text-slate-900" size={20} weight="bold" /></div>
          <span className="font-heading font-black text-lg">Sistem Inventory</span>
        </div>
        <div>
          <h1 className="font-heading text-4xl font-black tracking-tight leading-tight mb-4">Inventory presisi,<br />pembelian terkontrol.</h1>
          <p className="text-slate-400 text-sm max-w-md leading-relaxed">Kelola ribuan SKU, stock in dengan harga historis per supplier, opname, hutang supplier, dan settlement titip jual — dalam satu sistem.</p>
        </div>
        <div className="text-xs text-slate-500 font-data">Stock In · Opname · Hutang · Settlement · Report</div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="w-9 h-9 bg-slate-900 rounded-sm flex items-center justify-center"><Package className="text-white" size={20} weight="bold" /></div>
            <span className="font-heading font-black text-lg">Sistem Inventory</span>
          </div>
          <div><h2 className="font-heading text-2xl font-bold tracking-tight">Masuk</h2><p className="text-sm text-slate-500 mt-1">Masukkan kredensial administrator atau staff.</p></div>
          {error && <div className="flex items-start gap-2 bg-[#FEE2E2] text-[#B91C1C] text-sm rounded-sm px-3 py-2" data-testid="login-error"><Warning size={16} className="mt-0.5 shrink-0" /> {error}</div>}
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Email</label>
            <Input data-testid="login-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-10 rounded-sm" placeholder="anda@perusahaan.com" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Kata Sandi</label>
            <div className="relative">
              <Input data-testid="login-password-input" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required className="h-10 rounded-sm pr-10" placeholder="••••••••" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" data-testid="toggle-password">{show ? <EyeSlash size={18} /> : <Eye size={18} />}</button>
            </div>
          </div>
          <Button data-testid="login-submit-btn" type="submit" disabled={loading} className="w-full h-10 rounded-sm">{loading ? "Memproses..." : "Masuk"}</Button>
        </form>
      </div>
    </div>
  );
}
