import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { StatusBadge, MovementBadge, SupplierTypeBadge } from "@/components/StatusBadge";
import PhotoUpload from "@/components/PhotoUpload";
import { formatRupiah, formatNumber, formatDate, todayISO } from "@/lib/format";
import { toast } from "sonner";
import { PencilSimple, CurrencyDollar, TrayArrowDown, Plus, Trash, LinkSimple } from "@phosphor-icons/react";

export default function ProductDetailSheet({ productId, open, onClose, onChanged }) {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [product, setProduct] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [movements, setMovements] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [priceTarget, setPriceTarget] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [histFor, setHistFor] = useState(null);

  const load = useCallback(async () => {
    if (!productId) return;
    const [p, sup, mv] = await Promise.all([api.get(`/products/${productId}`), api.get(`/products/${productId}/suppliers`), api.get(`/products/${productId}/movements`)]);
    setProduct(p.data); setSuppliers(sup.data); setMovements(mv.data);
  }, [productId]);
  useEffect(() => { if (open && productId) load(); }, [open, productId, load]);

  const backend = process.env.REACT_APP_BACKEND_URL;
  const photo = product?.photo_url ? (product.photo_url.startsWith("http") ? product.photo_url : `${backend}${product.photo_url}`) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-auto p-0" data-testid="product-detail-sheet">
        <SheetHeader className="p-5 border-b border-slate-200">
          <SheetTitle className="font-data text-xl font-bold">{product?.sku || "Detail Produk"}</SheetTitle>
          <SheetDescription>{product?.name}</SheetDescription>
        </SheetHeader>
        {product && (
          <div className="p-5 space-y-5">
            <div className="flex items-start gap-4">
              {photo && <img src={photo} alt="foto" className="w-20 h-20 rounded-sm object-cover border border-slate-200" />}
              <div className="flex items-center gap-2">
                <StatusBadge status={product.stock_status} />
                {!product.is_active && <span className="text-[11px] font-bold uppercase bg-slate-200 text-slate-600 px-2 py-0.5 rounded-sm">Nonaktif</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="Kategori" value={product.type || "—"} />
              <Field label="Minimum Stock" value={formatNumber(product.minimum_stock)} mono />
              <Field label="Critical Stock" value={product.critical_stock != null ? formatNumber(product.critical_stock) : "50% min"} mono />
              <Field label="Stok Saat Ini" value={formatNumber(product.current_stock)} mono />
              <Field label="Harga Beli Terkini" value={formatRupiah(product.current_purchase_price)} mono />
              <Field label="Nilai Inventory" value={formatRupiah(product.current_inventory_value)} mono />
            </div>
            <div className="flex flex-wrap gap-2">
              {isAdmin && <Button variant="outline" size="sm" className="h-8 rounded-sm gap-1" onClick={() => setEditOpen(true)} data-testid="detail-edit-btn"><PencilSimple size={14} /> Edit</Button>}
              <Button variant="outline" size="sm" className="h-8 rounded-sm gap-1" onClick={() => nav(`/stock-in`)} data-testid="detail-stockin-btn"><TrayArrowDown size={14} /> Stock In</Button>
            </div>

            <Tabs defaultValue="suppliers">
              <TabsList className="rounded-sm"><TabsTrigger value="suppliers" className="rounded-sm" data-testid="tab-suppliers">Supplier & Harga</TabsTrigger><TabsTrigger value="movements" className="rounded-sm" data-testid="tab-movements">Riwayat Stok</TabsTrigger></TabsList>
              <TabsContent value="suppliers" className="mt-3 space-y-3">
                {isAdmin && <Button size="sm" variant="outline" className="h-8 rounded-sm gap-1" onClick={() => setLinkOpen(true)} data-testid="link-supplier-btn"><LinkSimple size={14} /> Hubungkan Supplier</Button>}
                <div className="border border-slate-200 rounded-sm overflow-hidden">
                  <table className="ims-table w-full">
                    <thead><tr><th>Supplier</th><th>Tipe</th><th className="text-right">Harga Terkini</th><th></th></tr></thead>
                    <tbody>
                      {suppliers.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-4">Belum ada supplier terhubung</td></tr>}
                      {suppliers.map((s) => (
                        <tr key={s.product_supplier_id} data-testid={`ps-row-${s.supplier_name}`}>
                          <td className="font-medium">{s.supplier_name}</td>
                          <td><SupplierTypeBadge type={s.supplier_type} /></td>
                          <td className="text-right font-data font-semibold">{s.current_price != null ? formatRupiah(s.current_price) : "—"}</td>
                          <td className="text-right">
                            <button className="text-xs text-slate-500 hover:text-slate-900 mr-2" onClick={() => setHistFor(s)} data-testid={`ps-history-${s.supplier_name}`}>Riwayat</button>
                            {isAdmin && <button className="text-xs text-slate-900 font-semibold hover:underline" onClick={() => setPriceTarget(s)} data-testid={`ps-price-${s.supplier_name}`}>Ubah Harga</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
              <TabsContent value="movements" className="mt-3">
                <div className="border border-slate-200 rounded-sm overflow-auto max-h-80">
                  <table className="ims-table w-full">
                    <thead><tr><th>Tanggal</th><th>Jenis</th><th className="text-right">Qty</th><th className="text-right">Saldo</th></tr></thead>
                    <tbody>
                      {movements.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-4">Belum ada mutasi</td></tr>}
                      {movements.map((m) => (
                        <tr key={m.id}><td className="text-slate-500">{formatDate(m.movement_date)}</td><td><MovementBadge type={m.movement_type} /></td>
                          <td className={`text-right font-data ${m.quantity < 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>{m.quantity > 0 ? "+" : ""}{formatNumber(m.quantity)}</td>
                          <td className="text-right font-data">{formatNumber(m.balance_after)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
        {product && <EditDialog open={editOpen} onClose={() => setEditOpen(false)} product={product} onSaved={() => { load(); onChanged?.(); }} />}
        {priceTarget && <PriceDialog open={!!priceTarget} onClose={() => setPriceTarget(null)} ps={priceTarget} onSaved={() => { load(); onChanged?.(); }} />}
        {product && <LinkSupplierDialog open={linkOpen} onClose={() => setLinkOpen(false)} productId={product.id} existing={suppliers} onSaved={() => { load(); onChanged?.(); }} />}
        {histFor && <HistoryDialog ps={histFor} onClose={() => setHistFor(null)} />}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }) {
  return <div><div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div><div className={`text-sm mt-0.5 ${mono ? "font-data font-semibold" : ""}`}>{value}</div></div>;
}

function EditDialog({ open, onClose, product, onSaved }) {
  const [form, setForm] = useState({});
  useEffect(() => { if (product) setForm({ name: product.name, type: product.type, minimum_stock: product.minimum_stock, critical_stock: product.critical_stock ?? "", photo_url: product.photo_url || "" }); }, [product, open]);
  const save = async () => {
    try {
      await api.patch(`/products/${product.id}`, { name: form.name, type: form.type, minimum_stock: parseInt(form.minimum_stock), critical_stock: form.critical_stock === "" ? null : parseInt(form.critical_stock), photo_url: form.photo_url });
      toast.success("SKU diperbarui"); onSaved(); onClose();
    } catch (e) { toast.error(apiError(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="edit-sku-dialog">
        <DialogHeader><DialogTitle>Edit SKU</DialogTitle><DialogDescription>Perbarui data master produk.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nama</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm" data-testid="edit-name-input" /></div>
          <div><Label>Kategori</Label><Input value={form.type || ""} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Minimum Stock</Label><Input type="number" value={form.minimum_stock ?? ""} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })} className="rounded-sm font-data" /></div>
            <div><Label>Critical Stock</Label><Input type="number" value={form.critical_stock} onChange={(e) => setForm({ ...form, critical_stock: e.target.value })} className="rounded-sm font-data" /></div>
          </div>
          <div><Label>Foto</Label><PhotoUpload value={form.photo_url} onChange={(url) => setForm({ ...form, photo_url: url })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} className="rounded-sm" data-testid="edit-save-btn">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({ open, onClose, ps, onSaved }) {
  const [price, setPrice] = useState("");
  const [eff, setEff] = useState(todayISO());
  useEffect(() => { if (open) { setPrice(""); setEff(todayISO()); } }, [open]);
  const save = async () => {
    if (!price || parseFloat(price) < 0) { toast.error("Isi harga valid"); return; }
    try { await api.post(`/product-suppliers/${ps.product_supplier_id}/price`, { price: parseFloat(price), effective_from: eff }); toast.success("Harga beli diperbarui"); onSaved(); onClose(); }
    catch (e) { toast.error(apiError(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="price-dialog">
        <DialogHeader><DialogTitle>Ubah Harga Beli — {ps.supplier_name}</DialogTitle><DialogDescription>Harga saat ini: {formatRupiah(ps.current_price)}. Ini menambah entri harga baru; harga transaksi lama tidak berubah.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Harga Baru (Rp)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-sm font-data" data-testid="price-input" /></div>
          <div><Label>Berlaku Mulai</Label><Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} className="rounded-sm" data-testid="price-effective-input" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} className="rounded-sm" data-testid="price-save-btn">Simpan Harga</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkSupplierDialog({ open, onClose, productId, existing, onSaved }) {
  const [all, setAll] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [price, setPrice] = useState("");
  const [eff, setEff] = useState(todayISO());
  useEffect(() => { if (open) { api.get("/suppliers", { params: { active: "active" } }).then(({ data }) => setAll(data)); setSupplierId(""); setPrice(""); } }, [open]);
  const linkedIds = new Set(existing.map((e) => e.supplier_id));
  const options = all.filter((s) => !linkedIds.has(s.id));
  const save = async () => {
    if (!supplierId) { toast.error("Pilih supplier"); return; }
    try { await api.post(`/products/${productId}/suppliers`, { supplier_id: supplierId, price: price ? parseFloat(price) : null, effective_from: eff }); toast.success("Supplier terhubung"); onSaved(); onClose(); }
    catch (e) { toast.error(apiError(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="link-supplier-dialog">
        <DialogHeader><DialogTitle>Hubungkan Supplier</DialogTitle><DialogDescription>Satu SKU dapat memiliki banyak supplier dengan harga masing-masing.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Supplier</Label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full h-10 rounded-sm border border-slate-200 px-2 text-sm" data-testid="link-supplier-select">
              <option value="">Pilih supplier</option>
              {options.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type === "consignment" ? "Titip Jual" : "Regular"})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Harga Beli Awal (opsional)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-sm font-data" data-testid="link-price-input" /></div>
            <div><Label>Berlaku Mulai</Label><Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} className="rounded-sm" /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} className="rounded-sm">Batal</Button><Button onClick={save} className="rounded-sm" data-testid="link-save-btn">Hubungkan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ ps, onClose }) {
  const [hist, setHist] = useState([]);
  useEffect(() => { api.get(`/product-suppliers/${ps.product_supplier_id}/price-history`).then(({ data }) => setHist(data)); }, [ps]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="price-history-dialog">
        <DialogHeader><DialogTitle>Riwayat Harga — {ps.supplier_name}</DialogTitle><DialogDescription>Semua perubahan harga beli tersimpan.</DialogDescription></DialogHeader>
        <div className="border border-slate-200 rounded-sm overflow-auto max-h-80">
          <table className="ims-table w-full"><thead><tr><th>Berlaku</th><th className="text-right">Harga</th><th>Oleh</th></tr></thead>
            <tbody>{hist.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-4">Belum ada</td></tr>}
              {hist.map((h) => <tr key={h.id}><td>{formatDate(h.effective_from)}</td><td className="text-right font-data font-semibold">{formatRupiah(h.price)}</td><td className="text-slate-500">{h.created_by_name}</td></tr>)}
            </tbody></table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
