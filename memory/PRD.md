# PRD — Sistem Inventory & Purchasing (Bumee Corp)

## Ringkasan
Aplikasi internal, desktop-first, Bahasa Indonesia, Rupiah, Asia/Jakarta. Inventory + Purchasing supplier (BUKAN penjualan). Stack: FastAPI + MongoDB (motor) + React + Tailwind/shadcn. Auth JWT (admin/staff). Object storage Emergent untuk foto.

## Admin
admin@bumeecorp.com / bumeebola2023 (lihat /app/memory/test_credentials.md)

## Model Data
users, products (soft delete, primary_supplier_id, photo_url, critical_stock), suppliers (regular/consignment), product_suppliers (M2M), price_history (per product_supplier + effective_from), stock_in_transactions/items, inventory_movements (ledger immutable: STOCK_IN/STOCK_OUT/OPNAME_ADJUSTMENT/MANUAL_ADJUSTMENT + balance_before/after), opname_daily (+items via movements), stock_opnames/items (sesi lama, masih ada), payables (source: stock_in/settlement/consignment_opname), payments, settlements/items, audit_logs.

## Sudah Diimplementasikan
- Auth JWT + brute-force lockout, login show/hide password.
- Migrasi v2 idempotent: backfill supplier dari field teks lama, link M2M, pindah price history, backfill snapshot stock-in.
- Produk: CRUD, soft delete, foto (object storage), kategori, min/critical stock, **supplier WAJIB saat buat SKU**. Filter per supplier/kategori/status.
- Supplier: CRUD regular/consignment, aktif/nonaktif, jumlah SKU + hutang outstanding.
- Relasi produk↔supplier M2M + price history per pasangan (harga efektif <= tanggal).
- Stock In per supplier (hanya SKU terhubung, 50/halaman, search, pagination, keranjang, harga snapshot, harga manual bila tak ada). Regular→hutang otomatis; consignment→tanpa hutang.
- **Stock Opname harian (baru)**: pilih supplier+tanggal, tabel SKU/PRODUK/TOTAL QTY/STOK/STOK KELUAR. Stok keluar = Total Qty − Stok fisik. Update stok terkini → dashboard ikut update. **Consignment: stok keluar otomatis jadi hutang (bisa dicicil).**
- Adjustment manual (delta/set), tolak stok negatif.
- Hutang & Pembayaran: daftar + cicilan per invoice + **Pembayaran Massal FIFO** (invoice terlama dulu, tolak overpayment).
- Settlement titip jual (manual, draft→validasi→finalize→hutang, cegah overlap) — tetap tersedia; jalur utama kini via opname consignment.
- History (Mutasi + Audit), Report (Inventory, Pembelian, Stok Keluar/Mutasi, Supplier Hutang, Consignment Settlement, Low Stock) + export CSV.
- Settings: Umum (logo, tema), Inventory, Pengguna (RBAC), Data (export). Dashboard KPI + chart + alert + aktivitas.

## Verifikasi
- /app/scripts/acceptance_test.py, flow_test.py, new_features_test.py → semua PASS.
- Keterbatasan: MongoDB standalone (tanpa multi-doc transaction penuh); penulisan berurutan, konsistensi hasil akhir tervalidasi.

## Backlog / Berikutnya
- P1: Impor massal Stock In per supplier (paste/Excel).
- P2: Notifikasi low stock; laporan PDF; role staff granular per menu.
