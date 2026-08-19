"""API regression tests for auth, inventory pricing, stock-in, opname, reports, settings, audit, and RBAC."""
import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL", "")).rstrip("/")
API = f"{BASE_URL}/api"
CREDS_PATH = Path("/app/memory/test_credentials.md")

if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")


def _credentials():
    if not CREDS_PATH.exists():
        pytest.skip("Missing /app/memory/test_credentials.md")
    content = CREDS_PATH.read_text(encoding="utf-8")
    email = re.search(r"(?im)^\s*[-*]\s*Email:\s*([^\s]+)", content)
    password = re.search(r"(?im)^\s*[-*]\s*Password:\s*([^\s]+)", content)
    if not email or not password:
        pytest.skip("No admin email/password found in test_credentials.md")
    return email.group(1), password.group(1)


@pytest.fixture(scope="session")
def state():
    suffix = f"{int(time.time())}_{uuid.uuid4().hex[:6]}"
    return {
        "sku": f"TEST_QA_{suffix}",
        "staff_email": f"test_staff_{suffix}@example.com",
        "staff_password": "TEST_StrongPass_2026!",
        "staff_name": "TEST QA Staff",
    }


@pytest.fixture(scope="session")
def admin_client():
    email, password = _credentials()
    session = requests.Session()
    response = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if response.status_code != 200:
        pytest.fail(f"Admin authentication failed: {response.status_code} {response.text[:500]}")
    data = response.json()
    token = data.get("access_token")
    if not token:
        pytest.fail("Login response did not contain access_token")
    session.headers.update({"Authorization": f"Bearer {token}"})
    session.admin_user = data["user"]
    return session


@pytest.fixture(scope="session")
def staff_client(admin_client, state):
    response = admin_client.post(
        f"{API}/users",
        json={
            "email": state["staff_email"],
            "password": state["staff_password"],
            "name": state["staff_name"],
            "role": "staff",
        },
        timeout=30,
    )
    assert response.status_code == 200, response.text
    state["staff_id"] = response.json()["id"]
    login = requests.post(
        f"{API}/auth/login",
        json={"email": state["staff_email"], "password": state["staff_password"]},
        timeout=30,
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}"})
    yield session
    admin_client.delete(f"{API}/users/{state['staff_id']}", timeout=30)


