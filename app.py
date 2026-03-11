import os
import sys
import json
import threading
import requests
import datetime
import csv
from flask import Flask, render_template, jsonify, request, abort

# ── PyInstaller path resolution ──────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    TEMPLATE_DIR = os.path.join(sys._MEIPASS, 'templates')
    STATIC_DIR   = os.path.join(sys._MEIPASS, 'static')
    app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)
else:
    app = Flask(__name__)

# Always write data to AppData — works for both dev and installed
BASE_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'UniversalSHTools')
os.makedirs(BASE_DIR, exist_ok=True)

# ── Active credentials (driven entirely by profiles) ─────────────────────────
active_creds = {
    "SHOPIFY_STORE_URL":    "",
    "SHOPIFY_ACCESS_TOKEN": "",
    "SHOPIFY_API_VERSION":  "2024-07",
    "METAFIELD_NAMESPACE":  "",
    "METAFIELD_KEY":        "",
}

def SHOPIFY_STORE_URL():    return active_creds["SHOPIFY_STORE_URL"]
def SHOPIFY_ACCESS_TOKEN(): return active_creds["SHOPIFY_ACCESS_TOKEN"]
def SHOPIFY_API_VERSION():  return active_creds["SHOPIFY_API_VERSION"]
def METAFIELD_NAMESPACE():  return active_creds["METAFIELD_NAMESPACE"]
def METAFIELD_KEY():        return active_creds["METAFIELD_KEY"]

def _apply_profile(p):
    active_creds["SHOPIFY_STORE_URL"]    = p["store_url"]
    active_creds["SHOPIFY_ACCESS_TOKEN"] = p["access_token"]
    active_creds["SHOPIFY_API_VERSION"]  = p.get("api_version", "2024-07")
    active_creds["METAFIELD_NAMESPACE"]  = p.get("metafield_namespace", "")
    active_creds["METAFIELD_KEY"]        = p.get("metafield_key", "")

def _clear_creds():
    active_creds["SHOPIFY_STORE_URL"]    = ""
    active_creds["SHOPIFY_ACCESS_TOKEN"] = ""
    active_creds["SHOPIFY_API_VERSION"]  = "2024-07"
    active_creds["METAFIELD_NAMESPACE"]  = ""
    active_creds["METAFIELD_KEY"]        = ""

# ── Auto-load the active profile on startup ───────────────────────────────────
PROFILES_FILE = os.path.join(BASE_DIR, 'profiles.json')

def boot_active_profile():
    if not os.path.exists(PROFILES_FILE):
        print("[STARTUP] No profiles.json found — waiting for user to add a profile.")
        return
    try:
        with open(PROFILES_FILE, 'r') as f:
            data = json.load(f)
        active_id = data.get("active")
        if not active_id:
            print("[STARTUP] No active profile set.")
            return
        profile = next((p for p in data.get("profiles", []) if p["id"] == active_id), None)
        if profile:
            _apply_profile(profile)
            print(f"[STARTUP] Loaded profile: {profile['name']} ({profile['store_url']})")
        else:
            print("[STARTUP] Active profile ID not found in profiles list.")
    except Exception as e:
        print(f"[STARTUP] Failed to load profile: {e}")

print(f"[STARTUP] BASE_DIR: {BASE_DIR}")

# ── Stock App Config ─────────────────────────────────────────────────────────
STOCK_CATEGORIES = {
    "simple":   {"tag": "HJMQS",  "title": "Simple"},
    "2-button": {"tag": "HJMQ2B", "title": "2 Button"},
    "7-button": {"tag": "HJMQ7B", "title": "7 Button"},
    "quilt":    {"tag": "HJMQQ",  "title": "Quilt"},
    "bednet":   {"tag": "HJMQBN", "title": "Bed Net"},
    "7pcs":     {"tag": "HJMQ7P", "title": "7 Pcs"},
}

def get_headers():
    return {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN(),
        "Content-Type": "application/json"
    }

def credentials_ok():
    return bool(SHOPIFY_STORE_URL() and SHOPIFY_ACCESS_TOKEN())

# ════════════════════════════════════════════════════════════════════════════
# STORE PROFILES
# ════════════════════════════════════════════════════════════════════════════

