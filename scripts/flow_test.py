import requests
API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {s.post(f'{API}/auth/login', json={'email':'admin@bumeecorp.com','password':'bumeebola2023'}).json()['access_token']}"})

# Create consignment supplier
cons = s.post(f"{API}/suppliers", json={"name":"Titip Jaya","type":"consignment"}).json()
reg = s.post(f"{API}/suppliers", json={"name":"Reguler Makmur","type":"regular"}).json()
# Create product
p = s.post(f"{API}/products", json={"sku":"TST-FLOW-1","name":"Produk Flow","type":"Tes","minimum_stock":10}).json()
pid = p["id"]
# Link both suppliers with prices
s.post(f"{API}/products/{pid}/suppliers", json={"supplier_id":reg["id"],"price":10000,"effective_from":"2026-06-01"})
s.post(f"{API}/products/{pid}/suppliers", json={"supplier_id":cons["id"],"price":8000,"effective_from":"2026-06-01"})

# Stock-in regular -> should create payable
r = s.post(f"{API}/stock-in", json={"transaction_date":"2026-06-15","supplier_id":reg["id"],"items":[{"product_id":pid,"quantity":50}]}).json()
assert r["payable_created"] is True, r
print("Regular stock-in payable created OK; total", r["transaction"]["total_value"])
# Stock-in consignment -> no payable
r2 = s.post(f"{API}/stock-in", json={"transaction_date":"2026-06-16","supplier_id":cons["id"],"items":[{"product_id":pid,"quantity":30}]}).json()
assert r2["payable_created"] is False, r2
print("Consignment stock-in NO payable OK")
stock = s.get(f"{API}/products/{pid}").json()["current_stock"]
assert stock == 80, stock
print("Stock = 80 OK")

# Pay partial
pay_list = s.get(f"{API}/payables", params={"supplier_id":reg["id"]}).json()
payable = pay_list["items"][0]
assert payable["amount_initial"] == 500000, payable
r3 = s.post(f"{API}/payables/{payable['id']}/payments", json={"amount":200000,"payment_date":"2026-06-20"}).json()
assert r3["status"]=="partial" and r3["amount_remaining"]==300000, r3
print("Partial payment OK, remaining", r3["amount_remaining"])
# Overpay must fail
over = s.post(f"{API}/payables/{payable['id']}/payments", json={"amount":999999,"payment_date":"2026-06-20"})
assert over.status_code==400, over.status_code
print("Overpayment blocked OK")

# Settlement for consignment
stl = s.post(f"{API}/settlements", json={"supplier_id":cons["id"],"period_start":"2026-06-01","period_end":"2026-06-30"}).json()
sid = stl["id"]
det = s.get(f"{API}/settlements/{sid}").json()
item = [i for i in det["items"] if i["product_id"]==pid][0]
print("Settlement item stock_in_period", item["stock_in_period"], "closing", item["closing_stock"], "qty_consumed", item["qty_consumed"])
# finalize should fail (not validated)
f1 = s.post(f"{API}/settlements/{sid}/finalize")
assert f1.status_code==400, f1.status_code
print("Finalize blocked without validation OK")
# validate + set closing 20 (consumed = 0+30-20=10) price 8000
s.patch(f"{API}/settlements/{sid}/items", json={"items":[{"product_id":pid,"closing_stock":20,"settlement_price":8000,"validated":True}]})
f2 = s.post(f"{API}/settlements/{sid}/finalize").json()
print("Settlement finalized, total", f2["total"], "payable_created", f2["payable_created"])
assert f2["total"] == 10*8000, f2
# overlap prevention
ov = s.post(f"{API}/settlements", json={"supplier_id":cons["id"],"period_start":"2026-06-10","period_end":"2026-06-20"})
assert ov.status_code==400, ov.status_code
print("Overlap settlement blocked OK")

# adjustment
adj = s.post(f"{API}/adjustments", json={"product_id":pid,"mode":"delta","value":-5,"reason":"rusak"}).json()
print("Adjustment new_stock", adj["new_stock"])

# negative price blocked
neg = s.post(f"{API}/product-suppliers/{det['items'][0]['product_supplier_id']}/price", json={"price":-1,"effective_from":"2026-07-01"})
print("Negative price status", neg.status_code)

print("\n==== ALL FLOW ASSERTIONS PASSED ====")
