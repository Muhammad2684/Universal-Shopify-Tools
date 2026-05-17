import os
import json
import requests
import datetime
import csv
from flask import Flask, render_template, jsonify, request, abort, redirect, url_for, send_file
import io
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Image, Spacer, KeepTogether, PageBreak
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
import hmac, hashlib, base64, secrets
from flask import session
from dotenv import load_dotenv  
load_dotenv()

app = Flask(__name__)
app.secret_key = 'replace-with-random-32-char-string'

BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

os.makedirs(BASE_DIR, exist_ok=True)

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
def STOCK_COMMENT_KEY():    return "stock_comment"
def WHOLESALE_PRICE_KEY():  return "wholesale_price"

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

PROFILES_FILE = os.path.join(BASE_DIR, 'profiles.json')
LICENSE_SERVER = "https://usht.pythonanywhere.com"
LICENSE_FILE   = os.path.join(BASE_DIR, 'license.json')

ROUTE_PERMISSIONS = {
    '/scanpack':         'has_sap',
    '/api/get_order':    'has_sap',
    '/api/fulfill_order': 'has_sap',
    '/markpaid':         'has_map',
    '/api/tag_order':    'has_map',
    '/api/mark_paid_batch': 'has_map',
    '/returned':         'has_mar',
    '/stock':            'has_stock_app',
    '/api/dashboard':    None, # Special handling for dashboard
    '/deduct':           'has_qty_deduction',
    '/accountant':       'has_accountant',
}

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

STOCK_CATEGORIES = {
    "simple":   {"tag": "HJMQS",  "title": "Simple"},
    "2-button": {"tag": "HJMQ2B", "title": "2 Button"},
    "7-button": {"tag": "HJMQ7B", "title": "7 Button"},
    "quilt":    {"tag": "HJMQQ",  "title": "Quilt"},
    "bednet":   {"tag": "HJMQBN", "title": "Bed Net"},
    "7pcs":     {"tag": "HJMQ7P", "title": "7 Pcs"},
}

def load_license():
    if os.path.exists(LICENSE_FILE):
        try:
            with open(LICENSE_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return None

def save_license(data):
    with open(LICENSE_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def clear_license():
    if os.path.exists(LICENSE_FILE):
        os.remove(LICENSE_FILE)

def get_headers():
    return {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN(),
        "Content-Type": "application/json"
    }

def get_rest_url():
    return f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}"

def credentials_ok():
    return bool(SHOPIFY_STORE_URL() and SHOPIFY_ACCESS_TOKEN())

# ════════════════════════════════════════════════════════════════════════════
# Shopify Auth
# ════════════════════════════════════════════════════════════════════════════

SHOPIFY_CLIENT_ID     = os.environ.get('SHOPIFY_CLIENT_ID', '')
SHOPIFY_CLIENT_SECRET = os.environ.get('SHOPIFY_CLIENT_SECRET', '')
SHOPIFY_SCOPES        = 'read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_fulfillments,write_fulfillments,read_locations'


@app.route('/auth')
def auth_start():
    shop = request.args.get('shop', '').strip()
    if not shop:
        return "Missing shop parameter", 400
    if not shop.endswith('.myshopify.com'):
        shop = shop + '.myshopify.com'
    state = secrets.token_hex(16)
    session['oauth_state'] = state
    redirect_uri = 'https://usht.pythonanywhere.com/auth/callback'
    url = (
        f"https://{shop}/admin/oauth/authorize"
        f"?client_id={SHOPIFY_CLIENT_ID}"
        f"&scope={SHOPIFY_SCOPES}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
    )
    return redirect(url)

@app.route('/auth/callback')
def auth_callback():
    shop  = request.args.get('shop', '')
    code  = request.args.get('code', '')
    state = request.args.get('state', '')

    if state != session.get('oauth_state'):
        return "Invalid state", 403

    # Exchange code for access token
    import requests as req
    resp = req.post(f"https://{shop}/admin/oauth/access_token", json={
        'client_id':     SHOPIFY_CLIENT_ID,
        'client_secret': SHOPIFY_CLIENT_SECRET,
        'code':          code,
    })
    token_data = resp.json()
    access_token = token_data.get('access_token')

    if not access_token:
        return "Failed to get access token", 400

    # Save the token — for now just show it so you can test
    return f"""
    <h2>Connected!</h2>
    <p>Shop: {shop}</p>
    <p>Token: {access_token}</p>
    <p>Save this token — we'll store it properly in the next step.</p>
    """
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
        
        # current_quantity == 0 means the item was removed or fully refunded.
        # This is reliable regardless of fulfillment status.
        is_removed = item.get('current_quantity', item.get('quantity', 1)) == 0

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
            "customized_name":    customized_name,
            "removed":            is_removed,
        })

    return {
        "order_id":           order.get('id'),
        "order_name":         order.get('name'),
        "line_items":         line_items,
        "fulfillment_status": order.get('fulfillment_status'),
        "tags":               order.get('tags', ''),
        "city":               (order.get('shipping_address') or {}).get('city', ''),
        "total_price":        order.get('total_price', '0'),
        "note":               order.get('note', '') or '',
    }, None, 200