def load_profiles():
    if os.path.exists(PROFILES_FILE):
        try:
            with open(PROFILES_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {"active": None, "profiles": []}

def save_profiles(data):
    with open(PROFILES_FILE, 'w') as f:
        json.dump(data, f, indent=2)

@app.route('/api/profiles', methods=['GET'])
def get_profiles():
    data = load_profiles()
    safe = []
    for p in data.get('profiles', []):
        safe.append({
            "id":                  p["id"],
            "name":                p["name"],
            "store_url":           p["store_url"],
            "api_version":         p.get("api_version", "2024-07"),
            "metafield_namespace": p.get("metafield_namespace", ""),
            "metafield_key":       p.get("metafield_key", ""),
            "token_set":           bool(p.get("access_token")),
        })
    return jsonify({"active": data.get("active"), "profiles": safe})

@app.route('/api/profiles', methods=['POST'])
def create_profile():
    import uuid
    body = request.get_json()
    data = load_profiles()
    new_profile = {
        "id":                  str(uuid.uuid4()),
        "name":                body.get("name", "New Store"),
        "store_url":           body.get("store_url", "").strip().rstrip('/'),
        "access_token":        body.get("access_token", "").strip(),
        "api_version":         body.get("api_version", "2024-07").strip(),
        "metafield_namespace": body.get("metafield_namespace", "").strip(),
        "metafield_key":       body.get("metafield_key", "").strip(),
    }
    data["profiles"].append(new_profile)
    if not data.get("active"):
        data["active"] = new_profile["id"]
        _apply_profile(new_profile)
    save_profiles(data)
    return jsonify({"success": True, "id": new_profile["id"]})

@app.route('/api/profiles/<profile_id>', methods=['PUT'])
def update_profile(profile_id):
    body = request.get_json()
    data = load_profiles()
    for p in data["profiles"]:
        if p["id"] == profile_id:
            p["name"]                = body.get("name", p["name"])
            p["store_url"]           = body.get("store_url", p["store_url"]).strip().rstrip('/')
            p["api_version"]         = body.get("api_version", p.get("api_version", "2024-07")).strip()
            p["metafield_namespace"] = body.get("metafield_namespace", p.get("metafield_namespace", "")).strip()
            p["metafield_key"]       = body.get("metafield_key", p.get("metafield_key", "")).strip()
            if body.get("access_token", "").strip():
                p["access_token"] = body.get("access_token").strip()
            if data.get("active") == profile_id:
                _apply_profile(p)
            break
    save_profiles(data)
    return jsonify({"success": True})

@app.route('/api/profiles/<profile_id>', methods=['DELETE'])
def delete_profile(profile_id):
    data = load_profiles()
    data["profiles"] = [p for p in data["profiles"] if p["id"] != profile_id]
    if data.get("active") == profile_id:
        if data["profiles"]:
            data["active"] = data["profiles"][0]["id"]
            _apply_profile(data["profiles"][0])
        else:
            data["active"] = None
            _clear_creds()
    save_profiles(data)
    return jsonify({"success": True})

@app.route('/api/profiles/<profile_id>/activate', methods=['POST'])
def activate_profile(profile_id):
    data = load_profiles()
    profile = next((p for p in data["profiles"] if p["id"] == profile_id), None)
    if not profile:
        return jsonify({"success": False, "error": "Profile not found"}), 404
    data["active"] = profile_id
    _apply_profile(profile)
    save_profiles(data)
    return jsonify({"success": True, "store_url": profile["store_url"], "name": profile["name"]})

# ── Shared: fetch order with inventory data ──────────────────────────────────
def fetch_order_data(order_identifier):
    if not credentials_ok():
        return None, "No store profile active. Use the Store button in the nav to add one.", 500

    headers = get_headers()
    shopify_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders.json"
    params = {"status": "any"}
    is_tracking_search = not (order_identifier.isdigit() or order_identifier.startswith("#"))
    if not is_tracking_search:
        params["name"] = f"#{order_identifier}" if not str(order_identifier).startswith("#") else order_identifier

    response = requests.get(shopify_url, headers=headers, params=params)
    response.raise_for_status()
    orders = response.json().get("orders", [])

    order = None
    if is_tracking_search:
        for o in orders:
            if any(order_identifier == f.get("tracking_number") for f in o.get("fulfillments", [])):
                order = o
                break
    elif orders:
        order = orders[0]

    if not order:
        return None, "Order not found", 404

    line_items = []
    image_cache = {}
    variant_cache = {}

    for item in order.get('line_items', []):
        product_id = item.get('product_id')
        variant_id = item.get('variant_id')
        inventory_item_id = None
        available_quantity = 0
        in_stock = False

        if variant_id:
            if variant_id in variant_cache:
                inventory_item_id = variant_cache[variant_id]
            else:
                variant_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/variants/{variant_id}.json"
                variant_resp = requests.get(variant_url, headers=headers)
                if variant_resp.status_code == 200:
                    variant_data = variant_resp.json().get("variant", {})
                    inventory_item_id = variant_data.get("inventory_item_id")
                    variant_cache[variant_id] = inventory_item_id

        if inventory_item_id:
            inventory_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/inventory_levels.json"
            inv_params = {"inventory_item_ids": [str(inventory_item_id)]}
            try:
                inv_resp = requests.get(inventory_url, headers=headers, params=inv_params)
                inv_resp.raise_for_status()
                levels = inv_resp.json().get("inventory_levels", [])
                if levels:
                    available_quantity = sum(l.get("available", 0) for l in levels if l.get("available") is not None)
                    in_stock = available_quantity > 0
            except Exception:
                pass

        if product_id and product_id not in image_cache:
            product_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/products/{product_id}.json?fields=images"
            prod_resp = requests.get(product_url, headers=headers)
            if prod_resp.status_code == 200:
                product_data = prod_resp.json().get("product")
                if product_data and product_data.get("images"):
                    image_url = next((img["src"] for img in product_data["images"] if variant_id in img.get("variant_ids", [])), None)
                    if not image_url:
                        image_url = product_data["images"][0].get("src")
                    image_cache[product_id] = image_url

        properties = item.get('properties', [])
        customized_name = next(
            (p.get('value') for p in properties if p.get('name', '').lower() in ('customized name', 'custom name', 'name', 'personalization')),
            None
        )

        line_items.append({
            "product_id":         product_id,
            "variant_id":         variant_id,
            "title":              item.get('title'),
            "quantity":           item.get('quantity'),
            "sku":                item.get('sku'),
            "size":               item.get('variant_title'),
            "product_image":      image_cache.get(product_id),
            "in_stock":           in_stock,
            "available_quantity": available_quantity,
            "customized_name":    customized_name
        })

    return {
        "order_id":           order.get('id'),
        "order_name":         order.get('name'),
        "line_items":         line_items,
        "fulfillment_status": order.get('fulfillment_status'),
        "tags":               order.get('tags', ''),
        "city":               (order.get('shipping_address') or {}).get('city', ''),
        "total_price":        order.get('total_price', '0'),
    }, None, 200

# ════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ════════════════════════════════════════════════════════════════════════════

@app.route('/')
def home():
    return render_template('dashboard.html', active_page='dashboard')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html', active_page='dashboard')

@app.route('/api/dashboard', methods=['GET'])
def api_dashboard():
    result = {
        'packed_today':        0,
        'returned_today':      0,
        'earnings_today':      0,
        'earnings_entry_count': 0,
        'urgent_count':        0,
        'urgent_items':        [],
    }

    today_str = datetime.date.today().strftime('%d-%m-%Y')
    today_iso = datetime.date.today().isoformat()

    if credentials_ok():
        try:
            headers     = get_headers()
            shopify_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders.json"
            packed_tag  = f"Packed {today_str}"
            resp = requests.get(shopify_url, headers=headers, params={
                'tag': packed_tag, 'status': 'any', 'fields': 'id', 'limit': 250,
            })
            if resp.status_code == 200:
                result['packed_today'] = len(resp.json().get('orders', []))
        except Exception as e:
            print(f"[DASHBOARD] packed_today error: {e}")

        try:
            resp = requests.get(shopify_url, headers=headers, params={
                'tag': 'Returned', 'status': 'any', 'fields': 'id,updated_at',
                'limit': 250, 'updated_at_min': f"{today_iso}T00:00:00+00:00",
            })
            if resp.status_code == 200:
                result['returned_today'] = len(resp.json().get('orders', []))
        except Exception as e:
            print(f"[DASHBOARD] returned_today error: {e}")

        try:
            all_tags         = [cat["tag"] for cat in STOCK_CATEGORIES.values()]
            tag_query_string = " OR ".join([f"tag:'{tag}'" for tag in all_tags])
            gql_query = f"""
            {{
              products(first: 250, query: "({tag_query_string})") {{
                edges {{
                  node {{
                    title
                    variants(first: 1) {{
                      edges {{ node {{ inventoryQuantity }} }}
                    }}
                  }}
                }}
              }}
            }}
            """
            gql_data = run_graphql_query(gql_query)
            if gql_data and 'errors' not in gql_data:
                urgent = []
                for edge in gql_data.get('data', {}).get('products', {}).get('edges', []):
                    node = edge['node']
                    if node['variants']['edges']:
                        qty = node['variants']['edges'][0]['node']['inventoryQuantity']
                        if qty < 0:
                            urgent.append({'title': node['title'], 'current_qty': qty, 'needed_qty': abs(qty)})
                urgent.sort(key=lambda p: p['needed_qty'], reverse=True)
                result['urgent_items'] = urgent
                result['urgent_count'] = len(urgent)
        except Exception as e:
            print(f"[DASHBOARD] urgent stock error: {e}")

    try:
        acc_data = load_accountant_data()
        today_entries = [e for e in acc_data.get('entries', []) if e.get('date') == today_iso]
        result['earnings_today']       = sum(e.get('earnings', 0) for e in today_entries)
        result['earnings_entry_count'] = len(today_entries)
    except Exception as e:
        print(f"[DASHBOARD] earnings error: {e}")

    return jsonify(result)

@app.route('/scanpack')
def scanpack():
    return render_template('index.html', active_page='scan')

@app.route('/markpaid')
def markpaid():
    return render_template('bulk_mark.html', active_page='paid')

@app.route('/returned')
def returned():
    return render_template('returned.html', active_page='returned')

# ════════════════════════════════════════════════════════════════════════════
# SCAN AND PACK API
# ════════════════════════════════════════════════════════════════════════════

@app.route('/api/get_order/<order_identifier>', methods=['GET'])
def get_order(order_identifier):
    try:
        data, error, status = fetch_order_data(order_identifier)
        if error:
            return jsonify({"error": error}), status
        return jsonify(data)
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/fulfill_order/<order_id>', methods=['POST'])
def tag_order_as_packed(order_id):
    if not credentials_ok():
        return jsonify({"error": "No store profile active."}), 500
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders/{order_id}.json"
    try:
        response = requests.get(order_url, headers=headers, params={"fields": "tags"})
        response.raise_for_status()
        order = response.json().get('order')
        existing_tags = order.get("tags", "")
        today = datetime.date.today().strftime("%d-%m-%Y")
        packed_tag = f"Packed {today}"
        updated_tags = f"{existing_tags}, {packed_tag}".strip(", ")
        update_response = requests.put(order_url, headers=headers, json={"order": {"id": order_id, "tags": updated_tags}})
        update_response.raise_for_status()
        return jsonify({"message": "Order tagged successfully", "tag": packed_tag})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

# ════════════════════════════════════════════════════════════════════════════
# MARK AS PAID API
# ════════════════════════════════════════════════════════════════════════════

@app.route('/api/get_order_mark_paid/<order_identifier>', methods=['GET'])
def get_order_mark_paid(order_identifier):
    try:
        data, error, status = fetch_order_data(order_identifier)
        if error:
            return jsonify({"error": error}), status
        return jsonify(data)
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/check_order_csv/<order_identifier>', methods=['GET'])
def check_order_csv(order_identifier):
    if not credentials_ok():
        return jsonify({"error": "No store profile active.", "found": False}), 500
    headers = get_headers()
    shopify_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders.json"
    clean = order_identifier.strip().lstrip('#')
    params = {
        "name":   f"#{clean}",
        "status": "any",
        "fields": "id,name,tags,financial_status,total_price,shipping_address"
    }
    try:
        resp = requests.get(shopify_url, headers=headers, params=params)
        if resp.status_code == 429:
            import time
            time.sleep(1)
            resp = requests.get(shopify_url, headers=headers, params=params)
        resp.raise_for_status()
        orders = resp.json().get("orders", [])
        if not orders:
            return jsonify({"found": False, "error": "Order not found"}), 404
        o = orders[0]
        return jsonify({
            "found":            True,
            "order_id":         o.get("id"),
            "order_name":       o.get("name"),
            "tags":             o.get("tags", ""),
            "financial_status": o.get("financial_status", ""),
            "total_price":      o.get("total_price", "0"),
            "city":             (o.get("shipping_address") or {}).get("city", ""),
        })
    except requests.exceptions.HTTPError as e:
        return jsonify({"found": False, "error": f"Shopify API error: {e.response.status_code}"}), e.response.status_code
    except Exception as e:
        return jsonify({"found": False, "error": str(e)}), 500

@app.route('/api/tag_order', methods=['POST'])
def tag_order_as_paid():
    if not credentials_ok():
        return jsonify({"error": "No store profile active."}), 500
    data = request.get_json()
    order_id = data.get('order_id')
    if not order_id:
        return jsonify({"error": "order_id is required"}), 400
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders/{order_id}.json"
    try:
        response = requests.get(order_url, headers=headers, params={"fields": "tags"})
        response.raise_for_status()
        order = response.json().get('order')
        existing_tags = order.get("tags", "")
        updated_tags = f"{existing_tags}, Paid".strip(", ")
        update_response = requests.put(order_url, headers=headers, json={"order": {"id": order_id, "tags": updated_tags}})
        update_response.raise_for_status()
        return jsonify({"message": "Order tagged as Paid", "tag": "Paid"})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/mark_paid_batch', methods=['POST'])
def mark_paid_batch():
    if not credentials_ok():
        return jsonify({"error": "No store profile active."}), 500
    data = request.get_json()
    order_ids = data.get('order_ids', [])
    if not order_ids:
        return jsonify({"error": "order_ids list is required"}), 400
    headers = get_headers()
    results = []
    for order_id in order_ids:
        order_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders/{order_id}.json"
        try:
            resp = requests.get(order_url, headers=headers, params={"fields": "tags,name"})
            resp.raise_for_status()
            order = resp.json().get('order', {})
            existing_tags = order.get("tags", "")
            updated_tags = f"{existing_tags}, Paid".strip(", ")
            update_resp = requests.put(order_url, headers=headers, json={"order": {"id": order_id, "tags": updated_tags}})
            update_resp.raise_for_status()
            results.append({"order_id": order_id, "name": order.get("name"), "status": "success"})
        except Exception as e:
            results.append({"order_id": order_id, "status": "error", "details": str(e)})
    return jsonify({"results": results})

@app.route('/check_csv_orders', methods=['POST'])
def check_csv_orders():
    if not credentials_ok():
        return jsonify({"error": "No store profile active."}), 500
    data = request.get_json()
    order_names = data.get('order_names', [])
    headers = get_headers()
    results = []
    for name in order_names:
        shopify_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders.json"
        params = {"name": name, "status": "any"}
        try:
            resp = requests.get(shopify_url, headers=headers, params=params)
            resp.raise_for_status()
            orders = resp.json().get("orders", [])
            if orders:
                o = orders[0]
                results.append({"name": name, "order_id": o.get("id"), "found": True, "tags": o.get("tags", "")})
            else:
                results.append({"name": name, "found": False})
        except Exception as e:
            results.append({"name": name, "found": False, "error": str(e)})
    return jsonify({"results": results})

# ════════════════════════════════════════════════════════════════════════════
# MARK AS RETURNED API
# ════════════════════════════════════════════════════════════════════════════

@app.route('/api/get_order_returned/<order_identifier>', methods=['GET'])
def get_order_returned(order_identifier):
    try:
        data, error, status = fetch_order_data(order_identifier)
        if error:
            return jsonify({"error": error}), status
        return jsonify(data)
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/tag_returned/<order_id>', methods=['POST'])
def tag_order_as_returned(order_id):
    if not credentials_ok():
        return jsonify({"error": "No store profile active."}), 500
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders/{order_id}.json"
    try:
        response = requests.get(order_url, headers=headers, params={"fields": "tags"})
        response.raise_for_status()
        order = response.json().get('order')
        existing_tags = order.get("tags", "")
        updated_tags = f"{existing_tags}, Returned".strip(", ")
        update_response = requests.put(order_url, headers=headers, json={"order": {"id": order_id, "tags": updated_tags}})
        update_response.raise_for_status()
        return jsonify({"message": "Order tagged as Returned", "tag": "Returned"})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

# ════════════════════════════════════════════════════════════════════════════
# STOCK APP
# ════════════════════════════════════════════════════════════════════════════

def get_graphql_url():
    return f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/graphql.json"

def run_graphql_query(query):
    try:
        response = requests.post(get_graphql_url(), headers=get_headers(), json={'query': query})
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"[STOCK] GraphQL error: {e}")
        return None

