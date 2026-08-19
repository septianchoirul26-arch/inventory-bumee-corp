import requests, random
API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
s = requests.Session()
tok = s.post(f"{API}/auth/login", json={"email":"admin@bumeecorp.com","password":"bumeebola2023"}).json()["access_token"]
s.headers.update({"Authorization": f"Bearer {tok}"})

products = [
    ("F001","Molten V5000 Hijau","Futsal Lokal","Supplier A",55000,20),
    ("F002","Molten V300 Kuning","Futsal Lokal","Supplier A",45000,20),
    ("F003","Molten V200 Biru","Futsal Lokal","Supplier B",38000,15),
    ("F004","Molten V100 Merah","Futsal Import","Supplier B",30000,25),
    ("V5000-ORG-4","Molten V5000 Orange","Futsal Import","Supplier C",57000,10),
    ("BSK-01","Spalding NBA Basket","Basket","Supplier C",120000,8),
    ("BSK-02","Molten GG7X Basket","Basket","Supplier A",95000,12),
    ("VOL-01","Mikasa V200W Voli","Voli","Supplier B",85000,10),
    ("VOL-02","Molten V5M Voli","Voli","Supplier C",65000,10),
    ("ACC-NET-1","Jaring Gawang Futsal","Aksesoris","Supplier D",45000,30),
]
created = {}
for sku,name,typ,sup,price,minst in products:
    r = s.post(f"{API}/products", json={"sku":sku,"name":name,"type":typ,"supplier":sup,"current_purchase_price":price,"minimum_stock":minst,"price_effective_from":"2026-06-01"})
    if r.status_code==200:
        created[sku]=r.json()["id"]

# Stock in across dates
for d,items in [
    ("2026-06-02",[("F001",100),("F002",80),("F003",40),("F004",100),("BSK-01",20)]),
    ("2026-06-05",[("V5000-ORG-4",50),("BSK-02",30),("VOL-01",25),("VOL-02",25),("ACC-NET-1",60)]),
    ("2026-06-10",[("F001",50),("F003",30),("BSK-01",10)]),
]:
    s.post(f"{API}/stock-in", json={"transaction_date":d,"items":[{"sku":k,"quantity":q} for k,q in items]})

# Make some low/critical by an opname reducing stock
op = s.post(f"{API}/opname", json={"opname_date":"2026-06-12","snapshot_time":"08:00"}).json()
oid = op["id"]
items = s.get(f"{API}/opname/{oid}").json()["items"]
reduce = {"F004":15,"BSK-02":5,"VOL-01":8,"ACC-NET-1":10}
counts=[]
for it in items:
    if it["sku"] in reduce:
        counts.append({"product_id":it["product_id"],"physical_stock":reduce[it["sku"]]})
    else:
        counts.append({"product_id":it["product_id"],"physical_stock":it["system_stock"]})
s.patch(f"{API}/opname/{oid}/counts", json={"counts":counts})
s.post(f"{API}/opname/{oid}/finalize", json={"override_incomplete":True})
print("Seeded", len(created), "products with stock and one finalized opname")