# ════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ════════════════════════════════════════════════════════════════════════════

@app.before_request
def check_license():
    allowed = ['/license', '/api/license/validate', '/api/license/clear', '/static']
    if any(request.path.startswith(p) for p in allowed):
        return None
    lic = load_license()
    if not lic:
        return redirect('/license')
    # Re-validate against server on every request
    try:
        resp = requests.post(
            f'{LICENSE_SERVER}/api/validate',
            json={'key': lic['key']},
            timeout=5
        )
        data = resp.json()
        if not data.get('valid'):
            clear_license()
            return redirect('/license')
        # Update local license with latest info (including free_trial flag)
        save_license({
            'key':         lic['key'],
            'plan':        data['plan'],
            'label':       data['label'],
            'expires_at':  data.get('expires_at'),
            'customer':    data.get('customer', ''),
            'free_trial':  data.get('free_trial', False),
            'permissions': data.get('permissions', {}),
        })
    except Exception:
        pass  # Server unreachable — allow through (offline tolerance)

    # ── Enforce Permissions ───────────────────────────────────────────
    permissions = lic.get('permissions', {})
    path = request.path
    for route, flag in ROUTE_PERMISSIONS.items():
        if path.startswith(route) and flag:
            if permissions.get(flag) == False:
                return redirect('/403')

@app.route('/403')
def forbidden():
    return render_template('403.html')

@app.route('/license')
def license_page():
    if load_license():
        return redirect('/')
    return render_template('license.html')

@app.route('/api/license/validate', methods=['POST'])
def license_validate():
    body = request.get_json(silent=True) or {}
    key  = (body.get('key') or '').strip().upper()
    if not key:
        return jsonify({'valid': False, 'error': 'No key provided'}), 400
    try:
        resp = requests.post(f'{LICENSE_SERVER}/api/validate', json={'key': key}, timeout=8)
        data = resp.json()
        if data.get('valid'):
            save_license({
                'key':         key,
                'plan':        data['plan'],
                'label':       data['label'],
                'expires_at':  data.get('expires_at'),
                'customer':    data.get('customer', ''),
                'free_trial':  data.get('free_trial', False),
                'permissions': data.get('permissions', {}),
            })
        return jsonify(data)
    except Exception:
        return jsonify({'valid': False, 'error': 'Could not reach license server'}), 500

@app.route('/api/license/clear', methods=['POST'])
def license_clear():
    clear_license()
    return jsonify({'success': True})

@app.route('/api/license/status', methods=['GET'])
def license_status():
    lic = load_license()
    if not lic:
        return jsonify({'valid': False})
    return jsonify({
        'valid':      True,
        'plan':       lic['plan'],
        'label':      lic['label'],
        'free_trial': lic.get('free_trial', False),
    })

@app.route('/api/license/permissions', methods=['GET'])
def license_permissions():
    lic = load_license()
    if not lic or 'permissions' not in lic:
        # Default all to True if not yet set or no license
        defaults = {
            'has_sap': True, 'has_map': True, 'has_mar': True,
            'has_qty_deduction': True, 'has_accountant': True, 'has_stock_app': True
        }
        return jsonify(lic.get('permissions', defaults) if lic else defaults)
    return jsonify(lic['permissions'])

@app.route('/')
def home():
    return render_template('dashboard.html', active_page='dashboard')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html', active_page='dashboard')