def process_product_edges(edges):
    processed = []
    for edge in (edges or []):
        node = edge['node']
        current_qty = node['variants']['edges'][0]['node']['inventoryQuantity'] if node['variants']['edges'] else 0
        threshold = int(node['metafield']['value']) if node.get('metafield') else 0
        processed.append({
            "title":       node['title'],
            "image_url":   node['featuredImage']['url'] if node.get('featuredImage') else None,
            "current_qty": current_qty,
            "threshold":   threshold,
        })
    return processed

@app.route('/stock')
def show_urgent():
    all_tags = [cat["tag"] for cat in STOCK_CATEGORIES.values()]
    tag_query_string = " OR ".join([f"tag:'{tag}'" for tag in all_tags])
    query = f"""
    {{
      products(first: 250, query: "({tag_query_string})") {{
        edges {{
          node {{
            id title
            featuredImage {{ url }}
            variants(first: 1) {{
              edges {{ node {{ inventoryQuantity }} }}
            }}
          }}
        }}
      }}
    }}
    """
    data = run_graphql_query(query)
    products_to_display = []
    if data and 'errors' not in data:
        for edge in data.get('data', {}).get('products', {}).get('edges', []):
            node = edge['node']
            if node['variants']['edges']:
                qty = node['variants']['edges'][0]['node']['inventoryQuantity']
                if qty < 0:
                    products_to_display.append({
                        "title":       node['title'],
                        "image_url":   node['featuredImage']['url'] if node.get('featuredImage') else None,
                        "current_qty": qty,
                        "needed_qty":  0 - qty
                    })
    sorted_products = sorted(products_to_display, key=lambda p: p['needed_qty'], reverse=True)
    return render_template('urgent_page.html', products=sorted_products, page_title="Urgent",
                           active_page='stock', active_stock='urgent')