class TestAuthAndSecurity:
    """Login, token, password hash, cookie, CORS, and brute-force controls."""

    def test_admin_login_and_me(self, admin_client):
        assert admin_client.admin_user["email"] == _credentials()[0]
        assert admin_client.admin_user["role"] == "admin"
        response = admin_client.get(f"{API}/auth/me", timeout=30)
        assert response.status_code == 200
        assert response.json()["email"] == _credentials()[0]

    def test_invalid_login_rejected(self):
        response = requests.post(
            f"{API}/auth/login",
            json={"email": "missing_user@example.com", "password": "wrong"},
            timeout=30,
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password"

    def test_login_sets_application_httponly_cookie(self):
        email, password = _credentials()
        response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        assert response.status_code == 200
        cookie = response.cookies.get("access_token")
        assert cookie, "Login must set an application access_token cookie"
        assert "httponly" in response.headers.get("set-cookie", "").lower()

    def test_cors_credentials_and_explicit_origin(self):
        origin = "https://frontend.example.test"
        response = requests.options(
            f"{API}/auth/login",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
            timeout=30,
        )
        assert response.status_code in (200, 204)
        assert response.headers.get("access-control-allow-origin") == origin
        assert response.headers.get("access-control-allow-credentials") == "true"

    def test_brute_force_lockout_after_five_failures(self):
        payload = {"email": f"lockout_{uuid.uuid4().hex}@example.com", "password": "wrong"}
        statuses = [requests.post(f"{API}/auth/login", json=payload, timeout=30).status_code for _ in range(6)]
        assert statuses[:5] == [401] * 5
        assert statuses[5] == 429, f"Expected lockout on sixth attempt, got {statuses}"

    def test_admin_bcrypt_hash_format(self):
        email, _ = _credentials()
        mongo_url = backend_env.get("MONGO_URL")
        db_name = backend_env.get("DB_NAME")
        if not mongo_url or not db_name:
            pytest.skip("Mongo configuration unavailable for hash format verification")
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
        user = client[db_name].users.find_one({"email": email})
        assert user and user["password_hash"].startswith("$2b$")


class TestInventoryAcceptance:
    """Historical pricing, ledger stock, stock-in snapshots, opname reconciliation, and reports."""

    def test_01_create_sku_and_verify(self, admin_client, state):
        payload = {
            "sku": state["sku"],
            "name": "TEST Historical Price Product",
            "type": "TEST Type",
            "supplier": "TEST Supplier",
            "current_purchase_price": 1000,
            "minimum_stock": 5,
            "price_effective_from": "2026-01-01",
        }
        response = admin_client.post(f"{API}/products", json=payload, timeout=30)
        assert response.status_code == 200, response.text
        product = response.json()
        state["product_id"] = product["id"]
        assert product["sku"] == state["sku"]
        assert product["current_stock"] == 0
        detail = admin_client.get(f"{API}/products/{product['id']}", timeout=30)
        assert detail.status_code == 200
        assert detail.json()["current_purchase_price"] == 1000
        history = admin_client.get(f"{API}/products/{product['id']}/price-history", timeout=30).json()
        assert any(h["effective_from"] == "2026-01-01" and h["price"] == 1000 for h in history)

    def test_02_stock_in_uses_price_effective_on_transaction_date(self, admin_client, state):
        pid = state["product_id"]
        update = admin_client.post(
            f"{API}/products/{pid}/price",
            json={"price": 1200, "effective_from": "2026-02-01"},
            timeout=30,
        )
        assert update.status_code == 200
        jan = admin_client.post(
            f"{API}/stock-in",
            json={"transaction_date": "2026-01-15", "items": [{"sku": state["sku"], "quantity": 10}]},
            timeout=30,
        )
        feb = admin_client.post(
            f"{API}/stock-in",
            json={"transaction_date": "2026-02-15", "items": [{"sku": state["sku"], "quantity": 5}]},
            timeout=30,
        )
        assert jan.status_code == feb.status_code == 200
        assert jan.json()["items"][0]["purchase_price"] == 1000
        assert feb.json()["items"][0]["purchase_price"] == 1200
        state["jan_txn_id"] = jan.json()["transaction"]["id"]
        product = admin_client.get(f"{API}/products/{pid}", timeout=30).json()
        assert product["current_stock"] == 15

    def test_03_bulk_validation_flags_unknown_and_blocks_mixed_commit(self, admin_client, state):
        body = {
            "transaction_date": "2026-02-20",
            "rows": [{"sku": state["sku"], "quantity": 2}, {"sku": "TEST_UNKNOWN_SKU", "quantity": 1}],
        }
        validation = admin_client.post(f"{API}/stock-in/bulk/validate", json=body, timeout=30)
        assert validation.status_code == 200
        data = validation.json()
        assert data["valid_count"] == 1 and data["error_count"] == 1
        assert data["preview"][1]["status"] == "error"
        commit = admin_client.post(
            f"{API}/stock-in",
            json={"transaction_date": body["transaction_date"], "items": body["rows"]},
            timeout=30,
        )
        assert commit.status_code == 400
        assert "validation errors" in commit.json()["detail"]

    def test_04_price_change_does_not_revalue_historical_stock_in(self, admin_client, state):
        pid = state["product_id"]
        response = admin_client.post(
            f"{API}/products/{pid}/price",
            json={"price": 1500, "effective_from": "2026-03-01"},
            timeout=30,
        )
        assert response.status_code == 200
        report = admin_client.get(
            f"{API}/reports/stock-in-value",
            params={"date_from": "2026-01-01", "date_to": "2026-02-28"},
            timeout=30,
        )
        assert report.status_code == 200
        rows = [r for r in report.json()["rows"] if r["sku"] == state["sku"]]
        assert {(r["date"], r["purchase_price"], r["total"]) for r in rows} == {
            ("2026-01-15", 1000, 10000),
            ("2026-02-15", 1200, 6000),
        }
        product = admin_client.get(f"{API}/products/{pid}", timeout=30).json()
        assert product["current_purchase_price"] == 1500
        assert product["current_inventory_value"] == 15 * 1500

    def test_05_create_opname_captures_snapshot_and_incomplete_requires_override(self, admin_client, state):
        response = admin_client.post(
            f"{API}/opname",
            json={"opname_date": "2026-03-10", "snapshot_time": "08:00", "note": "TEST acceptance"},
            timeout=30,
        )
        assert response.status_code == 200
        state["opname_id"] = response.json()["id"]
        detail = admin_client.get(f"{API}/opname/{state['opname_id']}", timeout=30).json()
        item = next(i for i in detail["items"] if i["sku"] == state["sku"])
        assert item["system_stock"] == 15
        state["opname_product_id"] = item["product_id"]
        denied = admin_client.post(
            f"{API}/opname/{state['opname_id']}/finalize",
            json={"override_incomplete": False},
            timeout=30,
        )
        assert denied.status_code == 400
        assert "administrator can override" in denied.json()["detail"]

    def test_06_save_counts_finalize_and_lock(self, admin_client, state):
        oid = state["opname_id"]
        save = admin_client.patch(
            f"{API}/opname/{oid}/counts",
            json={"counts": [{"product_id": state["product_id"], "physical_stock": 12}]},
            timeout=30,
        )
        assert save.status_code == 200
        assert save.json()["counted_items"] == 1
        detail = admin_client.get(f"{API}/opname/{oid}", timeout=30).json()
        item = next(i for i in detail["items"] if i["sku"] == state["sku"])
        assert item["difference"] == -3
        finalized = admin_client.post(
            f"{API}/opname/{oid}/finalize", json={"override_incomplete": True}, timeout=30
        )
        assert finalized.status_code == 200
        assert finalized.json()["session"]["status"] == "finalized"
        assert finalized.json()["adjustments_created"] == 1
        product = admin_client.get(f"{API}/products/{state['product_id']}", timeout=30).json()
        assert product["current_stock"] == 12
        assert product["current_inventory_value"] == 12 * 1500
        edit = admin_client.patch(
            f"{API}/opname/{oid}/counts",
            json={"counts": [{"product_id": state["product_id"], "physical_stock": 99}]},
            timeout=30,
        )
        assert edit.status_code == 400
        assert "cannot be edited" in edit.json()["detail"]

    def test_07_history_and_all_reports(self, admin_client, state):
        history = admin_client.get(f"{API}/movements", params={"search": state["sku"], "page_size": 100}, timeout=30)
        assert history.status_code == 200
        movements = history.json()["items"]
        assert any(m["movement_type"] == "STOCK_IN" and m["quantity"] == 10 for m in movements)
        assert any(m["movement_type"] == "OPNAME_ADJUSTMENT" and m["quantity"] == -3 for m in movements)
        movement_detail = admin_client.get(f"{API}/movements/{movements[0]['id']}", timeout=30)
        assert movement_detail.status_code == 200
        assert movement_detail.json()["sku"] == state["sku"]

        summary = admin_client.get(
            f"{API}/reports/inventory-summary",
            params={"date_from": "2026-01-01", "date_to": "2026-03-31"}, timeout=30
        )
        stock_movement = admin_client.get(
            f"{API}/reports/stock-movement",
            params={"date_from": "2026-01-01", "date_to": "2026-03-31"}, timeout=30
        )
        stock_value = admin_client.get(
            f"{API}/reports/stock-in-value",
            params={"date_from": "2026-01-01", "date_to": "2026-03-31"}, timeout=30
        )
        low_stock = admin_client.get(f"{API}/reports/low-stock", timeout=30)
        assert all(r.status_code == 200 for r in (summary, stock_movement, stock_value, low_stock))
        summary_row = next(r for r in summary.json()["rows"] if r["sku"] == state["sku"])
        assert summary_row["stock_in"] == 15 and summary_row["adjustment"] == -3 and summary_row["closing"] == 12
        assert any(r["sku"] == state["sku"] for r in stock_movement.json()["rows"])
        value_rows = [r for r in stock_value.json()["rows"] if r["sku"] == state["sku"]]
        assert sum(r["total"] for r in value_rows) == 16000
        assert isinstance(low_stock.json()["rows"], list)

    def test_08_deactivated_sku_excluded_from_new_opname(self, admin_client, state):
        deactivated = admin_client.post(f"{API}/products/{state['product_id']}/deactivate", timeout=30)
        assert deactivated.status_code == 200 and deactivated.json()["ok"] is True
        product = admin_client.get(f"{API}/products/{state['product_id']}", timeout=30).json()
        assert product["is_active"] is False
        new_session = admin_client.post(
            f"{API}/opname",
            json={"opname_date": "2026-03-11", "snapshot_time": "08:00", "note": "TEST inactive exclusion"},
            timeout=30,
        )
        assert new_session.status_code == 200
        state["inactive_opname_id"] = new_session.json()["id"]
        items = admin_client.get(f"{API}/opname/{state['inactive_opname_id']}", timeout=30).json()["items"]
        assert state["sku"] not in {i["sku"] for i in items}


class TestSettingsUsersAndRBAC:
    """Admin settings/users/audit and staff authorization restrictions."""

    def test_01_staff_login_and_allowed_reads(self, staff_client, state):
        me = staff_client.get(f"{API}/auth/me", timeout=30)
        products = staff_client.get(f"{API}/products", timeout=30)
        reports = staff_client.get(f"{API}/reports/low-stock", timeout=30)
        assert me.status_code == products.status_code == reports.status_code == 200
        assert me.json()["role"] == "staff"
        assert isinstance(products.json()["items"], list)

    def test_02_staff_forbidden_admin_endpoints(self, staff_client, state):
        forbidden = [
            staff_client.get(f"{API}/users", timeout=30),
            staff_client.get(f"{API}/audit", timeout=30),
            staff_client.patch(f"{API}/settings", json={"business_name": "TEST forbidden"}, timeout=30),
            staff_client.post(
                f"{API}/products",
                json={"sku": f"{state['sku']}_FORBIDDEN", "name": "Forbidden"}, timeout=30
            ),
            staff_client.post(
                f"{API}/products/nonexistent-test-product/price",
                json={"price": 9999, "effective_from": "2026-04-01"}, timeout=30
            ),
            staff_client.post(f"{API}/products/nonexistent-test-product/deactivate", timeout=30),
        ]
        assert [r.status_code for r in forbidden] == [403] * len(forbidden)
        assert all("Administrator access required" in r.json()["detail"] for r in forbidden)

    def test_03_staff_cannot_override_incomplete_opname(self, admin_client, staff_client):
        created = admin_client.post(
            f"{API}/opname",
            json={"opname_date": "2026-03-12", "snapshot_time": "08:00", "note": "TEST staff override RBAC"},
            timeout=30,
        )
        assert created.status_code == 200
        response = staff_client.post(
            f"{API}/opname/{created.json()['id']}/finalize",
            json={"override_incomplete": True}, timeout=30
        )
        assert response.status_code == 403
        assert "Only an administrator" in response.json()["detail"]

    def test_04_admin_settings_save_restore_and_audit(self, admin_client):
        before = admin_client.get(f"{API}/settings", timeout=30)
        assert before.status_code == 200
        settings = before.json()
        marker = settings["business_name"] + " TEST"
        changed = admin_client.patch(f"{API}/settings", json={"business_name": marker}, timeout=30)
        assert changed.status_code == 200 and changed.json()["business_name"] == marker
        persisted = admin_client.get(f"{API}/settings", timeout=30)
        assert persisted.json()["business_name"] == marker
        restored = admin_client.patch(
            f"{API}/settings", json={"business_name": settings["business_name"]}, timeout=30
        )
        assert restored.status_code == 200 and restored.json()["business_name"] == settings["business_name"]
        audit = admin_client.get(f"{API}/audit", timeout=30)
        assert audit.status_code == 200
        assert audit.json()["total"] > 0
        assert any(a["action"] == "settings_change" for a in audit.json()["items"])


class TestValidationEdges:
    """Critical invalid-input handling for inventory integrity."""

    def test_negative_physical_count_rejected(self, admin_client, state):
        product = admin_client.post(
            f"{API}/products",
            json={
                "sku": f"{state['sku']}_EDGE",
                "name": "TEST Validation Edge Product",
                "current_purchase_price": 100,
                "minimum_stock": 1,
                "price_effective_from": "2026-01-01",
            },
            timeout=30,
        )
        assert product.status_code == 200, product.text
        state["edge_product_id"] = product.json()["id"]
        session = admin_client.post(
            f"{API}/opname",
            json={"opname_date": "2026-04-01", "snapshot_time": "08:00", "note": "TEST validation"},
            timeout=30,
        )
        assert session.status_code == 200
        response = admin_client.patch(
            f"{API}/opname/{session.json()['id']}/counts",
            json={"counts": [{"product_id": state["edge_product_id"], "physical_stock": -1}]},
            timeout=30,
        )
        assert response.status_code in (400, 422)

    def test_negative_product_price_rejected(self, admin_client, state):
        pid = state.get("edge_product_id")
        if not pid:
            pytest.fail("Validation test product was not created")
        response = admin_client.post(
            f"{API}/products/{pid}/price",
            json={"price": -1, "effective_from": "2026-05-01"}, timeout=30
        )
        admin_client.post(f"{API}/products/{pid}/deactivate", timeout=30)
        assert response.status_code in (400, 422)
