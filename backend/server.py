from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Query, Header, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
import uuid
import logging
import io
import requests
import pandas as pd

from auth import (
    hash_password, verify_password, create_access_token, decode_token, _extract_token,
)

JKT = ZoneInfo("Asia/Jakarta")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Sistem Inventory & Purchasing")
api = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ims")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

def today_jkt() -> str:
    return datetime.now(JKT).date().isoformat()


# ---------------------------------------------------------------------------
# Object storage (Emergent)
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "bumee-inventory"
_storage_key = None

def init_storage(force=False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key

def put_object(path, data, content_type):
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()

def get_object(path):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Belum login")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token tidak valid")
    except Exception:
        raise HTTPException(status_code=401, detail="Token tidak valid atau kedaluwarsa")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Pengguna tidak ditemukan")
    return user

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Butuh akses administrator")
    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Literal["admin", "staff"] = "staff"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["admin", "staff"]] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None

class SupplierCreate(BaseModel):
    name: str
    contact: str = ""
    address: str = ""
    notes: str = ""
    type: Literal["regular", "consignment"] = "regular"

class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    type: Optional[Literal["regular", "consignment"]] = None

class ProductCreate(BaseModel):
    sku: str
    name: str
    type: str = ""
    photo_url: str = ""
    minimum_stock: int = Field(0, ge=0)
    critical_stock: Optional[int] = Field(None, ge=0)
    supplier_id: str
    price: Optional[float] = Field(None, ge=0)
    price_effective_from: Optional[str] = None

class OpnameDailyItem(BaseModel):
    product_id: str
    physical_stock: int = Field(..., ge=0)

class OpnameDailyCreate(BaseModel):
    supplier_id: str
    opname_date: str
    note: str = ""
    items: List[OpnameDailyItem]

class BulkPaymentRow(BaseModel):
    supplier_id: str
    amount: float = Field(..., gt=0)
    payment_date: str
    note: str = ""

class BulkPaymentCreate(BaseModel):
    payments: List[BulkPaymentRow]

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    photo_url: Optional[str] = None
    minimum_stock: Optional[int] = Field(None, ge=0)
    critical_stock: Optional[int] = Field(None, ge=0)

class LinkSupplier(BaseModel):
    supplier_id: str
    price: Optional[float] = Field(None, ge=0)
    effective_from: Optional[str] = None

class PriceUpdate(BaseModel):
    price: float = Field(..., ge=0)
    effective_from: str

class StockInItem(BaseModel):
    product_id: str
    quantity: int = Field(..., gt=0)
    manual_price: Optional[float] = Field(None, ge=0)

class StockInCreate(BaseModel):
    transaction_date: str
    supplier_id: str
    note: str = ""
    items: List[StockInItem]

class OpnameCreate(BaseModel):
    opname_date: str
    snapshot_time: str = "08:00"
    note: str = ""

class OpnameCountItem(BaseModel):
    product_id: str
    physical_stock: Optional[int] = Field(None, ge=0)

class OpnameSaveCounts(BaseModel):
    counts: List[OpnameCountItem]

class OpnameFinalize(BaseModel):
    override_incomplete: bool = False

class AdjustmentCreate(BaseModel):
    product_id: str
    mode: Literal["delta", "set"] = "delta"
    value: int
    reason: str = ""

class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    payment_date: str
    note: str = ""

class SettlementCreate(BaseModel):
    supplier_id: str
    period_start: str
    period_end: str
    note: str = ""

class SettlementItemUpdate(BaseModel):
    product_id: str
    closing_stock: Optional[int] = Field(None, ge=0)
    settlement_price: Optional[float] = Field(None, ge=0)
    validated: Optional[bool] = None

class SettlementSave(BaseModel):
    items: List[SettlementItemUpdate]

class SettingsUpdate(BaseModel):
    business_name: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    date_format: Optional[str] = None
    default_minimum_stock: Optional[int] = Field(None, ge=0)
    critical_threshold_percent: Optional[int] = Field(None, ge=0)
    allow_negative_stock: Optional[bool] = None
    require_opname_confirmation: Optional[bool] = None
    logo_url: Optional[str] = None
    theme: Optional[str] = None


# ---------------------------------------------------------------------------
# Settings / audit / stock helpers
# ---------------------------------------------------------------------------
DEFAULT_SETTINGS = {
    "business_name": "Bumee Corp", "currency": "Rp", "timezone": "Asia/Jakarta",
    "date_format": "DD MMM YYYY", "default_minimum_stock": 10, "critical_threshold_percent": 50,
    "allow_negative_stock": False, "require_opname_confirmation": True, "logo_url": "", "theme": "light",
}

async def get_settings() -> dict:
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        doc = {"id": "global", **DEFAULT_SETTINGS}
        await db.settings.insert_one(dict(doc))
    return {**DEFAULT_SETTINGS, **doc}

async def log_audit(user, action, entity_type="", entity_id="", reference="", before=None, after=None):
    await db.audit_logs.insert_one({
        "id": new_id(), "user_id": user.get("id") if user else None,
        "user_name": user.get("name") if user else "system", "action": action,
        "entity_type": entity_type, "entity_id": entity_id, "reference": reference,
        "before_value": before, "after_value": after, "created_at": now_iso(),
    })

async def stock_map(product_ids=None) -> dict:
    match = {"product_id": {"$in": product_ids}} if product_ids is not None else {}
    pipeline = ([{"$match": match}] if match else []) + [{"$group": {"_id": "$product_id", "qty": {"$sum": "$quantity"}}}]
    return {r["_id"]: r["qty"] async for r in db.inventory_movements.aggregate(pipeline)}

async def current_stock(product_id) -> int:
    async for r in db.inventory_movements.aggregate([{"$match": {"product_id": product_id}}, {"$group": {"_id": None, "qty": {"$sum": "$quantity"}}}]):
        return r["qty"]
    return 0

async def stock_before(product_id, date_str) -> int:
    async for r in db.inventory_movements.aggregate([{"$match": {"product_id": product_id, "movement_date": {"$lt": date_str}}}, {"$group": {"_id": None, "qty": {"$sum": "$quantity"}}}]):
        return r["qty"]
    return 0

async def price_for_ps(ps_id, on_date) -> Optional[float]:
    docs = await db.price_history.find({"product_supplier_id": ps_id, "effective_from": {"$lte": on_date}}, {"_id": 0}).sort("effective_from", -1).to_list(1)
    return docs[0]["price"] if docs else None

async def latest_price_product(product_id) -> Optional[float]:
    docs = await db.price_history.find({"product_id": product_id}, {"_id": 0}).sort([("effective_from", -1), ("created_at", -1)]).to_list(1)
    return docs[0]["price"] if docs else None

async def insert_movement(product_id, movement_type, quantity, reference_type, reference_id, movement_date, user, extra=None):
    before = await current_stock(product_id)
    mv = {
        "id": new_id(), "product_id": product_id, "movement_type": movement_type,
        "quantity": quantity, "qty_in": max(quantity, 0), "qty_out": max(-quantity, 0),
        "balance_before": before, "balance_after": before + quantity,
        "reference_type": reference_type, "reference_id": reference_id, "movement_date": movement_date,
        "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "system",
        "created_at": now_iso(),
    }
    if extra:
        mv.update(extra)
    await db.inventory_movements.insert_one(dict(mv))
    return mv

def stock_status(stock, minimum, critical_pct, critical_abs=None):
    crit = critical_abs if critical_abs not in (None, 0) else (minimum * critical_pct / 100.0 if minimum > 0 else 0)
    if minimum <= 0 and not crit:
        return "safe"
    if stock <= crit:
        return "critical"
    if stock <= minimum:
        return "low"
    return "safe"