@app.route('/stock/<category_slug>')
def show_category(category_slug):
    if category_slug not in STOCK_CATEGORIES:
        abort(404)
    category = STOCK_CATEGORIES[category_slug]
    tag = category["tag"]
    ns  = METAFIELD_NAMESPACE()
    key = METAFIELD_KEY()
    query = f"""
    {{
      products(first: 250, query: "tag:'{tag}'") {{
        edges {{
          node {{
            id title
            featuredImage {{ url }}
            variants(first: 1) {{
              edges {{ node {{ inventoryQuantity }} }}
            }}
            metafield(namespace: "{ns}", key: "{key}") {{
              value
            }}
          }}
        }}
      }}
    }}
    """
    data = run_graphql_query(query)
    products_to_display = []
    if data and 'errors' not in data:
        product_edges = data.get('data', {}).get('products', {}).get('edges', [])
        all_products = process_product_edges(product_edges)
        for product in all_products:
            needed_qty = product['threshold'] - product['current_qty']
            if needed_qty > 0:
                product['needed_qty'] = needed_qty
                products_to_display.append(product)
    sorted_products = sorted(products_to_display, key=lambda p: p['needed_qty'], reverse=True)
    return render_template('category_page.html', products=sorted_products, page_title=category["title"],
                           active_page='stock', active_stock=category_slug)