@app.route('/api/dashboard', methods=['GET'])
def api_dashboard():
    result = {
        'packed_today':         0,
        'returned_today':       0,
        'earnings_today':       0,
        'earnings_entry_count': 0,
        'urgent_count':         0,
        'urgent_items':         [],
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
    
@app.route('/api/order_note/<order_id>', methods=['POST'])
def save_order_note(order_id):
    if not credentials_ok():
        return jsonify({"error": "No store profile active."}), 500
    data = request.get_json()
    note = data.get('note', '')
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/orders/{order_id}.json"
    try:
        update_response = requests.put(
            order_url, headers=headers,
            json={"order": {"id": order_id, "note": note}}
        )
        update_response.raise_for_status()
        return jsonify({"success": True, "note": note})
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
        node        = edge['node']
        first_v     = node['variants']['edges'][0]['node'] if node['variants']['edges'] else {}
        current_qty = first_v.get('inventoryQuantity', 0)
        threshold   = int(node.get('thresholdMetafield', {}).get('value', 0)) if node.get('thresholdMetafield') else 0
        comment     = node.get('commentMetafield', {}).get('value', '') if node.get('commentMetafield') else ''
        wholesale   = node.get('wholesalePriceMetafield', {}).get('value', '0.00') if node.get('wholesalePriceMetafield') else '0.00'
        retail      = first_v.get('price', '0.00')
        
        # Extract all variants with their titles (sizes) and inventory
        variants = []
        for variant_edge in node['variants']['edges']:
            variant_node = variant_edge['node']
            variants.append({
                'title': variant_node.get('title', 'N/A'),
                'inventory': variant_node['inventoryQuantity'],
                'sku': variant_node.get('sku', ''),
                'price': variant_node.get('price', '0.00')
            })
        
        processed.append({
            "product_id":  node['id'],
            "title":       node['title'],
            "image_url":   node['featuredImage']['url'] if node.get('featuredImage') else None,
            "current_qty": current_qty,
            "threshold":   threshold,
            "sku":         variants[0]['sku'] if variants else '',
            "sizes":       '; '.join([v['title'] for v in variants]) if variants else '',
            "variants":    variants,
            "comment":     comment,
            "wholesale_price": wholesale,
            "retail_price":    retail
        })
    return processed

# ── Dynamic categories stored in AppData ────────────────────────────────────

CATEGORIES_FILE = os.path.join(BASE_DIR, 'categories.json')

DEFAULT_CATEGORIES = [
    {"slug": "simple",   "title": "Simple",   "tag": "HJMQS"},
    {"slug": "2-button", "title": "2 Button",  "tag": "HJMQ2B"},
    {"slug": "7-button", "title": "7 Button",  "tag": "HJMQ7B"},
    {"slug": "quilt",    "title": "Quilt",     "tag": "HJMQQ"},
    {"slug": "bednet",   "title": "Bed Net",   "tag": "HJMQBN"},
    {"slug": "7pcs",     "title": "7 Pcs",     "tag": "HJMQ7P"},
]

def load_categories():
    if os.path.exists(CATEGORIES_FILE):
        try:
            with open(CATEGORIES_FILE, 'r') as f:
                data = json.load(f)
                if data:
                    return data
        except Exception:
            pass
    save_categories(DEFAULT_CATEGORIES)
    return DEFAULT_CATEGORIES

def save_categories(cats):
    with open(CATEGORIES_FILE, 'w') as f:
        json.dump(cats, f, indent=2)

def get_stock_categories_dict():
    cats = load_categories()
    result = {}
    for c in cats:
        result[c['slug']] = {
            'tag': c['tag'],
            'title': c['title'],
            'parent': c.get('parent'),
        }
    return result

# ── Category CRUD routes ─────────────────────────────────────────────────────

@app.route('/api/stock_categories', methods=['GET'])
def api_get_categories():
    return jsonify(load_categories())

@app.route('/api/stock_categories', methods=['POST'])
def api_add_category():
    import re
    body  = request.get_json(silent=True) or {}
    title = (body.get('title') or '').strip()
    tag   = (body.get('tag')   or '').strip()
    slug  = (body.get('slug')  or '').strip()
    parent = (body.get('parent') or '').strip() or None

    if not title or not tag or not slug:
        return jsonify({'success': False, 'error': 'title, tag, and slug are all required'}), 400

    slug = re.sub(r'[^a-z0-9\-]', '', slug.lower())
    if not slug:
        return jsonify({'success': False, 'error': 'Invalid slug'}), 400

    cats = load_categories()
    if any(c['slug'] == slug for c in cats):
        return jsonify({'success': False, 'error': f'Slug "{slug}" already exists'}), 400

    # Validate parent exists if provided
    if parent and not any(c['slug'] == parent for c in cats):
        return jsonify({'success': False, 'error': f'Parent category "{parent}" not found'}), 400

    new_cat = {'slug': slug, 'title': title, 'tag': tag}
    if parent:
        new_cat['parent'] = parent
    cats.append(new_cat)
    save_categories(cats)
    return jsonify({'success': True})

@app.route('/api/stock_categories/<slug>', methods=['PUT'])
def api_update_category(slug):
    body = request.get_json(silent=True) or {}
    cats = load_categories()
    cat  = next((c for c in cats if c['slug'] == slug), None)
    if not cat:
        return jsonify({'success': False, 'error': 'Category not found'}), 404
    cat['title'] = body.get('title', cat['title']).strip()
    cat['tag']   = body.get('tag',   cat['tag']).strip()
    
    # Handle parent update
    if 'parent' in body:
        parent = body.get('parent')
        if parent is not None:
            parent = parent.strip() or None
        if parent:
            # Validate parent exists and is not self
            if parent == slug:
                return jsonify({'success': False, 'error': 'Category cannot be its own parent'}), 400
            if not any(c['slug'] == parent for c in cats):
                return jsonify({'success': False, 'error': f'Parent category "{parent}" not found'}), 400
            cat['parent'] = parent
        else:
            cat.pop('parent', None)
    
    save_categories(cats)
    return jsonify({'success': True})

@app.route('/api/stock_categories/<slug>', methods=['DELETE'])
def api_delete_category(slug):
    cats = load_categories()
    cat  = next((c for c in cats if c['slug'] == slug), None)
    if not cat:
        return jsonify({'success': False, 'error': 'Category not found'}), 404

    tag = cat['tag']

    # Collect all tags to remove: this category + any sub-categories
    tags_to_remove = {tag}
    for c in cats:
        if c.get('parent') == slug:
            tags_to_remove.add(c['tag'])

    # Remove tag from all products in Shopify
    if credentials_ok() and tag:
        headers = get_headers()
        api_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}"
        processed = 0
        page = 1

        while True:
            try:
                resp = requests.get(f"{api_url}/products.json", headers=headers, params={
                    'tag': tag, 'fields': 'id,tags', 'limit': 250, 'page': page
                })
                if resp.status_code != 200:
                    break
                products = resp.json().get('products', [])
                if not products:
                    break

                for product in products:
                    existing = [t.strip() for t in product.get('tags', '').split(',') if t.strip()]
                    cleaned  = [t for t in existing if t not in tags_to_remove]
                    if len(cleaned) != len(existing):
                        requests.put(
                            f"{api_url}/products/{product['id']}.json",
                            headers=headers,
                            json={"product": {"id": product['id'], "tags": ', '.join(cleaned)}}
                        )
                        processed += 1

                page += 1
            except Exception:
                break

    # Remove the category (and sub-categories) from local file
    new_cats = [c for c in cats if c['slug'] != slug and c.get('parent') != slug]
    save_categories(new_cats)

    return jsonify({'success': True, 'products_updated': processed})