async def product_public(prod, stock=None, settings=None, price=None):
    if settings is None:
        settings = await get_settings()
    if stock is None:
        stock = await current_stock(prod["id"])
    if price is None:
        price = await latest_price_product(prod["id"])
        if price is None:
            price = prod.get("current_purchase_price", 0) or 0
    status = stock_status(stock, prod.get("minimum_stock", 0), settings["critical_threshold_percent"], prod.get("critical_stock"))
    return {
        **{k: v for k, v in prod.items() if k != "_id"},
        "current_stock": stock, "current_purchase_price": price,
        "current_inventory_value": stock * (price or 0), "stock_status": status,
    }


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api.post("/auth/login")
async def login(body: LoginBody, request: Request):
    email = body.email.lower()
    ip = request.client.host if request.client else "unknown"
    ident = f"{ip}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= 5 and att.get("locked_until", "") > now_iso():
        raise HTTPException(status_code=429, detail="Terlalu banyak percobaan. Coba lagi dalam beberapa menit.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        from datetime import timedelta
        newc = (att.get("count", 0) if att else 0) + 1
        await db.login_attempts.update_one({"identifier": ident}, {"$set": {"count": newc, "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat() if newc >= 5 else ""}}, upsert=True)
        raise HTTPException(status_code=401, detail="Email atau kata sandi salah")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")
    await db.login_attempts.delete_one({"identifier": ident})
    token = create_access_token(user["id"], user["email"], user["role"])
    safe = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return {"user": safe, "access_token": token}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

@api.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)):
    return {"ok": True}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@api.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(1000)

@api.post("/users")
async def create_user(body: UserCreate, user: dict = Depends(require_admin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {"id": new_id(), "email": email, "password_hash": hash_password(body.password), "name": body.name, "role": body.role, "is_active": True, "created_at": now_iso()}
    await db.users.insert_one(dict(doc))
    await log_audit(user, "buat_pengguna", "user", doc["id"], email)
    return {k: v for k, v in doc.items() if k != "password_hash"}

@api.patch("/users/{uid}")
async def update_user(uid: str, body: UserUpdate, user: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    updates = {}
    for k in ("name", "role", "is_active"):
        v = getattr(body, k)
        if v is not None:
            updates[k] = v
    if body.password:
        updates["password_hash"] = hash_password(body.password)
    if updates:
        await db.users.update_one({"id": uid}, {"$set": updates})
        await log_audit(user, "ubah_pengguna", "user", uid, target["email"])
    return await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})

@api.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_admin)):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri")
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    await db.users.delete_one({"id": uid})
    await log_audit(user, "hapus_pengguna", "user", uid, target["email"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Photo upload / serve
# ---------------------------------------------------------------------------
@api.post("/upload-photo")
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "img.png").split(".")[-1].lower()
    ct = MIME.get(ext, file.content_type or "application/octet-stream")
    path = f"{APP_NAME}/uploads/{user['id']}/{new_id()}.{ext}"
    data = await file.read()
    result = put_object(path, data, ct)
    doc = {"id": new_id(), "storage_path": result["path"], "original_filename": file.filename, "content_type": ct, "size": result.get("size"), "is_deleted": False, "created_at": now_iso()}
    await db.files.insert_one(dict(doc))
    backend = os.environ.get("REACT_APP_BACKEND_URL", "")
    return {"url": f"/api/files/{result['path']}", "path": result["path"]}

@api.get("/files/{path:path}")
async def serve_file(path: str):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File tidak ditemukan")
    data, ct = get_object(path)
    return Response(content=data, media_type=record.get("content_type", ct))


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------
@api.get("/suppliers")
async def list_suppliers(search: str = "", type: str = "", active: str = "", user: dict = Depends(get_current_user)):
    q = {"is_deleted": {"$ne": True}}
    if search:
        q["name"] = {"$regex": search, "$options": "i"}
    if type:
        q["type"] = type
    if active == "active":
        q["is_active"] = True
    elif active == "inactive":
        q["is_active"] = False
    docs = await db.suppliers.find(q, {"_id": 0}).sort("name", 1).to_list(100000)
    # count linked products
    for s in docs:
        s["product_count"] = await db.product_suppliers.count_documents({"supplier_id": s["id"], "is_active": True})
        payables = await db.payables.aggregate([{"$match": {"supplier_id": s["id"], "status": {"$in": ["open", "partial"]}}}, {"$group": {"_id": None, "amt": {"$sum": "$amount_remaining"}}}]).to_list(1)
        s["outstanding_debt"] = payables[0]["amt"] if payables else 0
    return docs

@api.post("/suppliers")
async def create_supplier(body: SupplierCreate, user: dict = Depends(require_admin)):
    doc = {"id": new_id(), **body.model_dump(), "is_active": True, "is_deleted": False, "created_at": now_iso(), "updated_at": now_iso()}
    await db.suppliers.insert_one(dict(doc))
    await log_audit(user, "buat_supplier", "supplier", doc["id"], body.name)
    return doc

@api.get("/suppliers/{sid}")
async def get_supplier(sid: str, user: dict = Depends(get_current_user)):
    s = await db.suppliers.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    return s

@api.patch("/suppliers/{sid}")
async def update_supplier(sid: str, body: SupplierUpdate, user: dict = Depends(require_admin)):
    s = await db.suppliers.find_one({"id": sid})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        updates["updated_at"] = now_iso()
        await db.suppliers.update_one({"id": sid}, {"$set": updates})
        await log_audit(user, "ubah_supplier", "supplier", sid, s["name"])
    return await db.suppliers.find_one({"id": sid}, {"_id": 0})

@api.post("/suppliers/{sid}/deactivate")
async def deactivate_supplier(sid: str, user: dict = Depends(require_admin)):
    await db.suppliers.update_one({"id": sid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await log_audit(user, "nonaktif_supplier", "supplier", sid)
    return {"ok": True}

@api.post("/suppliers/{sid}/activate")
async def activate_supplier(sid: str, user: dict = Depends(require_admin)):
    await db.suppliers.update_one({"id": sid}, {"$set": {"is_active": True, "updated_at": now_iso()}})
    return {"ok": True}

@api.get("/suppliers/{sid}/products")
async def supplier_products(sid: str, user: dict = Depends(get_current_user)):
    links = await db.product_suppliers.find({"supplier_id": sid, "is_active": True}, {"_id": 0}).to_list(100000)
    pids = [l["product_id"] for l in links]
    prods = await db.products.find({"id": {"$in": pids}}, {"_id": 0}).to_list(100000)
    pmap = {p["id"]: p for p in prods}
    out = []
    for l in links:
        p = pmap.get(l["product_id"])
        if p:
            out.append({"product_supplier_id": l["id"], "product_id": p["id"], "sku": p["sku"], "name": p["name"]})
    return out


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------
@api.get("/products/summary")
async def products_summary(user: dict = Depends(get_current_user)):
    settings = await get_settings()
    prods = await db.products.find({"is_deleted": {"$ne": True}}, {"_id": 0}).to_list(100000)
    smap = await stock_map()
    total = len(prods)
    active = sum(1 for p in prods if p.get("is_active", True))
    low = critical = 0
    for p in prods:
        if not p.get("is_active", True):
            continue
        st = stock_status(smap.get(p["id"], 0), p.get("minimum_stock", 0), settings["critical_threshold_percent"], p.get("critical_stock"))
        if st == "critical":
            critical += 1
        elif st == "low":
            low += 1
    return {"total_sku": total, "active_sku": active, "low_stock": low, "critical_stock": critical}

@api.get("/products/filters")
async def products_filters(user: dict = Depends(get_current_user)):
    types = await db.products.distinct("type", {"is_deleted": {"$ne": True}})
    suppliers = await db.suppliers.find({"is_deleted": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(100000)
    return {"types": sorted([t for t in types if t]), "suppliers": suppliers}

@api.get("/products")
async def list_products(search: str = "", type: str = "", supplier_id: str = "", stock_status_filter: str = "", active: str = "", sort: str = "sku", order: str = "asc", page: int = 1, page_size: int = 25, user: dict = Depends(get_current_user)):
    settings = await get_settings()
    q = {"is_deleted": {"$ne": True}}
    if search:
        q["$or"] = [{"sku": {"$regex": search, "$options": "i"}}, {"name": {"$regex": search, "$options": "i"}}]
    if type:
        q["type"] = type
    if active == "active":
        q["is_active"] = True
    elif active == "inactive":
        q["is_active"] = False
    if supplier_id:
        links = await db.product_suppliers.find({"supplier_id": supplier_id, "is_active": True}, {"_id": 0, "product_id": 1}).to_list(100000)
        q["id"] = {"$in": [l["product_id"] for l in links]}
    matched = await db.products.find(q, {"_id": 0}).to_list(100000)
    smap = await stock_map([p["id"] for p in matched] or None)
    prices = {}
    for p in matched:
        pr = await latest_price_product(p["id"])
        prices[p["id"]] = pr if pr is not None else (p.get("current_purchase_price", 0) or 0)
    enriched = []
    for p in matched:
        s = smap.get(p["id"], 0)
        st = stock_status(s, p.get("minimum_stock", 0), settings["critical_threshold_percent"], p.get("critical_stock"))
        enriched.append({**p, "current_stock": s, "current_purchase_price": prices[p["id"]], "current_inventory_value": s * prices[p["id"]], "stock_status": st})
    if stock_status_filter in ("safe", "low", "critical"):
        enriched = [e for e in enriched if e["stock_status"] == stock_status_filter]
    key = {"sku": "sku", "name": "name", "stock": "current_stock", "price": "current_purchase_price", "updated": "updated_at"}.get(sort, "sku")
    enriched.sort(key=lambda x: (x.get(key) is None, x.get(key)), reverse=(order == "desc"))
    total = len(enriched)
    start = (page - 1) * page_size
    return {"items": enriched[start:start + page_size], "total": total, "page": page, "page_size": page_size}

@api.post("/products")
async def create_product(body: ProductCreate, user: dict = Depends(require_admin)):
    if await db.products.find_one({"sku": body.sku, "is_deleted": {"$ne": True}}):
        raise HTTPException(status_code=400, detail=f"SKU {body.sku} sudah ada")
    sup = await db.suppliers.find_one({"id": body.supplier_id})
    if not sup:
        raise HTTPException(status_code=400, detail="Supplier wajib dipilih dan harus valid")
    doc = {"id": new_id(), "sku": body.sku.strip(), "name": body.name.strip(), "type": body.type.strip(), "photo_url": body.photo_url, "minimum_stock": body.minimum_stock, "critical_stock": body.critical_stock, "current_purchase_price": body.price or 0, "primary_supplier_id": body.supplier_id, "is_active": True, "is_deleted": False, "created_at": now_iso(), "updated_at": now_iso()}
    await db.products.insert_one(dict(doc))
    ps_id = new_id()
    await db.product_suppliers.insert_one({"id": ps_id, "product_id": doc["id"], "supplier_id": body.supplier_id, "is_active": True, "created_at": now_iso()})
    if body.price and body.price > 0:
        await db.price_history.insert_one({"id": new_id(), "product_supplier_id": ps_id, "product_id": doc["id"], "supplier_id": body.supplier_id, "effective_from": body.price_effective_from or today_jkt(), "price": body.price, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()})
    await log_audit(user, "buat_sku", "product", doc["id"], doc["sku"])
    return await product_public(doc)

@api.get("/products/{pid}")
async def get_product(pid: str, user: dict = Depends(get_current_user)):
    prod = await db.products.find_one({"id": pid}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    return await product_public(prod)

@api.patch("/products/{pid}")
async def update_product(pid: str, body: ProductUpdate, user: dict = Depends(require_admin)):
    prod = await db.products.find_one({"id": pid}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        updates["updated_at"] = now_iso()
        await db.products.update_one({"id": pid}, {"$set": updates})
        await log_audit(user, "ubah_sku", "product", pid, prod["sku"], before={k: prod.get(k) for k in updates}, after=updates)
    return await product_public(await db.products.find_one({"id": pid}, {"_id": 0}))

@api.post("/products/{pid}/deactivate")
async def deactivate_product(pid: str, user: dict = Depends(require_admin)):
    prod = await db.products.find_one({"id": pid})
    if not prod:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.update_one({"id": pid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await log_audit(user, "nonaktif_sku", "product", pid, prod["sku"])
    return {"ok": True}

@api.post("/products/{pid}/activate")
async def activate_product(pid: str, user: dict = Depends(require_admin)):
    prod = await db.products.find_one({"id": pid})
    if not prod:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.update_one({"id": pid}, {"$set": {"is_active": True, "updated_at": now_iso()}})
    return {"ok": True}

@api.post("/products/bulk-delete")
async def bulk_delete_products(body: dict, user: dict = Depends(require_admin)):
    ids = body.get("ids", [])
    for pid in ids:
        await db.products.delete_one({"id": pid})
        await db.product_suppliers.delete_many({"product_id": pid})
        await db.price_history.delete_many({"product_id": pid})
        await db.inventory_movements.delete_many({"product_id": pid})
        await db.stock_in_items.delete_many({"product_id": pid})
        await db.settlement_items.delete_many({"product_id": pid})
        await db.stock_opname_items.delete_many({"product_id": pid})
    await log_audit(user, "hapus_produk_massal", "product", "", f"{len(ids)} produk dihapus")
    return {"deleted": len(ids)}

@api.post("/suppliers/bulk-delete")
async def bulk_delete_suppliers(body: dict, user: dict = Depends(require_admin)):
    ids = body.get("ids", [])
    for sid in ids:
        await db.suppliers.delete_one({"id": sid})
        await db.product_suppliers.delete_many({"supplier_id": sid})
        await db.price_history.delete_many({"supplier_id": sid})
        await db.payables.delete_many({"supplier_id": sid})
        await db.payments.delete_many({"supplier_id": sid})
        stls = await db.settlements.find({"supplier_id": sid}, {"_id": 0, "id": 1}).to_list(100000)
        await db.settlements.delete_many({"supplier_id": sid})
        for st in stls:
            await db.settlement_items.delete_many({"settlement_id": st["id"]})
    await log_audit(user, "hapus_supplier_massal", "supplier", "", f"{len(ids)} supplier dihapus")
    return {"deleted": len(ids)}

@api.get("/products/{pid}/suppliers")
async def product_suppliers(pid: str, user: dict = Depends(get_current_user)):
    links = await db.product_suppliers.find({"product_id": pid, "is_active": True}, {"_id": 0}).to_list(1000)
    out = []
    for l in links:
        s = await db.suppliers.find_one({"id": l["supplier_id"]}, {"_id": 0})
        if not s:
            continue
        price = await latest_price_product_supplier(l["id"])
        out.append({"product_supplier_id": l["id"], "supplier_id": s["id"], "supplier_name": s["name"], "supplier_type": s["type"], "current_price": price})
    return out

async def latest_price_product_supplier(ps_id):
    docs = await db.price_history.find({"product_supplier_id": ps_id}, {"_id": 0}).sort([("effective_from", -1), ("created_at", -1)]).to_list(1)
    return docs[0]["price"] if docs else None

@api.post("/products/{pid}/suppliers")
async def link_supplier(pid: str, body: LinkSupplier, user: dict = Depends(require_admin)):
    prod = await db.products.find_one({"id": pid})
    sup = await db.suppliers.find_one({"id": body.supplier_id})
    if not prod or not sup:
        raise HTTPException(status_code=404, detail="Produk atau supplier tidak ditemukan")
    existing = await db.product_suppliers.find_one({"product_id": pid, "supplier_id": body.supplier_id})
    if existing:
        if not existing.get("is_active", True):
            await db.product_suppliers.update_one({"id": existing["id"]}, {"$set": {"is_active": True}})
        ps_id = existing["id"]
    else:
        ps = {"id": new_id(), "product_id": pid, "supplier_id": body.supplier_id, "is_active": True, "created_at": now_iso()}
        await db.product_suppliers.insert_one(dict(ps))
        ps_id = ps["id"]
    if body.price is not None and body.price > 0:
        await db.price_history.insert_one({"id": new_id(), "product_supplier_id": ps_id, "product_id": pid, "supplier_id": body.supplier_id, "effective_from": body.effective_from or today_jkt(), "price": body.price, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()})
        await refresh_product_price(pid)
    await log_audit(user, "hubungkan_supplier", "product_supplier", ps_id, f'{prod["sku"]} - {sup["name"]}')
    return {"product_supplier_id": ps_id}

@api.delete("/products/{pid}/suppliers/{ps_id}")
async def unlink_supplier(pid: str, ps_id: str, user: dict = Depends(require_admin)):
    await db.product_suppliers.update_one({"id": ps_id}, {"$set": {"is_active": False}})
    await log_audit(user, "putus_supplier", "product_supplier", ps_id)
    return {"ok": True}

async def refresh_product_price(pid):
    pr = await latest_price_product(pid)
    if pr is not None:
        await db.products.update_one({"id": pid}, {"$set": {"current_purchase_price": pr, "updated_at": now_iso()}})

@api.post("/product-suppliers/{ps_id}/price")
async def update_ps_price(ps_id: str, body: PriceUpdate, user: dict = Depends(require_admin)):
    ps = await db.product_suppliers.find_one({"id": ps_id}, {"_id": 0})
    if not ps:
        raise HTTPException(status_code=404, detail="Relasi produk-supplier tidak ditemukan")
    old = await latest_price_product_supplier(ps_id)
    await db.price_history.insert_one({"id": new_id(), "product_supplier_id": ps_id, "product_id": ps["product_id"], "supplier_id": ps["supplier_id"], "effective_from": body.effective_from, "price": body.price, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()})
    await refresh_product_price(ps["product_id"])
    await log_audit(user, "ubah_harga_beli", "product_supplier", ps_id, "", before=old, after=body.price)
    return {"ok": True, "price": body.price}

@api.get("/product-suppliers/{ps_id}/price-history")
async def ps_price_history(ps_id: str, user: dict = Depends(get_current_user)):
    return await db.price_history.find({"product_supplier_id": ps_id}, {"_id": 0}).sort("effective_from", -1).to_list(1000)

@api.get("/products/{pid}/price-history")
async def product_price_history(pid: str, user: dict = Depends(get_current_user)):
    docs = await db.price_history.find({"product_id": pid}, {"_id": 0}).sort("effective_from", -1).to_list(1000)
    for d in docs:
        if d.get("supplier_id"):
            s = await db.suppliers.find_one({"id": d["supplier_id"]}, {"_id": 0, "name": 1})
            d["supplier_name"] = s["name"] if s else ""
    return docs

@api.get("/products/{pid}/movements")
async def product_movements(pid: str, user: dict = Depends(get_current_user)):
    return await db.inventory_movements.find({"product_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------------------------------------------------------------------------
# Stock In (supplier-driven)
# ---------------------------------------------------------------------------
@api.get("/stock-in/products")
async def stock_in_products(supplier_id: str, on_date: str, search: str = "", page: int = 1, page_size: int = 50, user: dict = Depends(get_current_user)):
    sup = await db.suppliers.find_one({"id": supplier_id})
    if not sup:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    links = await db.product_suppliers.find({"supplier_id": supplier_id, "is_active": True}, {"_id": 0}).to_list(100000)
    ps_map = {l["product_id"]: l for l in links}
    q = {"id": {"$in": list(ps_map.keys())}, "is_active": True, "is_deleted": {"$ne": True}}
    if search:
        q["$or"] = [{"sku": {"$regex": search, "$options": "i"}}, {"name": {"$regex": search, "$options": "i"}}]
    total = await db.products.count_documents(q)
    prods = await db.products.find(q, {"_id": 0}).sort("sku", 1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    out = []
    for p in prods:
        ps = ps_map[p["id"]]
        price = await price_for_ps(ps["id"], on_date)
        out.append({"product_id": p["id"], "product_supplier_id": ps["id"], "sku": p["sku"], "name": p["name"], "type": p.get("type", ""), "effective_price": price})
    return {"items": out, "total": total, "page": page, "page_size": page_size, "supplier_type": sup["type"], "supplier_name": sup["name"]}

@api.post("/stock-in")
async def create_stock_in(body: StockInCreate, user: dict = Depends(get_current_user)):
    sup = await db.suppliers.find_one({"id": body.supplier_id})
    if not sup:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    if not sup.get("is_active", True):
        raise HTTPException(status_code=400, detail="Supplier tidak aktif")
    if not body.items:
        raise HTTPException(status_code=400, detail="Minimal satu item dengan qty > 0")
    seen = set()
    resolved = []
    for it in body.items:
        if it.product_id in seen:
            raise HTTPException(status_code=400, detail="Terdapat SKU duplikat dalam satu batch")
        seen.add(it.product_id)
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod or not prod.get("is_active", True) or prod.get("is_deleted"):
            raise HTTPException(status_code=400, detail=f"SKU tidak valid/aktif: {prod['sku'] if prod else it.product_id}")
        ps = await db.product_suppliers.find_one({"product_id": it.product_id, "supplier_id": body.supplier_id, "is_active": True})
        if not ps:
            raise HTTPException(status_code=400, detail=f"SKU {prod['sku']} tidak terhubung ke supplier ini")
        price = await price_for_ps(ps["id"], body.transaction_date)
        source = "history"
        if price is None:
            if it.manual_price is None:
                raise HTTPException(status_code=400, detail=f"Belum ada harga efektif untuk {prod['sku']} pada tanggal ini. Isi harga manual.")
            price = it.manual_price
            source = "manual"
            await db.price_history.insert_one({"id": new_id(), "product_supplier_id": ps["id"], "product_id": it.product_id, "supplier_id": body.supplier_id, "effective_from": body.transaction_date, "price": price, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso(), "source": "manual_stockin"})
            await refresh_product_price(it.product_id)
        resolved.append({"product_id": it.product_id, "product_supplier_id": ps["id"], "sku": prod["sku"], "name": prod["name"], "quantity": it.quantity, "price": price, "total": it.quantity * price, "source": source})

    ref = "SI-" + datetime.now(JKT).strftime("%Y%m%d-%H%M%S")
    is_consignment = sup["type"] == "consignment"
    total = sum(r["total"] for r in resolved)
    txn = {"id": new_id(), "reference": ref, "transaction_date": body.transaction_date, "supplier_id": body.supplier_id, "supplier_name": sup["name"], "supplier_type": sup["type"], "is_consignment": is_consignment, "note": body.note, "total_quantity": sum(r["quantity"] for r in resolved), "total_value": total, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()}
    await db.stock_in_transactions.insert_one(dict(txn))
    for r in resolved:
        await db.stock_in_items.insert_one({"id": new_id(), "transaction_id": txn["id"], "reference": ref, "product_id": r["product_id"], "product_supplier_id": r["product_supplier_id"], "supplier_id": body.supplier_id, "sku": r["sku"], "product_name": r["name"], "transaction_date": body.transaction_date, "quantity": r["quantity"], "purchase_price_snapshot": r["price"], "price_source": r["source"], "total_value": r["total"], "created_at": now_iso()})
        await insert_movement(r["product_id"], "STOCK_IN", r["quantity"], "stock_in", txn["id"], body.transaction_date, user, extra={"reference": ref, "purchase_price": r["price"], "total_value": r["total"], "supplier_name": sup["name"]})
    payable = None
    if not is_consignment:
        payable = {"id": new_id(), "supplier_id": body.supplier_id, "supplier_name": sup["name"], "source_type": "stock_in", "source_id": txn["id"], "reference": ref, "date": body.transaction_date, "amount_initial": total, "amount_paid": 0, "amount_remaining": total, "status": "open", "created_at": now_iso()}
        await db.payables.insert_one(dict(payable))
    await log_audit(user, "buat_stock_in", "stock_in", txn["id"], ref, after={"total": total, "supplier": sup["name"], "consignment": is_consignment})
    return {"transaction": txn, "items": resolved, "payable_created": payable is not None}

@api.get("/stock-in")
async def list_stock_in(page: int = 1, page_size: int = 25, supplier_id: str = "", user: dict = Depends(get_current_user)):
    q = {}
    if supplier_id:
        q["supplier_id"] = supplier_id
    total = await db.stock_in_transactions.count_documents(q)
    docs = await db.stock_in_transactions.find(q, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": docs, "total": total, "page": page, "page_size": page_size}

@api.get("/stock-in/{tid}")
async def get_stock_in(tid: str, user: dict = Depends(get_current_user)):
    txn = await db.stock_in_transactions.find_one({"id": tid}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    items = await db.stock_in_items.find({"transaction_id": tid}, {"_id": 0}).to_list(1000)
    return {"transaction": txn, "items": items}


# ---------------------------------------------------------------------------
# Adjustment
# ---------------------------------------------------------------------------
@api.post("/adjustments")
async def create_adjustment(body: AdjustmentCreate, user: dict = Depends(get_current_user)):
    prod = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    cur = await current_stock(body.product_id)
    if body.mode == "set":
        delta = body.value - cur
    else:
        delta = body.value
    if delta == 0:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan stok")
    settings = await get_settings()
    if not settings["allow_negative_stock"] and cur + delta < 0:
        raise HTTPException(status_code=400, detail="Stok tidak boleh negatif")
    ref = "ADJ-" + datetime.now(JKT).strftime("%Y%m%d-%H%M%S")
    await insert_movement(body.product_id, "MANUAL_ADJUSTMENT", delta, "adjustment", ref, today_jkt(), user, extra={"reference": ref, "reason": body.reason})
    await log_audit(user, "penyesuaian_stok", "adjustment", ref, prod["sku"], before=cur, after=cur + delta)
    return {"ok": True, "reference": ref, "new_stock": cur + delta}


# ---------------------------------------------------------------------------
# Stock Opname
# ---------------------------------------------------------------------------
@api.post("/opname")
async def create_opname(body: OpnameCreate, user: dict = Depends(get_current_user)):
    active_products = await db.products.find({"is_active": True, "is_deleted": {"$ne": True}}, {"_id": 0}).to_list(100000)
    smap = await stock_map([p["id"] for p in active_products] or None)
    session = {"id": new_id(), "reference": "OP-" + datetime.now(JKT).strftime("%Y%m%d-%H%M%S"), "opname_date": body.opname_date, "snapshot_time": body.snapshot_time, "note": body.note, "status": "in_progress", "total_items": len(active_products), "counted_items": 0, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso(), "finalized_at": None}
    await db.stock_opnames.insert_one(dict(session))
    for p in active_products:
        await db.stock_opname_items.insert_one({"id": new_id(), "opname_id": session["id"], "product_id": p["id"], "sku": p["sku"], "product_name": p["name"], "type": p.get("type", ""), "system_stock": smap.get(p["id"], 0), "physical_stock": None, "difference": None, "counted": False, "note": ""})
    await log_audit(user, "buat_opname", "opname", session["id"], session["reference"])
    return session

@api.get("/opname")
async def list_opname(user: dict = Depends(get_current_user)):
    return await db.stock_opnames.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.get("/opname/{oid}")
async def get_opname(oid: str, search: str = "", status_filter: str = "", user: dict = Depends(get_current_user)):
    session = await db.stock_opnames.find_one({"id": oid}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Sesi opname tidak ditemukan")
    q = {"opname_id": oid}
    if search:
        q["$or"] = [{"sku": {"$regex": search, "$options": "i"}}, {"product_name": {"$regex": search, "$options": "i"}}]
    items = await db.stock_opname_items.find(q, {"_id": 0}).sort("sku", 1).to_list(100000)
    if status_filter == "counted":
        items = [i for i in items if i["counted"]]
    elif status_filter == "uncounted":
        items = [i for i in items if not i["counted"]]
    elif status_filter == "difference":
        items = [i for i in items if i["counted"] and i.get("difference", 0) != 0]
    return {"session": session, "items": items}

@api.patch("/opname/{oid}/counts")
async def save_counts(oid: str, body: OpnameSaveCounts, user: dict = Depends(get_current_user)):
    session = await db.stock_opnames.find_one({"id": oid}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Sesi opname tidak ditemukan")
    if session["status"] == "finalized":
        raise HTTPException(status_code=400, detail="Opname yang sudah final tidak bisa diubah")
    for c in body.counts:
        item = await db.stock_opname_items.find_one({"opname_id": oid, "product_id": c.product_id}, {"_id": 0})
        if not item:
            continue
        if c.physical_stock is None:
            await db.stock_opname_items.update_one({"id": item["id"]}, {"$set": {"physical_stock": None, "difference": None, "counted": False}})
        else:
            await db.stock_opname_items.update_one({"id": item["id"]}, {"$set": {"physical_stock": c.physical_stock, "difference": c.physical_stock - item["system_stock"], "counted": True}})
    counted = await db.stock_opname_items.count_documents({"opname_id": oid, "counted": True})
    await db.stock_opnames.update_one({"id": oid}, {"$set": {"counted_items": counted}})
    return await db.stock_opnames.find_one({"id": oid}, {"_id": 0})

@api.post("/opname/{oid}/finalize")
async def finalize_opname(oid: str, body: OpnameFinalize, user: dict = Depends(get_current_user)):
    session = await db.stock_opnames.find_one({"id": oid}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Sesi opname tidak ditemukan")
    if session["status"] == "finalized":
        raise HTTPException(status_code=400, detail="Opname sudah difinalkan")
    counted = await db.stock_opname_items.count_documents({"opname_id": oid, "counted": True})
    total = session["total_items"]
    if counted < total and not body.override_incomplete:
        raise HTTPException(status_code=400, detail=f"Baru {counted}/{total} SKU dihitung. Administrator dapat override untuk finalisasi sebagian.")
    if counted < total and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Hanya administrator yang bisa finalisasi opname sebagian")
    items = await db.stock_opname_items.find({"opname_id": oid, "counted": True}, {"_id": 0}).to_list(100000)
    adj = 0
    for it in items:
        diff = it.get("difference", 0) or 0
        if diff != 0:
            await insert_movement(it["product_id"], "OPNAME_ADJUSTMENT", diff, "opname", oid, session["opname_date"], user, extra={"reference": session["reference"]})
            adj += 1
    await db.stock_opnames.update_one({"id": oid}, {"$set": {"status": "finalized", "finalized_at": now_iso(), "counted_items": counted}})
    await log_audit(user, "finalisasi_opname", "opname", oid, session["reference"], after={"adjustments": adj})
    return {"session": await db.stock_opnames.find_one({"id": oid}, {"_id": 0}), "adjustments_created": adj}

@api.post("/opname/{oid}/bulk/validate")
async def opname_bulk_validate(oid: str, body: dict, user: dict = Depends(get_current_user)):
    session = await db.stock_opnames.find_one({"id": oid}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Sesi opname tidak ditemukan")
    rows = body.get("rows", [])
    preview = []
    seen = {}
    valid = 0
    for r in rows:
        sku = str(r.get("sku", "")).strip()
        raw = r.get("physical_stock", r.get("physical", r.get("quantity")))
        row = {"sku": sku, "physical_stock": raw, "product_name": None, "system_stock": None, "difference": None, "status": "valid", "error": ""}
        if not sku:
            row.update(status="error", error="SKU kosong"); preview.append(row); continue
        item = await db.stock_opname_items.find_one({"opname_id": oid, "sku": sku}, {"_id": 0})
        if not item:
            row.update(status="error", error="SKU tidak ada di sesi opname"); preview.append(row); continue
        try:
            qty = int(raw)
        except (TypeError, ValueError):
            row.update(status="error", error="Stok fisik harus bilangan bulat"); preview.append(row); continue
        if qty < 0:
            row.update(status="error", error="Stok fisik tidak boleh negatif"); preview.append(row); continue
        if sku in seen:
            row.update(status="error", error="SKU duplikat"); preview.append(row); continue
        seen[sku] = True
        row.update(physical_stock=qty, product_name=item["product_name"], system_stock=item["system_stock"], difference=qty - item["system_stock"], product_id=item["product_id"])
        valid += 1
        preview.append(row)
    return {"preview": preview, "valid_count": valid, "error_count": len(preview) - valid}


# ---------------------------------------------------------------------------
# Payables & Payments
# ---------------------------------------------------------------------------
@api.get("/payables")
async def list_payables(supplier_id: str = "", status: str = "", search: str = "", date_from: str = "", date_to: str = "", page: int = 1, page_size: int = 25, user: dict = Depends(get_current_user)):
    q = {}
    if supplier_id:
        q["supplier_id"] = supplier_id
    if status:
        q["status"] = status
    if search:
        q["reference"] = {"$regex": search, "$options": "i"}
    if date_from:
        q.setdefault("date", {})["$gte"] = date_from
    if date_to:
        q.setdefault("date", {})["$lte"] = date_to
    total = await db.payables.count_documents(q)
    docs = await db.payables.find(q, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    summary = await db.payables.aggregate([{"$match": {"status": {"$in": ["open", "partial"]}}}, {"$group": {"_id": None, "amt": {"$sum": "$amount_remaining"}}}]).to_list(1)
    return {"items": docs, "total": total, "page": page, "page_size": page_size, "total_outstanding": summary[0]["amt"] if summary else 0}

@api.get("/opname-daily/products")
async def opname_daily_products(supplier_id: str, on_date: str, search: str = "", page: int = 1, page_size: int = 50, user: dict = Depends(get_current_user)):
    sup = await db.suppliers.find_one({"id": supplier_id})
    if not sup:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    links = await db.product_suppliers.find({"supplier_id": supplier_id, "is_active": True}, {"_id": 0}).to_list(100000)
    ps_map = {l["product_id"]: l for l in links}
    q = {"id": {"$in": list(ps_map.keys())}, "is_active": True, "is_deleted": {"$ne": True}}
    if search:
        q["$or"] = [{"sku": {"$regex": search, "$options": "i"}}, {"name": {"$regex": search, "$options": "i"}}]
    total = await db.products.count_documents(q)
    prods = await db.products.find(q, {"_id": 0}).sort("sku", 1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    out = []
    for p in prods:
        ps = ps_map[p["id"]]
        out.append({"product_id": p["id"], "sku": p["sku"], "name": p["name"], "type": p.get("type", ""), "total_qty": await current_stock(p["id"]), "effective_price": await price_for_ps(ps["id"], on_date)})
    return {"items": out, "total": total, "page": page, "page_size": page_size, "supplier_type": sup["type"], "supplier_name": sup["name"]}


@api.post("/opname-daily")
async def create_opname_daily(body: OpnameDailyCreate, user: dict = Depends(get_current_user)):
    sup = await db.suppliers.find_one({"id": body.supplier_id})
    if not sup or not sup.get("is_active", True):
        raise HTTPException(status_code=400, detail="Supplier tidak valid/aktif")
    ref = "OPD-" + datetime.now(JKT).strftime("%Y%m%d-%H%M%S")
    is_cons = sup["type"] == "consignment"
    results = []
    total_out_value = 0
    total_out_qty = 0
    for it in body.items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            continue
        ps = await db.product_suppliers.find_one({"product_id": it.product_id, "supplier_id": body.supplier_id, "is_active": True})
        if not ps:
            continue
        cur = await current_stock(it.product_id)
        keluar = cur - it.physical_stock
        delta = it.physical_stock - cur
        if delta == 0:
            continue
        mtype = "STOCK_OUT" if delta < 0 else "MANUAL_ADJUSTMENT"
        await insert_movement(it.product_id, mtype, delta, "opname_daily", ref, body.opname_date, user, extra={"reference": ref, "reason": "opname harian", "supplier_name": sup["name"]})
        price = await price_for_ps(ps["id"], body.opname_date) or 0
        if is_cons and keluar > 0:
            total_out_value += keluar * price
        if keluar > 0:
            total_out_qty += keluar
        results.append({"sku": prod["sku"], "total_qty": cur, "physical_stock": it.physical_stock, "stok_keluar": keluar, "price": price})
    header = {"id": new_id(), "reference": ref, "supplier_id": body.supplier_id, "supplier_name": sup["name"], "supplier_type": sup["type"], "opname_date": body.opname_date, "note": body.note, "total_out_qty": total_out_qty, "total_out_value": total_out_value, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()}
    await db.opname_daily.insert_one(dict(header))
    payable_created = False
    if is_cons and total_out_value > 0:
        await db.payables.insert_one({"id": new_id(), "supplier_id": body.supplier_id, "supplier_name": sup["name"], "source_type": "consignment_opname", "source_id": header["id"], "reference": ref, "date": body.opname_date, "amount_initial": total_out_value, "amount_paid": 0, "amount_remaining": total_out_value, "status": "open", "created_at": now_iso()})
        payable_created = True
    await log_audit(user, "opname_harian", "opname_daily", header["id"], ref, after={"stok_keluar": total_out_qty, "hutang": total_out_value})
    return {"reference": ref, "items": results, "total_out_qty": total_out_qty, "total_out_value": total_out_value, "payable_created": payable_created, "is_consignment": is_cons}


@api.get("/opname-daily")
async def list_opname_daily(page: int = 1, page_size: int = 20, user: dict = Depends(get_current_user)):
    total = await db.opname_daily.count_documents({})
    docs = await db.opname_daily.find({}, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": docs, "total": total, "page": page, "page_size": page_size}


@api.get("/suppliers/{sid}/debt-card")
async def supplier_debt_card(sid: str, user: dict = Depends(get_current_user)):
    sup = await db.suppliers.find_one({"id": sid}, {"_id": 0})
    if not sup:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    payables = await db.payables.find({"supplier_id": sid}, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(100000)
    for p in payables:
        p["payments"] = await db.payments.find({"payable_id": p["id"]}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    totals = {"initial": sum(p["amount_initial"] for p in payables), "paid": sum(p["amount_paid"] for p in payables), "remaining": sum(p["amount_remaining"] for p in payables), "invoice_count": len(payables)}
    return {"supplier": sup, "payables": payables, "totals": totals}


@api.get("/payables-summary")
async def payables_summary(user: dict = Depends(get_current_user)):
    rows = []
    async for r in db.payables.aggregate([{"$match": {"status": {"$in": ["open", "partial"]}}}, {"$group": {"_id": "$supplier_id", "total": {"$sum": "$amount_remaining"}, "count": {"$sum": 1}, "name": {"$first": "$supplier_name"}}}]):
        rows.append({"supplier_id": r["_id"], "supplier_name": r["name"], "total_remaining": r["total"], "invoice_count": r["count"]})
    rows.sort(key=lambda x: -x["total_remaining"])
    return {"rows": rows}


@api.post("/payables/bulk-payment")
async def bulk_payment(body: BulkPaymentCreate, user: dict = Depends(get_current_user)):
    results = []
    for row in body.payments:
        payables = await db.payables.find({"supplier_id": row.supplier_id, "status": {"$in": ["open", "partial"]}}, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(100000)
        total_out = sum(p["amount_remaining"] for p in payables)
        if row.amount > total_out + 0.001:
            raise HTTPException(status_code=400, detail=f"Pembayaran {row.amount} melebihi total hutang supplier ({total_out})")
        remaining = row.amount
        applied = 0
        for p in payables:
            if remaining <= 0.001:
                break
            pay_amt = min(remaining, p["amount_remaining"])
            await db.payments.insert_one({"id": new_id(), "payable_id": p["id"], "supplier_id": row.supplier_id, "amount": pay_amt, "payment_date": row.payment_date, "note": row.note or "Pembayaran massal", "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()})
            new_paid = p["amount_paid"] + pay_amt
            new_rem = round(p["amount_initial"] - new_paid, 2)
            await db.payables.update_one({"id": p["id"]}, {"$set": {"amount_paid": new_paid, "amount_remaining": max(new_rem, 0), "status": "paid" if new_rem <= 0.001 else "partial"}})
            remaining -= pay_amt
            applied += pay_amt
        await log_audit(user, "pembayaran_massal", "payable", row.supplier_id, "", after={"dibayar": applied})
        results.append({"supplier_id": row.supplier_id, "applied": applied})
    return {"results": results}


@api.get("/payables/{pid}")
async def get_payable(pid: str, user: dict = Depends(get_current_user)):
    p = await db.payables.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Hutang tidak ditemukan")
    payments = await db.payments.find({"payable_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    source = None
    if p["source_type"] == "stock_in":
        source = await db.stock_in_transactions.find_one({"id": p["source_id"]}, {"_id": 0})
    elif p["source_type"] == "settlement":
        source = await db.settlements.find_one({"id": p["source_id"]}, {"_id": 0})
    return {"payable": p, "payments": payments, "source": source}

@api.post("/payables/{pid}/payments")
async def create_payment(pid: str, body: PaymentCreate, user: dict = Depends(get_current_user)):
    p = await db.payables.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Hutang tidak ditemukan")
    if p["status"] in ("paid", "void"):
        raise HTTPException(status_code=400, detail="Hutang sudah lunas atau dibatalkan")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Nominal pembayaran harus > 0")
    if body.amount > p["amount_remaining"] + 0.001:
        raise HTTPException(status_code=400, detail=f"Pembayaran melebihi sisa hutang ({p['amount_remaining']})")
    pay = {"id": new_id(), "payable_id": pid, "supplier_id": p["supplier_id"], "amount": body.amount, "payment_date": body.payment_date, "note": body.note, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()}
    await db.payments.insert_one(dict(pay))
    new_paid = p["amount_paid"] + body.amount
    new_remaining = round(p["amount_initial"] - new_paid, 2)
    new_status = "paid" if new_remaining <= 0.001 else "partial"
    await db.payables.update_one({"id": pid}, {"$set": {"amount_paid": new_paid, "amount_remaining": max(new_remaining, 0), "status": new_status}})
    await log_audit(user, "pembayaran_hutang", "payable", pid, p["reference"], before=p["amount_remaining"], after=max(new_remaining, 0))
    return {"payment": pay, "amount_remaining": max(new_remaining, 0), "status": new_status}


# ---------------------------------------------------------------------------
# Consignment Settlement
# ---------------------------------------------------------------------------
@api.post("/settlements")
async def create_settlement(body: SettlementCreate, user: dict = Depends(require_admin)):
    sup = await db.suppliers.find_one({"id": body.supplier_id})
    if not sup:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    if sup["type"] != "consignment":
        raise HTTPException(status_code=400, detail="Settlement hanya untuk supplier titip jual (consignment)")
    if body.period_end < body.period_start:
        raise HTTPException(status_code=400, detail="Tanggal akhir harus >= tanggal awal")
    overlap = await db.settlements.find_one({"supplier_id": body.supplier_id, "status": {"$in": ["draft", "finalized", "partial", "paid"]}, "period_start": {"$lte": body.period_end}, "period_end": {"$gte": body.period_start}})
    if overlap:
        raise HTTPException(status_code=400, detail=f"Periode tumpang tindih dengan settlement {overlap['reference']}")

    links = await db.product_suppliers.find({"supplier_id": body.supplier_id, "is_active": True}, {"_id": 0}).to_list(100000)
    session = {"id": new_id(), "reference": "STL-" + datetime.now(JKT).strftime("%Y%m%d-%H%M%S"), "supplier_id": body.supplier_id, "supplier_name": sup["name"], "period_start": body.period_start, "period_end": body.period_start if False else body.period_end, "status": "draft", "note": body.note, "total": 0, "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso(), "finalized_at": None}
    await db.settlements.insert_one(dict(session))
    for l in links:
        pid = l["product_id"]
        prod = await db.products.find_one({"id": pid}, {"_id": 0})
        if not prod:
            continue
        opening = await stock_before(pid, body.period_start)
        # stock in from this supplier during period
        si = await db.stock_in_items.aggregate([{"$match": {"product_id": pid, "supplier_id": body.supplier_id, "transaction_date": {"$gte": body.period_start, "$lte": body.period_end}}}, {"$group": {"_id": None, "q": {"$sum": "$quantity"}}}]).to_list(1)
        stock_in_period = si[0]["q"] if si else 0
        if opening == 0 and stock_in_period == 0:
            continue
        closing = await current_stock(pid)
        price = await price_for_ps(l["id"], body.period_end)
        available = opening + stock_in_period
        qty_consumed = available - closing
        await db.settlement_items.insert_one({"id": new_id(), "settlement_id": session["id"], "product_id": pid, "product_supplier_id": l["id"], "sku": prod["sku"], "product_name": prod["name"], "opening_stock": opening, "stock_in_period": stock_in_period, "closing_stock": closing, "qty_consumed": qty_consumed, "settlement_price": price or 0, "settlement_value": max(qty_consumed, 0) * (price or 0), "validated": False})
    await log_audit(user, "buat_settlement", "settlement", session["id"], session["reference"])
    return session

@api.get("/settlements")
async def list_settlements(user: dict = Depends(get_current_user)):
    return await db.settlements.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.get("/settlements/{sid}")
async def get_settlement(sid: str, user: dict = Depends(get_current_user)):
    s = await db.settlements.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Settlement tidak ditemukan")
    items = await db.settlement_items.find({"settlement_id": sid}, {"_id": 0}).sort("sku", 1).to_list(100000)
    payable = await db.payables.find_one({"source_type": "settlement", "source_id": sid}, {"_id": 0})
    return {"settlement": s, "items": items, "payable": payable}

@api.patch("/settlements/{sid}/items")
async def save_settlement_items(sid: str, body: SettlementSave, user: dict = Depends(require_admin)):
    s = await db.settlements.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Settlement tidak ditemukan")
    if s["status"] != "draft":
        raise HTTPException(status_code=400, detail="Hanya settlement draft yang bisa diubah")
    for it in body.items:
        doc = await db.settlement_items.find_one({"settlement_id": sid, "product_id": it.product_id}, {"_id": 0})
        if not doc:
            continue
        closing = it.closing_stock if it.closing_stock is not None else doc["closing_stock"]
        price = it.settlement_price if it.settlement_price is not None else doc["settlement_price"]
        validated = it.validated if it.validated is not None else doc.get("validated", False)
        available = doc["opening_stock"] + doc["stock_in_period"]
        qty = available - closing
        await db.settlement_items.update_one({"id": doc["id"]}, {"$set": {"closing_stock": closing, "settlement_price": price, "qty_consumed": qty, "settlement_value": max(qty, 0) * price, "validated": validated}})
    items = await db.settlement_items.find({"settlement_id": sid}, {"_id": 0}).to_list(100000)
    total = sum(i["settlement_value"] for i in items)
    await db.settlements.update_one({"id": sid}, {"$set": {"total": total}})
    return await get_settlement(sid, user)

@api.post("/settlements/{sid}/finalize")
async def finalize_settlement(sid: str, user: dict = Depends(require_admin)):
    s = await db.settlements.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Settlement tidak ditemukan")
    if s["status"] != "draft":
        raise HTTPException(status_code=400, detail="Settlement sudah difinalkan/dibatalkan")
    items = await db.settlement_items.find({"settlement_id": sid}, {"_id": 0}).to_list(100000)
    if not items:
        raise HTTPException(status_code=400, detail="Tidak ada item untuk difinalkan")
    unvalidated = [i["sku"] for i in items if not i.get("validated")]
    if unvalidated:
        raise HTTPException(status_code=400, detail=f"Stok akhir belum tervalidasi untuk: {', '.join(unvalidated[:5])}{'...' if len(unvalidated) > 5 else ''}. Validasi stok akhir (mis. via opname) sebelum finalisasi.")
    total = sum(i["settlement_value"] for i in items)
    await db.settlements.update_one({"id": sid}, {"$set": {"status": "finalized", "finalized_at": now_iso(), "total": total}})
    payable = {"id": new_id(), "supplier_id": s["supplier_id"], "supplier_name": s["supplier_name"], "source_type": "settlement", "source_id": sid, "reference": s["reference"], "date": s["period_end"], "amount_initial": total, "amount_paid": 0, "amount_remaining": total, "status": "open", "created_at": now_iso()}
    await db.payables.insert_one(dict(payable))
    await log_audit(user, "finalisasi_settlement", "settlement", sid, s["reference"], after={"total": total})
    return {"settlement": await db.settlements.find_one({"id": sid}, {"_id": 0}), "payable_created": True, "total": total}


# ---------------------------------------------------------------------------
# History / movements
# ---------------------------------------------------------------------------
@api.get("/movements")
async def list_movements(date_from: str = "", date_to: str = "", product_id: str = "", type: str = "", supplier_id: str = "", user_id: str = "", search: str = "", page: int = 1, page_size: int = 30, current: dict = Depends(get_current_user)):
    q = {}
    if date_from:
        q.setdefault("movement_date", {})["$gte"] = date_from
    if date_to:
        q.setdefault("movement_date", {})["$lte"] = date_to
    if product_id:
        q["product_id"] = product_id
    if type:
        q["movement_type"] = type
    if user_id:
        q["created_by"] = user_id
    if supplier_id:
        links = await db.product_suppliers.find({"supplier_id": supplier_id}, {"_id": 0, "product_id": 1}).to_list(100000)
        q["product_id"] = {"$in": [l["product_id"] for l in links]}
    if search:
        prods = await db.products.find({"$or": [{"sku": {"$regex": search, "$options": "i"}}, {"name": {"$regex": search, "$options": "i"}}]}, {"_id": 0, "id": 1}).to_list(100000)
        pids = [p["id"] for p in prods]
        q["$or"] = [{"product_id": {"$in": pids}}, {"reference": {"$regex": search, "$options": "i"}}]
    total = await db.inventory_movements.count_documents(q)
    docs = await db.inventory_movements.find(q, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    pids = list({d["product_id"] for d in docs})
    prods = await db.products.find({"id": {"$in": pids}}, {"_id": 0}).to_list(10000)
    pmap = {p["id"]: p for p in prods}
    for d in docs:
        p = pmap.get(d["product_id"], {})
        d["sku"] = p.get("sku", "")
        d["product_name"] = p.get("name", "")
    return {"items": docs, "total": total, "page": page, "page_size": page_size}

@api.get("/audit")
async def list_audit(page: int = 1, page_size: int = 40, action: str = "", search: str = "", user: dict = Depends(get_current_user)):
    q = {}
    if action:
        q["action"] = action
    if search:
        q["$or"] = [{"reference": {"$regex": search, "$options": "i"}}, {"user_name": {"$regex": search, "$options": "i"}}]
    total = await db.audit_logs.count_documents(q)
    docs = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": docs, "total": total, "page": page, "page_size": page_size}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api.get("/dashboard")
async def dashboard(date_from: str = "", date_to: str = "", current: dict = Depends(get_current_user)):
    settings = await get_settings()
    prods = await db.products.find({"is_deleted": {"$ne": True}}, {"_id": 0}).to_list(100000)
    smap = await stock_map()
    total_sku = len([p for p in prods if p.get("is_active", True)])
    total_stock = sum(smap.get(p["id"], 0) for p in prods)
    inv_value = 0
    low = critical = 0
    alerts = []
    for p in prods:
        pr = await latest_price_product(p["id"]) or p.get("current_purchase_price", 0) or 0
        s = smap.get(p["id"], 0)
        inv_value += s * pr
        if not p.get("is_active", True):
            continue
        st = stock_status(s, p.get("minimum_stock", 0), settings["critical_threshold_percent"], p.get("critical_stock"))
        if st in ("low", "critical"):
            alerts.append({"id": p["id"], "sku": p["sku"], "name": p["name"], "current_stock": s, "minimum_stock": p.get("minimum_stock", 0), "stock_status": st})
        if st == "critical":
            critical += 1
        elif st == "low":
            low += 1
    today = today_jkt()
    stock_in_today = 0
    async for r in db.inventory_movements.aggregate([{"$match": {"movement_date": today, "movement_type": "STOCK_IN"}}, {"$group": {"_id": None, "q": {"$sum": "$quantity"}}}]):
        stock_in_today = r["q"]
    outstanding = await db.payables.aggregate([{"$match": {"status": {"$in": ["open", "partial"]}}}, {"$group": {"_id": None, "amt": {"$sum": "$amount_remaining"}}}]).to_list(1)
    outstanding = outstanding[0]["amt"] if outstanding else 0

    match = {}
    if date_from:
        match.setdefault("movement_date", {})["$gte"] = date_from
    if date_to:
        match.setdefault("movement_date", {})["$lte"] = date_to
    chart = {}
    async for mv in db.inventory_movements.find(match, {"_id": 0, "movement_date": 1, "quantity": 1, "movement_type": 1}):
        key = mv["movement_date"]
        chart.setdefault(key, {"date": key, "stock_in": 0, "stock_out": 0})
        if mv["movement_type"] == "STOCK_IN" and mv["quantity"] > 0:
            chart[key]["stock_in"] += mv["quantity"]
        elif mv["quantity"] < 0:
            chart[key]["stock_out"] += abs(mv["quantity"])
    # purchases value in range (regular stock-in + finalized settlement)
    purchase_value = 0
    async for si in db.stock_in_transactions.find({"is_consignment": False, "transaction_date": (match.get("movement_date") or {"$exists": True})} if date_from or date_to else {"is_consignment": False}, {"_id": 0, "total_value": 1}):
        purchase_value += si.get("total_value", 0)

    recent = await db.inventory_movements.find({}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    rpids = list({r["product_id"] for r in recent})
    rprods = await db.products.find({"id": {"$in": rpids}}, {"_id": 0}).to_list(1000)
    rmap = {p["id"]: p for p in rprods}
    for r in recent:
        p = rmap.get(r["product_id"], {})
        r["sku"] = p.get("sku", "")
        r["product_name"] = p.get("name", "")
    return {
        "kpis": {"total_sku": total_sku, "total_stock": total_stock, "inventory_value": inv_value, "stock_in_today": stock_in_today, "low_stock": low, "critical_stock": critical, "outstanding_debt": outstanding, "purchase_value": purchase_value},
        "chart": sorted(chart.values(), key=lambda x: x["date"]),
        "alerts": sorted(alerts, key=lambda x: x["current_stock"])[:20],
        "recent_activity": recent,
    }


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
@api.get("/reports/inventory-summary")
async def report_inventory_summary(date_from: str, date_to: str, current: dict = Depends(get_current_user)):
    settings = await get_settings()
    prods = await db.products.find({"is_deleted": {"$ne": True}}, {"_id": 0}).to_list(100000)
    rows = []
    totals = {"opening": 0, "stock_in": 0, "adjustment": 0, "closing": 0}
    for p in prods:
        pid = p["id"]
        opening = await stock_before(pid, date_from)
        stock_in = adjustment = 0
        async for r in db.inventory_movements.aggregate([{"$match": {"product_id": pid, "movement_date": {"$gte": date_from, "$lte": date_to}}}, {"$group": {"_id": "$movement_type", "q": {"$sum": "$quantity"}}}]):
            if r["_id"] == "STOCK_IN":
                stock_in += r["q"]
            else:
                adjustment += r["q"]
        closing = opening + stock_in + adjustment
        if opening == 0 and stock_in == 0 and adjustment == 0 and closing == 0:
            continue
        st = stock_status(closing, p.get("minimum_stock", 0), settings["critical_threshold_percent"], p.get("critical_stock"))
        rows.append({"sku": p["sku"], "product": p["name"], "opening": opening, "stock_in": stock_in, "adjustment": adjustment, "closing": closing, "stock_status": st})
        for k in totals:
            totals[k] += {"opening": opening, "stock_in": stock_in, "adjustment": adjustment, "closing": closing}[k]
    rows.sort(key=lambda x: x["sku"])
    return {"rows": rows, "totals": totals}

@api.get("/reports/purchases")
async def report_purchases(date_from: str, date_to: str, current: dict = Depends(get_current_user)):
    docs = await db.stock_in_items.find({"transaction_date": {"$gte": date_from, "$lte": date_to}}, {"_id": 0}).sort("transaction_date", 1).to_list(100000)
    sids = list({d.get("supplier_id") for d in docs if d.get("supplier_id")})
    sups = await db.suppliers.find({"id": {"$in": sids}}, {"_id": 0}).to_list(10000)
    smap = {s["id"]: s["name"] for s in sups}
    rows = []
    tq = tv = 0
    for d in docs:
        rows.append({"date": d["transaction_date"], "supplier": smap.get(d.get("supplier_id"), ""), "sku": d["sku"], "product": d.get("product_name", ""), "quantity": d["quantity"], "purchase_price": d["purchase_price_snapshot"], "total": d["total_value"], "reference": d.get("reference", "")})
        tq += d["quantity"]
        tv += d["total_value"]
    return {"rows": rows, "total_quantity": tq, "total_value": tv}

@api.get("/reports/stock-movement")
async def report_stock_movement(date_from: str, date_to: str, current: dict = Depends(get_current_user)):
    docs = await db.inventory_movements.find({"movement_date": {"$gte": date_from, "$lte": date_to}}, {"_id": 0}).sort("movement_date", 1).to_list(100000)
    pids = list({d["product_id"] for d in docs})
    prods = await db.products.find({"id": {"$in": pids}}, {"_id": 0}).to_list(100000)
    pmap = {p["id"]: p for p in prods}
    rows = []
    for d in docs:
        p = pmap.get(d["product_id"], {})
        rows.append({"date": d["movement_date"], "sku": p.get("sku", ""), "product": p.get("name", ""), "type": d["movement_type"], "quantity": d["quantity"], "balance": d.get("balance_after"), "user": d.get("created_by_name", ""), "reference": d.get("reference", "")})
    return {"rows": rows}

@api.get("/reports/supplier-debt")
async def report_supplier_debt(current: dict = Depends(get_current_user)):
    payables = await db.payables.find({}, {"_id": 0}).sort("created_at", -1).to_list(100000)
    rows = []
    for p in payables:
        rows.append({"supplier": p["supplier_name"], "reference": p["reference"], "source_type": p["source_type"], "date": p["date"], "amount_initial": p["amount_initial"], "amount_paid": p["amount_paid"], "amount_remaining": p["amount_remaining"], "status": p["status"]})
    return {"rows": rows, "total_remaining": sum(p["amount_remaining"] for p in payables)}

@api.get("/reports/consignment-settlement")
async def report_consignment_settlement(current: dict = Depends(get_current_user)):
    settlements = await db.settlements.find({}, {"_id": 0}).sort("created_at", -1).to_list(100000)
    rows = []
    for s in settlements:
        items = await db.settlement_items.find({"settlement_id": s["id"]}, {"_id": 0}).to_list(100000)
        payable = await db.payables.find_one({"source_type": "settlement", "source_id": s["id"]}, {"_id": 0})
        for it in items:
            rows.append({"reference": s["reference"], "supplier": s["supplier_name"], "period": f'{s["period_start"]} s/d {s["period_end"]}', "sku": it["sku"], "product": it["product_name"], "stock_in_period": it["stock_in_period"], "closing_stock": it["closing_stock"], "qty_consumed": it["qty_consumed"], "settlement_price": it["settlement_price"], "settlement_value": it["settlement_value"], "status": s["status"], "paid": payable["amount_paid"] if payable else 0, "remaining": payable["amount_remaining"] if payable else 0})
    return {"rows": rows, "total_value": sum(r["settlement_value"] for r in rows)}

@api.get("/reports/low-stock")
async def report_low_stock(current: dict = Depends(get_current_user)):
    settings = await get_settings()
    prods = await db.products.find({"is_active": True, "is_deleted": {"$ne": True}}, {"_id": 0}).to_list(100000)
    smap = await stock_map()
    rows = []
    for p in prods:
        s = smap.get(p["id"], 0)
        st = stock_status(s, p.get("minimum_stock", 0), settings["critical_threshold_percent"], p.get("critical_stock"))
        if st in ("low", "critical"):
            rows.append({"sku": p["sku"], "product": p["name"], "type": p.get("type", ""), "current_stock": s, "minimum_stock": p.get("minimum_stock", 0), "stock_status": st})
    rows.sort(key=lambda x: (x["stock_status"] != "critical", x["current_stock"]))
    return {"rows": rows}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@api.get("/settings")
async def read_settings(user: dict = Depends(get_current_user)):
    return await get_settings()

@api.patch("/settings")
async def patch_settings(body: SettingsUpdate, user: dict = Depends(require_admin)):
    cur = await get_settings()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.settings.update_one({"id": "global"}, {"$set": updates}, upsert=True)
        await log_audit(user, "ubah_pengaturan", "settings", "global", "", before={k: cur.get(k) for k in updates}, after=updates)
    return await get_settings()


# ---------------------------------------------------------------------------
# Product import (bulk)
# ---------------------------------------------------------------------------
@api.post("/products/import/validate")
async def products_import_validate(body: dict, user: dict = Depends(require_admin)):
    rows = body.get("rows", [])
    preview = []
    seen = {}
    valid = 0
    existing = set(await db.products.distinct("sku", {"is_deleted": {"$ne": True}}))
    for r in rows:
        sku = str(r.get("sku", "")).strip()
        name = str(r.get("name", "")).strip()
        row = {"sku": sku, "name": name, "type": str(r.get("type", "")).strip(), "minimum_stock": r.get("minimum_stock", 0), "status": "valid", "error": ""}
        if not sku:
            row.update(status="error", error="SKU kosong"); preview.append(row); continue
        if not name:
            row.update(status="error", error="Nama kosong"); preview.append(row); continue
        if sku in existing:
            row.update(status="error", error="SKU sudah ada"); preview.append(row); continue
        if sku in seen:
            row.update(status="error", error="SKU duplikat"); preview.append(row); continue
        seen[sku] = True
        try:
            row["minimum_stock"] = int(row["minimum_stock"] or 0)
        except (TypeError, ValueError):
            row.update(status="error", error="Minimum stok tidak valid"); preview.append(row); continue
        valid += 1
        preview.append(row)
    return {"preview": preview, "valid_count": valid, "error_count": len(preview) - valid}

@api.post("/products/import/commit")
async def products_import_commit(body: dict, user: dict = Depends(require_admin)):
    result = await products_import_validate({"rows": body.get("rows", [])}, user)
    if result["error_count"] > 0:
        raise HTTPException(status_code=400, detail=f"{result['error_count']} baris bermasalah. Perbaiki dulu.")
    created = 0
    for row in result["preview"]:
        if row["status"] != "valid":
            continue
        doc = {"id": new_id(), "sku": row["sku"], "name": row["name"], "type": row["type"], "photo_url": "", "minimum_stock": row["minimum_stock"], "critical_stock": None, "current_purchase_price": 0, "is_active": True, "is_deleted": False, "created_at": now_iso(), "updated_at": now_iso()}
        await db.products.insert_one(dict(doc))
        created += 1
    await log_audit(user, "impor_data", "product", "", f"{created} produk diimpor")
    return {"created": created}


@api.post("/import/parse-file")
async def parse_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    content = await file.read()
    name = (file.filename or "").lower()
    try:
        df = pd.read_csv(io.BytesIO(content)) if name.endswith(".csv") else pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal membaca file: {e}")
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    df = df.where(pd.notnull(df), None)
    return {"columns": list(df.columns), "rows": df.to_dict(orient="records")}


@api.get("/search")
async def global_search(q: str, current: dict = Depends(get_current_user)):
    if not q:
        return {"products": [], "suppliers": []}
    prods = await db.products.find({"is_deleted": {"$ne": True}, "$or": [{"sku": {"$regex": q, "$options": "i"}}, {"name": {"$regex": q, "$options": "i"}}]}, {"_id": 0}).limit(8).to_list(8)
    smap = await stock_map([p["id"] for p in prods] or None)
    for p in prods:
        p["current_stock"] = smap.get(p["id"], 0)
    sups = await db.suppliers.find({"is_deleted": {"$ne": True}, "name": {"$regex": q, "$options": "i"}}, {"_id": 0}).limit(5).to_list(5)
    return {"products": prods, "suppliers": sups}


# ---------------------------------------------------------------------------
# Migration / backfill (idempotent)
# ---------------------------------------------------------------------------
async def migrate_v2():
    # products: add is_deleted, critical_stock defaults
    await db.products.update_many({"is_deleted": {"$exists": False}}, {"$set": {"is_deleted": False}})
    await db.products.update_many({"critical_stock": {"$exists": False}}, {"$set": {"critical_stock": None}})
    await db.products.update_many({"photo_url": {"$exists": False}}, {"$set": {"photo_url": ""}})
    # Build suppliers from legacy product.supplier string
    name_to_id = {}
    existing_sups = await db.suppliers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(100000)
    for s in existing_sups:
        name_to_id[s["name"].strip().lower()] = s["id"]
    async for p in db.products.find({}, {"_id": 0}):
        legacy = (p.get("supplier") or "").strip()
        if not legacy:
            continue
        key = legacy.lower()
        if key not in name_to_id:
            sid = new_id()
            await db.suppliers.insert_one({"id": sid, "name": legacy, "contact": "", "address": "", "notes": "Dibuat otomatis dari data lama", "type": "regular", "is_active": True, "is_deleted": False, "created_at": now_iso(), "updated_at": now_iso()})
            name_to_id[key] = sid
        sid = name_to_id[key]
        link = await db.product_suppliers.find_one({"product_id": p["id"], "supplier_id": sid})
        if not link:
            ps_id = new_id()
            await db.product_suppliers.insert_one({"id": ps_id, "product_id": p["id"], "supplier_id": sid, "is_active": True, "created_at": now_iso()})
        else:
            ps_id = link["id"]
        # migrate legacy price_history (no product_supplier_id) for this product
        await db.price_history.update_many({"product_id": p["id"], "product_supplier_id": {"$exists": False}}, {"$set": {"product_supplier_id": ps_id, "supplier_id": sid}})
        # legacy stock_in_items supplier backfill
        await db.stock_in_items.update_many({"product_id": p["id"], "supplier_id": {"$exists": False}}, {"$set": {"supplier_id": sid, "product_supplier_id": ps_id}})
    # legacy stock_in_transactions supplier flag
    await db.stock_in_transactions.update_many({"is_consignment": {"$exists": False}}, {"$set": {"is_consignment": False}})
    logger.info("Migration v2 completed")


async def ensure_index(coll, keys, **kw):
    try:
        await coll.create_index(keys, **kw)
    except Exception as e:
        logger.warning(f"index skip: {e}")

@app.on_event("startup")
async def startup():
    await ensure_index(db.users, "email", unique=True)
    await ensure_index(db.suppliers, [("supplier_id", 1)])
    await ensure_index(db.product_suppliers, [("supplier_id", 1), ("is_active", 1)])
    await ensure_index(db.product_suppliers, [("product_id", 1), ("supplier_id", 1)])
    await ensure_index(db.price_history, [("product_supplier_id", 1), ("effective_from", -1)])
    await ensure_index(db.price_history, [("product_id", 1), ("effective_from", -1)])
    await ensure_index(db.inventory_movements, [("product_id", 1)])
    await ensure_index(db.inventory_movements, "movement_date")
    await ensure_index(db.inventory_movements, "created_at")
    await ensure_index(db.stock_in_items, "transaction_date")
    await ensure_index(db.stock_in_items, [("supplier_id", 1), ("transaction_date", 1)])
    await ensure_index(db.stock_opname_items, "opname_id")
    await ensure_index(db.payables, [("supplier_id", 1), ("status", 1)])
    await ensure_index(db.settlement_items, "settlement_id")
    await ensure_index(db.login_attempts, "identifier")

    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    admin_name = os.environ.get("ADMIN_NAME", "Admin")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"id": new_id(), "email": admin_email, "password_hash": hash_password(admin_password), "name": admin_name, "role": "admin", "is_active": True, "created_at": now_iso()})
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
    await get_settings()
    await migrate_v2()


@app.on_event("shutdown")
async def shutdown():
    client.close()


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