# ════════════════════════════════════════════════════════════════════════════
# QTY DEDUCTION
# ════════════════════════════════════════════════════════════════════════════

@app.route('/deduct')
def deduct():
    return render_template('qty_deduct.html', active_page='deduct')

@app.route('/api/deduct_qty', methods=['POST'])
def deduct_qty():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500
    data = request.get_json()
    sku = (data.get('sku') or '').strip()
    qty = int(data.get('qty') or 1)
    if not sku:
        return jsonify({'success': False, 'error': 'SKU is required'}), 400
    if qty < 1:
        return jsonify({'success': False, 'error': 'Qty must be at least 1'}), 400
    headers = get_headers()
    graphql_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/graphql.json"
    safe_sku = sku.replace('"', '')
    query = '{productVariants(first:5,query:"sku:' + safe_sku + '"){edges{node{id sku inventoryItem{id} inventoryQuantity}}}}'
    try:
        gql_resp = requests.post(graphql_url, headers=headers, json={'query': query})
        gql_resp.raise_for_status()
        edges = gql_resp.json().get('data', {}).get('productVariants', {}).get('edges', [])
        match = next((e['node'] for e in edges if e['node'].get('sku') == sku), None)
        if not match:
            return jsonify({'success': False, 'error': 'SKU not found: ' + sku}), 404
        inventory_item_id = match['inventoryItem']['id'].split('/')[-1]
        loc_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/locations.json"
        locations = requests.get(loc_url, headers=headers).json().get('locations', [])
        if not locations:
            return jsonify({'success': False, 'error': 'No locations found'}), 500
        location_id = locations[0]['id']
        adjust_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/inventory_levels/adjust.json"
        adj = requests.post(adjust_url, headers=headers, json={
            'location_id':          location_id,
            'inventory_item_id':    inventory_item_id,
            'available_adjustment': -qty
        })
        adj.raise_for_status()
        new_qty = adj.json().get('inventory_level', {}).get('available', 'unknown')
        return jsonify({'success': True, 'sku': sku, 'deducted': qty, 'new_qty': new_qty})
    except requests.exceptions.HTTPError as e:
        return jsonify({'success': False, 'error': e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ════════════════════════════════════════════════════════════════════════════
# MY ACCOUNTANT
# ════════════════════════════════════════════════════════════════════════════

ACCOUNTANT_FILE = os.path.join(BASE_DIR, 'accountant_data.json')

def load_accountant_data():
    if os.path.exists(ACCOUNTANT_FILE):
        try:
            with open(ACCOUNTANT_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {'entries': []}

def save_accountant_data(data):
    with open(ACCOUNTANT_FILE, 'w') as f:
        json.dump(data, f, indent=2)

@app.route('/accountant')
def accountant():
    return render_template('accountant.html', active_page='accountant')

@app.route('/api/accountant/load', methods=['GET'])
def accountant_load():
    return jsonify(load_accountant_data())

@app.route('/api/accountant/save', methods=['POST'])
def accountant_save():
    try:
        data = request.get_json()
        save_accountant_data({'entries': data.get('entries', [])})
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/accountant/export', methods=['POST'])
def accountant_export():
    try:
        data     = request.get_json()
        fmt      = data.get('format', 'csv')
        entries  = data.get('entries', [])

        timestamp = datetime.datetime.now().strftime('%Y-%m-%d_%H-%M')
        filename  = f'accountant_{timestamp}.{fmt}'
        filepath  = os.path.join(BASE_DIR, filename)

        if fmt == 'json':
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(entries, f, indent=2)
        else:
            with open(filepath, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['Date', 'Day', 'Type', 'Qty', 'Earnings'])
                for e in entries:
                    writer.writerow([
                        e.get('display', ''),
                        e.get('dayName', ''),
                        e.get('type', ''),
                        e.get('qty', ''),
                        e.get('earnings', '')
                    ])

        return jsonify({'success': True, 'path': filepath, 'filename': filename})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ── Diagnostics ──────────────────────────────────────────────────────────────
@app.route('/api/check_config')
def check_config():
    return jsonify({
        "store_url":    SHOPIFY_STORE_URL(),
        "token_loaded": bool(SHOPIFY_ACCESS_TOKEN()),
        "token_last8":  SHOPIFY_ACCESS_TOKEN()[-8:] if SHOPIFY_ACCESS_TOKEN() else "MISSING",
        "api_version":  SHOPIFY_API_VERSION(),
        "base_dir":     BASE_DIR
    })

# ── Boot ─────────────────────────────────────────────────────────────────────
boot_active_profile()

if __name__ == '__main__':
    import webview

    def start_flask():
        app.run(port=5000, debug=False, use_reloader=False)

    t = threading.Thread(target=start_flask, daemon=True)
    t.start()

    import time
    time.sleep(1.5)

    webview.create_window(
        "Shopify Tools",
        "http://127.0.0.1:5000",
        width=1200,
        height=800,
        maximized=True
    )
    webview.start()