# ── Stock pages ──────────────────────────────────────────────────────────────

@app.route('/stock/manage')
def manage_categories():
    return render_template('manage_categories.html', active_page='stock', active_stock='manage')

@app.route('/stock')
def show_urgent():
    stock_cats       = get_stock_categories_dict()
    all_tags         = [cat["tag"] for cat in get_stock_categories_dict().values()]
    tag_query_string = " OR ".join([f"tag:'{tag}'" for tag in all_tags])
    ns               = METAFIELD_NAMESPACE()
    comment_key      = STOCK_COMMENT_KEY()
    wholesale_key    = WHOLESALE_PRICE_KEY()
    query = f"""
    {{
      products(first: 250, query: "({tag_query_string})") {{
        edges {{
          node {{
            id title
            featuredImage {{ url }}
            variants(first: 1) {{
              edges {{ node {{ sku title inventoryQuantity price }} }}
            }}
            commentMetafield: metafield(namespace: "{ns}", key: "{comment_key}") {{
              value
            }}
            wholesalePriceMetafield: metafield(namespace: "{ns}", key: "{wholesale_key}") {{
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
        for edge in data.get('data', {}).get('products', {}).get('edges', []):
            node = edge['node']
            if node['variants']['edges']:
                v_node = node['variants']['edges'][0]['node']
                qty = v_node['inventoryQuantity']
                if qty < 0:
                    products_to_display.append({
                        "product_id": node['id'],
                        "title":       node['title'],
                        "image_url":   node['featuredImage']['url'] if node.get('featuredImage') else None,
                        "sku":         v_node.get('sku', '') if node['variants']['edges'] else '',
                        "sizes":       v_node.get('title', '') if node['variants']['edges'] else '',
                        "current_qty": qty,
                        "needed_qty":  0 - qty,
                        "threshold":   '',
                        "comment":     node.get('commentMetafield', {}).get('value', '') if node.get('commentMetafield') else '',
                        "wholesale_price": node.get('wholesalePriceMetafield', {}).get('value', '0.00') if node.get('wholesalePriceMetafield') else '0.00',
                        "retail_price":    v_node.get('price', '0.00')
                    })
    sorted_products = sorted(products_to_display, key=lambda p: p['needed_qty'], reverse=True)
    return render_template('urgent_page.html', products=sorted_products, page_title="Urgent",
                           active_page='stock', active_stock='urgent')

@app.route('/stock/<category_slug>' )
def show_category(category_slug):
    if category_slug == 'manage':
        return manage_categories()

    stock_cats = get_stock_categories_dict()
    if category_slug not in stock_cats:
        abort(404)

    category = stock_cats[category_slug]
    tag = category["tag"]
    ns  = METAFIELD_NAMESPACE()
    key = METAFIELD_KEY()
    comment_key = STOCK_COMMENT_KEY()
    wholesale_key = WHOLESALE_PRICE_KEY()
    query = f"""
    {{
      products(first: 250, query: "tag:'{tag}'") {{
        edges {{
          node {{
            id title
            featuredImage {{ url }}
            variants(first: 250) {{
              edges {{
                node {{
                  id
                  title
                  sku
                  inventoryQuantity
                  price
                }}
              }}
            }}
            thresholdMetafield: metafield(namespace: "{ns}", key: "{key}") {{
              value
            }}
            commentMetafield: metafield(namespace: "{ns}", key: "{comment_key}") {{
              value
            }}
            wholesalePriceMetafield: metafield(namespace: "{ns}", key: "{wholesale_key}") {{
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
        all_products  = process_product_edges(product_edges)
        for product in all_products:
            needed_qty = product['threshold'] - product['current_qty']
            product['needed_qty'] = max(needed_qty, 0)
            product['above_threshold'] = needed_qty <= 0
            products_to_display.append(product)

    sorted_products = sorted(
        products_to_display,
        key=lambda p: (
            p['above_threshold'],
            -p['needed_qty'] if not p['above_threshold'] else p['current_qty'],
            p['title'].lower()
        )
    )
    return render_template('category_page.html', products=sorted_products, page_title=category["title"],
                           active_page='stock', active_stock=category_slug)

# ── Threshold edit ────────────────────────────────────────────────────────────

@app.route('/api/update_threshold', methods=['POST'])
def update_threshold():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body       = request.get_json(silent=True) or {}
    product_id = body.get('product_id', '').strip()
    new_value  = body.get('value')

    if not product_id or new_value is None:
        return jsonify({'success': False, 'error': 'product_id and value required'}), 400

    try:
        new_value = int(new_value)
        if new_value < 0:
            return jsonify({'success': False, 'error': 'Threshold must be 0 or more'}), 400
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'Value must be a number'}), 400

    ns  = METAFIELD_NAMESPACE()
    key = METAFIELD_KEY()

    mutation = """
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors  { field message }
      }
    }
    """
    variables = {
        "metafields": [{
            "ownerId":   product_id,
            "namespace": ns,
            "key":       key,
            "value":     str(new_value),
            "type":      "number_integer"
        }]
    }

    try:
        resp = requests.post(
            get_graphql_url(),
            headers=get_headers(),
            json={"query": mutation, "variables": variables}
        )
        resp.raise_for_status()
        data   = resp.json()
        errors = data.get('data', {}).get('metafieldsSet', {}).get('userErrors', [])
        if errors:
            return jsonify({'success': False, 'error': errors[0]['message']}), 400
        return jsonify({'success': True, 'new_value': new_value})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/stock/mark_urgent_bulk', methods=['POST'])
def mark_urgent_bulk():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body        = request.get_json(silent=True) or {}
    product_ids = body.get('product_ids', [])
    
    if not product_ids:
        return jsonify({'success': False, 'error': 'No product IDs provided'}), 400

    headers = get_headers()
    success_count = 0
    errors = []

    for pid in product_ids:
        try:
            # 1. Get current tags
            # Ensure pid is in the correct format for REST (remove gid://shopify/Product/ if present)
            clean_id = pid.split('/')[-1] if 'gid://' in pid else pid
            prod_url = f"{get_rest_url()}/products/{clean_id}.json"
            
            resp = requests.get(prod_url, headers=headers, params={"fields": "id,tags"})
            if resp.status_code != 200:
                errors.append(f"Failed to fetch {pid}")
                continue
                
            product = resp.json().get('product', {})
            existing_tags = product.get('tags', '')
            tag_list = [t.strip() for t in existing_tags.split(',') if t.strip()]
            
            if "Urgent" not in tag_list:
                tag_list.append("Urgent")
                update_resp = requests.put(prod_url, headers=headers, 
                                          json={"product": {"id": clean_id, "tags": ', '.join(tag_list)}})
                if update_resp.status_code == 200:
                    success_count += 1
                else:
                    errors.append(f"Failed to update {pid}")
            else:
                success_count += 1 # Already urgent
        except Exception as e:
            errors.append(str(e))

    return jsonify({'success': True, 'count': success_count, 'errors': errors})

@app.route('/api/stock/add_comment_bulk', methods=['POST'])
def add_comment_bulk():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body        = request.get_json(silent=True) or {}
    product_ids = body.get('product_ids', [])
    comment     = body.get('comment', '')

    if not product_ids:
        return jsonify({'success': False, 'error': 'No product IDs provided'}), 400

    ns          = METAFIELD_NAMESPACE()
    comment_key = STOCK_COMMENT_KEY()

    # Use GraphQL for bulk metafield set
    mutation = """
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors  { field message }
      }
    }
    """
    
    metafields_to_set = []
    for pid in product_ids:
        # GraphQL needs the full GID
        full_id = pid if 'gid://' in pid else f"gid://shopify/Product/{pid}"
        # Use "N/A" for empty comments to satisfy Shopify validation
        val = str(comment).strip() if comment and comment.strip() else "N/A"
        metafields_to_set.append({
            "ownerId":   full_id,
            "namespace": ns,
            "key":       comment_key,
            "value":     val,
            "type":      "multi_line_text_field"
        })

    try:
        resp = requests.post(
            get_graphql_url(),
            headers=get_headers(),
            json={"query": mutation, "variables": {"metafields": metafields_to_set}}
        )
        resp.raise_for_status()
        data   = resp.json()
        errors = data.get('data', {}).get('metafieldsSet', {}).get('userErrors', [])
        if errors:
            return jsonify({'success': False, 'error': errors[0]['message']}), 400
        return jsonify({'success': True, 'count': len(product_ids)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/stock/change_category_bulk', methods=['POST'])
def change_category_bulk():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body = request.get_json(silent=True) or {}
    product_ids = body.get('product_ids', [])
    new_tag = body.get('new_tag', '').strip()

    if not product_ids or not new_tag:
        return jsonify({'success': False, 'error': 'product_ids and new_tag required'}), 400

    stock_cats = get_stock_categories_dict()
    all_stock_tags = {c['tag'] for c in stock_cats.values()}

    success_count = 0
    errors = []

    headers = get_headers()
    for pid in product_ids:
        try:
            numeric_id = pid.split('/')[-1]
            prod_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/products/{numeric_id}.json"
            
            resp = requests.get(prod_url, headers=headers, params={"fields": "id,tags"})
            resp.raise_for_status()
            product = resp.json().get('product', {})
            existing_tags = product.get('tags', '')
            tag_list = [t.strip() for t in existing_tags.split(',') if t.strip()]
            
            # Remove all existing stock tags
            tag_list = [t for t in tag_list if t not in all_stock_tags]
            
            # Add new tag
            if new_tag not in tag_list:
                tag_list.append(new_tag)
                
            updated = requests.put(prod_url, headers=headers,
                                   json={"product": {"id": numeric_id, "tags": ', '.join(tag_list)}})
            updated.raise_for_status()
            success_count += 1
        except Exception as e:
            errors.append(f"Product {pid}: {str(e)}")

    if errors:
        return jsonify({
            'success': False, 
            'error': f"Completed with errors. {success_count} success, {len(errors)} failed.",
            'details': errors
        }), 207

    return jsonify({'success': True})

@app.route('/api/update_stock_comment', methods=['POST'])
def update_stock_comment():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body       = request.get_json(silent=True) or {}
    product_id = body.get('product_id', '').strip()
    comment    = body.get('comment', '')

    if not product_id:
        return jsonify({'success': False, 'error': 'product_id required'}), 400

    ns          = METAFIELD_NAMESPACE()
    comment_key = STOCK_COMMENT_KEY()

    # Use "N/A" placeholder when clearing — avoids fragile two-step delete
    comment_value = str(comment).strip() if comment and comment.strip() else "N/A"

    mutation = """
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors  { field message }
      }
    }
    """
    variables = {
        "metafields": [{
            "ownerId":   product_id,
            "namespace": ns,
            "key":       comment_key,
            "value":     comment_value,
            "type":      "multi_line_text_field"
        }]

    }

    try:
        resp = requests.post(
            get_graphql_url(),
            headers=get_headers(),
            json={"query": mutation, "variables": variables}
        )
        resp.raise_for_status()
        data   = resp.json()
        errors = data.get('data', {}).get('metafieldsSet', {}).get('userErrors', [])
        if errors:
            return jsonify({'success': False, 'error': errors[0]['message']}), 400
        return jsonify({'success': True, 'comment': '' if comment_value == "N/A" else comment})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/update_wholesale_price', methods=['POST'])
def update_wholesale_price():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body        = request.get_json(silent=True) or {}
    product_id  = body.get('product_id', '').strip()
    price       = body.get('price', '').strip()

    if not product_id:
        return jsonify({'success': False, 'error': 'product_id required'}), 400

    try:
        price_val = f"{float(price):.2f}"
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'Invalid price value'}), 400

    if price_val == '0.00' or not price:
        mutation_clear = """
        mutation metafieldDelete($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) {
            deletedId
            userErrors { field message }
          }
        }
        """
        query = f"""
        {{
          product(id: \"{product_id}\") {{
            metafield(namespace: \"{METAFIELD_NAMESPACE()}\", key: \"{WHOLESALE_PRICE_KEY()}\") {{
              id
            }}
          }}
        }}
        """
        data = run_graphql_query(query)
        metafield_id = None
        if data and 'data' in data:
            mf = data.get('data', {}).get('product', {}).get('metafield')
            metafield_id = mf.get('id') if mf else None

        if metafield_id:
            resp = requests.post(
                get_graphql_url(),
                headers=get_headers(),
                json={"query": mutation_clear, "variables": {"input": {"id": metafield_id}}}
            )
            resp.raise_for_status()
            data = resp.json()
            errors = data.get('data', {}).get('metafieldDelete', {}).get('userErrors', [])
            if errors:
                return jsonify({'success': False, 'error': errors[0]['message']}), 400
        return jsonify({'success': True, 'price': ''})

    mutation = """
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors  { field message }
      }
    }
    """
    variables = {
        "metafields": [{
            "ownerId":   product_id,
            "namespace": METAFIELD_NAMESPACE(),
            "key":       WHOLESALE_PRICE_KEY(),
            "value":     price_val,
            "type":      "number_decimal"
        }]
    }

    try:
        resp = requests.post(
            get_graphql_url(),
            headers=get_headers(),
            json={"query": mutation, "variables": variables}
        )
        resp.raise_for_status()
        data   = resp.json()
        errors = data.get('data', {}).get('metafieldsSet', {}).get('userErrors', [])
        if errors:
            return jsonify({'success': False, 'error': errors[0]['message']}), 400
        return jsonify({'success': True, 'price': price_val})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Category product management routes ──────────────────────────────────────

@app.route('/api/category_products/<slug>', methods=['GET'])
def get_category_products(slug):
    """Fetch all products currently in a category with their threshold values."""
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    cats = load_categories()
    cat  = next((c for c in cats if c['slug'] == slug), None)
    if not cat:
        return jsonify({'success': False, 'error': 'Category not found'}), 404

    tag = cat['tag']
    ns  = METAFIELD_NAMESPACE()
    key = METAFIELD_KEY()
    gql = f"""
    {{
      products(first: 250, query: "tag:'{tag}'") {{
        edges {{
          node {{
            id
            title
            featuredImage {{ url }}
            variants(first: 1) {{
              edges {{ node {{ sku inventoryQuantity }} }}
            }}
            metafield(namespace: "{ns}", key: "{key}") {{
              value
            }}
          }}
        }}
      }}
    }}
    """
    try:
        data    = run_graphql_query(gql)
        results = []
        for edge in data.get('data', {}).get('products', {}).get('edges', []):
            node      = edge['node']
            variant   = node['variants']['edges'][0]['node'] if node['variants']['edges'] else {}
            threshold = int(node['metafield']['value']) if node.get('metafield') else 0
            results.append({
                'id':        node['id'],
                'title':     node['title'],
                'image':     node['featuredImage']['url'] if node.get('featuredImage') else None,
                'sku':       variant.get('sku', ''),
                'stock':     variant.get('inventoryQuantity', 0),
                'threshold': threshold,
            })
        return jsonify({'success': True, 'results': results, 'tag': tag})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/category_product', methods=['POST'])
def add_product_to_category():
    """Add a category tag to a product."""
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body       = request.get_json(silent=True) or {}
    product_id = body.get('product_id', '').strip()
    tag        = body.get('tag', '').strip()

    if not product_id or not tag:
        return jsonify({'success': False, 'error': 'product_id and tag required'}), 400

    headers   = get_headers()
    prod_url  = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/products/{product_id}.json"
    try:
        resp          = requests.get(prod_url, headers=headers, params={"fields": "id,tags"})
        resp.raise_for_status()
        product       = resp.json().get('product', {})
        existing_tags = product.get('tags', '')
        tag_list      = [t.strip() for t in existing_tags.split(',') if t.strip()]
        if tag not in tag_list:
            tag_list.append(tag)
        updated = requests.put(prod_url, headers=headers,
                               json={"product": {"id": product_id, "tags": ', '.join(tag_list)}})
        updated.raise_for_status()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/category_product', methods=['DELETE'])
def remove_product_from_category():
    """Remove a category tag from a product."""
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body       = request.get_json(silent=True) or {}
    product_id = body.get('product_id', '').strip()
    tag        = body.get('tag', '').strip()

    if not product_id or not tag:
        return jsonify({'success': False, 'error': 'product_id and tag required'}), 400

    headers  = get_headers()
    prod_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/products/{product_id}.json"
    try:
        resp          = requests.get(prod_url, headers=headers, params={"fields": "id,tags"})
        resp.raise_for_status()
        product       = resp.json().get('product', {})
        existing_tags = product.get('tags', '')
        tag_list      = [t.strip() for t in existing_tags.split(',') if t.strip() and t.strip() != tag]
        updated = requests.put(prod_url, headers=headers,
                               json={"product": {"id": product_id, "tags": ', '.join(tag_list)}})
        updated.raise_for_status()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    

@app.route('/api/stock/generate_pdf', methods=['POST'])
def generate_pdf():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500

    body = request.get_json(silent=True) or {}
    product_ids = body.get('product_ids', [])
    
    if not product_ids:
        return jsonify({'success': False, 'error': 'No products selected.'}), 400

    ns = METAFIELD_NAMESPACE()
    wholesale_key = WHOLESALE_PRICE_KEY()
    
    # Shopify GraphQL nodes query for multiple IDs
    ids_gql = ', '.join([f'"{pid}"' for pid in product_ids])
    query = f"""
    {{
      nodes(ids: [{ids_gql}]) {{
        ... on Product {{
          id
          title
          featuredImage {{ url }}
          variants(first: 1) {{
            edges {{
              node {{
                sku
                price
              }}
            }}
          }}
          wholesalePriceMetafield: metafield(namespace: "{ns}", key: "{wholesale_key}") {{
            value
          }}
        }}
      }}
    }}
    """
    
    data = run_graphql_query(query)
    if not data or 'data' not in data or not data['data'].get('nodes'):
        return jsonify({'success': False, 'error': 'Failed to fetch product data.'}), 500
        
    products = []
    for node in data['data']['nodes']:
        if node:
            v_edges = node.get('variants', {}).get('edges', [])
            variant = v_edges[0]['node'] if v_edges else {}
            products.append({
                'title': node.get('title', 'N/A'),
                'image_url': node['featuredImage']['url'] if node.get('featuredImage') else None,
                'sku': variant.get('sku', 'N/A'),
                'retail_price': variant.get('price', '0.00'),
                'wholesale_price': node.get('wholesalePriceMetafield', {}).get('value', '0.00') if node.get('wholesalePriceMetafield') else '0.00'
            })

    if not products:
        return jsonify({'success': False, 'error': 'No valid products found.'}), 404

    # Generate PDF – 3×3 equal boxes per page with image + details
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=0.4*inch, rightMargin=0.4*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    elements = []
    styles = getSampleStyleSheet()

    def add_watermark(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.Color(0.5, 0.5, 0.5))
        canvas.setFillAlpha(0.08)
        canvas.setFont('Helvetica', 50)
        canvas.translate(letter[0]/2, letter[1]/2)
        canvas.rotate(30)
        canvas.drawCentredString(0, 0, "Universal Shopify Tools")
        canvas.restoreState()

    title_style = ParagraphStyle('CT', parent=styles['Normal'], fontSize=8, leading=10, alignment=1, spaceAfter=2)
    detail_style = ParagraphStyle('CD', parent=styles['Normal'], fontSize=7, leading=9, alignment=1)

    # Account for default Frame padding (6pt each side) so the 3×3 table fits exactly
    frame_pad = 6
    avail_w = letter[0] - 0.8*inch - 2*frame_pad
    avail_h = letter[1] - 1.0*inch - 2*frame_pad
    col_w = avail_w / 3
    row_h = avail_h / 3

    for start in range(0, len(products), 9):
        chunk = products[start:start + 9]
        table_data = []
        idx = 0
        for r in range(3):
            row = []
            for c in range(3):
                if idx < len(chunk):
                    p = chunk[idx]
                    inner = []

                    # Image
                    if p['image_url']:
                        try:
                            img_resp = requests.get(p['image_url'], timeout=10)
                            if img_resp.status_code == 200:
                                img_data = io.BytesIO(img_resp.content)
                                img = Image(img_data, width=0.9*inch, height=0.9*inch)
                                img.hAlign = 'CENTER'
                                inner.append(img)
                        except Exception:
                            inner.append(Spacer(1, 0.9*inch))
                    else:
                        inner.append(Spacer(1, 0.9*inch))

                    inner.append(Spacer(1, 4))
                    inner.append(Paragraph(f"<b>{p['title']}</b>", title_style))
                    inner.append(Paragraph(f"SKU: {p['sku']}", detail_style))
                    inner.append(Spacer(1, 2))
                    inner.append(Paragraph(f"Retail: <b>${p['retail_price']}</b>", detail_style))
                    inner.append(Paragraph(f"Wholesale: <b>${p['wholesale_price']}</b>", detail_style))

                    cell = Table([[e] for e in inner], colWidths=[col_w - 12])
                    cell.setStyle(TableStyle([
                        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                        ('TOPPADDING', (0,0), (-1,-1), 4),
                        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                    ]))
                    row.append(cell)
                else:
                    row.append("")
                idx += 1
            table_data.append(row)

        t = Table(table_data, colWidths=[col_w]*3, rowHeights=[row_h]*3)
        t.setStyle(TableStyle([
            ('BOX', (0,0), (-1,-1), 0.5, colors.Color(0.5,0.5,0.5,alpha=0.4)),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.Color(0.5,0.5,0.5,alpha=0.4)),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ]))
        elements.append(t)

        if start + 9 < len(products):
            elements.append(PageBreak())

    try:
        doc.build(elements, onFirstPage=add_watermark, onLaterPages=add_watermark)
    except Exception as e:
        return jsonify({'success': False, 'error': f'PDF generation error: {str(e)}'}), 500
    
    buffer.seek(0)
    return send_file(
        buffer,
        as_attachment=True,
        download_name=f'stock_catalog_{datetime.datetime.now().strftime("%Y%m%d")}.pdf',
        mimetype='application/pdf'
    )


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

# ── Replace your existing /api/search_products route with this version ───────
# Added numeric_id to results so category product management can use it

@app.route('/api/search_products', methods=['GET'])
def search_products():
    if not credentials_ok():
        return jsonify({'success': False, 'error': 'No store profile active.'}), 500
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'success': False, 'error': 'Query required'}), 400

    headers     = get_headers()
    graphql_url = f"https://{SHOPIFY_STORE_URL()}/admin/api/{SHOPIFY_API_VERSION()}/graphql.json"
    safe_q      = q.replace('"', '').replace('\\', '')
    gql = """
    {
      products(first: 30, query: "title:*""" + safe_q + """* OR sku:""" + safe_q + """") {
        edges {
          node {
            id
            title
            featuredImage { url }
            variants(first: 20) {
              edges {
                node {
                  sku
                  title
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }
    """
    try:
        resp = requests.post(graphql_url, headers=headers, json={'query': gql})
        resp.raise_for_status()
        data    = resp.json()
        results = []
        for edge in data.get('data', {}).get('products', {}).get('edges', []):
            node       = edge['node']
            title      = node.get('title') or 'Unknown Product'
            img        = node['featuredImage']['url'] if node.get('featuredImage') else None
            # Extract numeric ID from GID e.g. "gid://shopify/Product/123" -> "123"
            numeric_id = node['id'].split('/')[-1]
            for v in node['variants']['edges']:
                vnode         = v['node']
                sku           = (vnode.get('sku') or '').strip()
                if not sku:
                    continue
                variant_title = vnode.get('title') or ''
                display       = title if variant_title in ('Default Title', '') else f"{title} — {variant_title}"
                results.append({
                    'sku':        sku,
                    'name':       display,
                    'image':      img,
                    'stock':      vnode.get('inventoryQuantity', 0),
                    'product_id': numeric_id,   # <-- added
                    'gid':        node['id'],    # <-- added (for threshold updates)
                })
        return jsonify({'success': True, 'results': results})
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
    app.run(debug=False)