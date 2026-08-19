import requests
API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {s.post(f'{API}/auth/login', json={'email':'admin@bumeecorp.com','password':'bumeebola2023'}).json()['access_token']}"})

cons = s.post(f"{API}/suppliers", json={"name":"Konsinyasi Uji","type":"consignment"}).json()
# product create now requires supplier
p = s.post(f"{API}/products", json={"sku":"OPD-TST-1","name":"Produk Opname","type":"Uji","minimum_stock":5,"supplier_id":cons["id"],"price":10000,"price_effective_from":"2026-06-01"})
assert p.status_code==200, (p.status_code, p.text)
pid = p.json()["id"]
# create without supplier must fail
bad = s.post(f"{API}/products", json={"sku":"OPD-BAD","name":"x"})
assert bad.status_code==422, bad.status_code
print("Product create requires supplier OK")

# stock in consignment 100
s.post(f"{API}/stock-in", json={"transaction_date":"2026-06-05","supplier_id":cons["id"],"items":[{"product_id":pid,"quantity":100}]}).raise_for_status()
assert s.get(f"{API}/products/{pid}").json()["current_stock"]==100
# daily opname: physical 70 -> keluar 30 -> debt 30*10000=300000
r = s.post(f"{API}/opname-daily", json={"supplier_id":cons["id"],"opname_date":"2026-06-06","items":[{"product_id":pid,"physical_stock":70}]}).json()
assert r["total_out_qty"]==30 and r["payable_created"] and r["total_out_value"]==300000, r
assert s.get(f"{API}/products/{pid}").json()["current_stock"]==70
print("Consignment opname: stock->70, debt 300k created OK")

# regular supplier opname should NOT create debt
reg = s.post(f"{API}/suppliers", json={"name":"Reg Uji OPD","type":"regular"}).json()
p2 = s.post(f"{API}/products", json={"sku":"OPD-TST-2","name":"Produk Reg","supplier_id":reg["id"],"price":5000,"price_effective_from":"2026-06-01"}).json()
pid2 = p2["id"]
s.post(f"{API}/stock-in", json={"transaction_date":"2026-06-05","supplier_id":reg["id"],"items":[{"product_id":pid2,"quantity":50}]}).raise_for_status()
r2 = s.post(f"{API}/opname-daily", json={"supplier_id":reg["id"],"opname_date":"2026-06-06","items":[{"product_id":pid2,"physical_stock":40}]}).json()
assert r2["total_out_qty"]==10 and not r2["payable_created"], r2
assert s.get(f"{API}/products/{pid2}").json()["current_stock"]==40
print("Regular opname: stock->40, NO debt OK")

# Bulk FIFO payment: consignment supplier has multiple invoices. Add another opname to make 2 invoices.
s.post(f"{API}/stock-in", json={"transaction_date":"2026-06-07","supplier_id":cons["id"],"items":[{"product_id":pid,"quantity":50}]}).raise_for_status()  # stock 70->120
s.post(f"{API}/opname-daily", json={"supplier_id":cons["id"],"opname_date":"2026-06-08","items":[{"product_id":pid,"physical_stock":100}]}).json()  # keluar 20 -> debt 200000
summ = s.get(f"{API}/payables-summary").json()["rows"]
cons_sum = [x for x in summ if x["supplier_id"]==cons["id"]][0]
print("Consignment total hutang:", cons_sum["total_remaining"], "invoices:", cons_sum["invoice_count"])
assert cons_sum["total_remaining"]==500000 and cons_sum["invoice_count"]==2
# pay 400000 -> oldest (300k) paid, next (200k) partial 100k -> remaining 100k
s.post(f"{API}/payables/bulk-payment", json={"payments":[{"supplier_id":cons["id"],"amount":400000,"payment_date":"2026-06-10"}]}).raise_for_status()
summ2 = s.get(f"{API}/payables-summary").json()["rows"]
cons2 = [x for x in summ2 if x["supplier_id"]==cons["id"]]
rem = cons2[0]["total_remaining"] if cons2 else 0
print("After bulk 400k, remaining:", rem)
assert rem==100000, rem
# overpay must fail
over = s.post(f"{API}/payables/bulk-payment", json={"payments":[{"supplier_id":cons["id"],"amount":999999,"payment_date":"2026-06-10"}]})
assert over.status_code==400, over.status_code
print("Bulk FIFO payment + overpay block OK")

# cleanup
from pymongo import MongoClient
db = MongoClient('mongodb://localhost:27017')['test_database']
for x in ['OPD-TST-1','OPD-TST-2']:
    pr=db.products.find_one({'sku':x})
    if pr:
        db.products.delete_one({'id':pr['id']}); db.inventory_movements.delete_many({'product_id':pr['id']}); db.price_history.delete_many({'product_id':pr['id']}); db.product_suppliers.delete_many({'product_id':pr['id']}); db.stock_in_items.delete_many({'product_id':pr['id']})
for n in ['Konsinyasi Uji','Reg Uji OPD']:
    su=db.suppliers.find_one({'name':n})
    if su:
        db.suppliers.delete_one({'id':su['id']}); db.payables.delete_many({'supplier_id':su['id']}); db.payments.delete_many({'supplier_id':su['id']}); db.stock_in_transactions.delete_many({'supplier_id':su['id']}); db.opname_daily.delete_many({'supplier_id':su['id']})
print("\n==== NEW FEATURES ALL PASSED ====")
