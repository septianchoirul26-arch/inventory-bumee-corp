import requests, sys

API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
s = requests.Session()
tok = s.post(f"{API}/auth/login", json={"email":"admin@bumeecorp.com","password":"bumeebola2023"}).json()["access_token"]
s.headers.update({"Authorization": f"Bearer {tok}"})

def get_prod(sku):
    r = s.get(f"{API}/products", params={"search": sku}).json()
    return r["items"][0]

f001 = get_prod("F001")
pid = f001["id"]
print("F001 id", pid)

# Stock In Aug 1: 100
s.post(f"{API}/stock-in", json={"transaction_date":"2026-08-01","items":[{"sku":"F001","quantity":100}]}).raise_for_status()
f001 = s.get(f"{API}/products/{pid}").json()
assert f001["current_stock"] == 100, f001["current_stock"]
print("After Aug1 stock-in: stock=100 OK, value=", 100*50000)

# Change price Aug 15 -> 55000
s.post(f"{API}/products/{pid}/price", json={"price":55000,"effective_from":"2026-08-15"}).raise_for_status()

# Stock In Aug 16: 100 -> should snapshot 55000
r = s.post(f"{API}/stock-in", json={"transaction_date":"2026-08-16","items":[{"sku":"F001","quantity":100}]}).json()
assert r["items"][0]["purchase_price"] == 55000, r["items"][0]
f001 = s.get(f"{API}/products/{pid}").json()
assert f001["current_stock"] == 200, f001["current_stock"]
print("After Aug16: stock=200 OK, snapshot=55000 OK")

# Stock-in-value report: Aug 1 must remain 5,000,000 and Aug 16 = 5,500,000
rep = s.get(f"{API}/reports/stock-in-value", params={"date_from":"2026-08-01","date_to":"2026-08-31"}).json()
vals = sorted([(row["date"], row["total"]) for row in rep["rows"] if row["sku"]=="F001"])
print("Stock-in-value F001:", vals, "total_value=", rep["total_value"])
assert ("2026-08-01", 5000000.0) in vals
assert ("2026-08-16", 5500000.0) in vals

# Opname Aug 18, physical 180
op = s.post(f"{API}/opname", json={"opname_date":"2026-08-18","snapshot_time":"08:00"}).json()
oid = op["id"]
items = s.get(f"{API}/opname/{oid}").json()["items"]
sys_item = [i for i in items if i["sku"]=="F001"][0]
assert sys_item["system_stock"] == 200, sys_item
s.patch(f"{API}/opname/{oid}/counts", json={"counts":[{"product_id":pid,"physical_stock":180}]}).raise_for_status()
items = s.get(f"{API}/opname/{oid}").json()["items"]
sys_item = [i for i in items if i["sku"]=="F001"][0]
assert sys_item["difference"] == -20, sys_item
# Finalize with override (only 1 counted of many)
fin = s.post(f"{API}/opname/{oid}/finalize", json={"override_incomplete": True}).json()
print("Finalize adjustments:", fin["adjustments_created"])
f001 = s.get(f"{API}/products/{pid}").json()
assert f001["current_stock"] == 180, f001["current_stock"]
print("After opname finalize: stock=180 OK")

# Change current price to 60000 (effective today/future)
s.post(f"{API}/products/{pid}/price", json={"price":60000,"effective_from":"2026-09-01"}).raise_for_status()
f001 = s.get(f"{API}/products/{pid}").json()
print("current price", f001["current_purchase_price"], "inv value", f001["current_inventory_value"])
assert f001["current_inventory_value"] == 180*60000, f001["current_inventory_value"]

# Historical stock-in values must remain unchanged
rep = s.get(f"{API}/reports/stock-in-value", params={"date_from":"2026-08-01","date_to":"2026-08-31"}).json()
vals = sorted([(row["date"], row["total"]) for row in rep["rows"] if row["sku"]=="F001"])
assert ("2026-08-01", 5000000.0) in vals and ("2026-08-16", 5500000.0) in vals
print("Historical stock-in values unchanged after current price change OK")
print("\n==== ALL ACCEPTANCE ASSERTIONS PASSED ====")
