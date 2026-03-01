import os
import sys
import threading
import requests
from flask import Flask, render_template, jsonify, request, abort
from datetime import datetime

# ── PyInstaller path resolution ──────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    TEMPLATE_DIR = os.path.join(sys._MEIPASS, 'templates')
    STATIC_DIR = os.path.join(sys._MEIPASS, 'static')
    app = Flask(__name__, template_folder=TEMPLATE_DIR, static_folder=STATIC_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    app = Flask(__name__)

# ── Load credentials ─────────────────────────────────────────────────────────
def load_credentials():
    config_path = os.path.join(BASE_DIR, 'config.txt')
    if os.path.exists(config_path):
        print(f"[CONFIG] Loading from: {config_path}")
        with open(config_path, 'r') as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    key, _, value = line.partition('=')
                    os.environ[key.strip()] = value.strip()
    else:
        print(f"[CONFIG] config.txt not found at {config_path} — falling back to environment variables.")

load_credentials()

SHOPIFY_STORE_URL = os.getenv('SHOPIFY_STORE_URL', '')
SHOPIFY_ACCESS_TOKEN = os.getenv('SHOPIFY_ACCESS_TOKEN', '')
SHOPIFY_API_VERSION = os.getenv('SHOPIFY_API_VERSION', '2024-07')

print(f"[STARTUP] BASE_DIR: {BASE_DIR}")
print(f"[STARTUP] Store URL: {SHOPIFY_STORE_URL}")
print(f"[STARTUP] Token loaded: {'YES' if SHOPIFY_ACCESS_TOKEN else 'NO'}")

# ── Stock App Config ─────────────────────────────────────────────────────────
METAFIELD_NAMESPACE = os.getenv('METAFIELD_NAMESPACE', '')
METAFIELD_KEY = os.getenv('METAFIELD_KEY', '')

STOCK_CATEGORIES = {
    "simple": {"tag": "HJMQS", "title": "Simple"},
    "2-button": {"tag": "HJMQ2B", "title": "2 Button"},
    "7-button": {"tag": "HJMQ7B", "title": "7 Button"},
    "quilt": {"tag": "HJMQQ", "title": "Quilt"},
}

def get_headers():
    return {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json"
    }

def credentials_ok():
    return bool(SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN)

# ── Shared: fetch order with inventory data ──────────────────────────────────
def fetch_order_data(order_identifier):
    """Fetch order + inventory info. Returns (order_dict, error_str, status_code)."""
    if not credentials_ok():
        return None, "Shopify credentials not configured. Please check config.txt.", 500

    headers = get_headers()
    shopify_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/orders.json"
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
                variant_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/variants/{variant_id}.json"
                variant_resp = requests.get(variant_url, headers=headers)
                if variant_resp.status_code == 200:
                    variant_data = variant_resp.json().get("variant", {})
                    inventory_item_id = variant_data.get("inventory_item_id")
                    variant_cache[variant_id] = inventory_item_id

        if inventory_item_id:
            inventory_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/inventory_levels.json"
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

        image_url = None
        if product_id and product_id not in image_cache:
            product_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/products/{product_id}.json?fields=images"
            prod_resp = requests.get(product_url, headers=headers)
            if prod_resp.status_code == 200:
                product_data = prod_resp.json().get("product")
                if product_data and product_data.get("images"):
                    image_url = next((img["src"] for img in product_data["images"] if variant_id in img.get("variant_ids", [])), None)
                    if not image_url:
                        image_url = product_data["images"][0].get("src")
            image_cache[product_id] = image_url

        final_image_url = image_cache.get(product_id)

        line_items.append({
            "product_id": product_id,
            "variant_id": variant_id,
            "title": item.get('title'),
            "quantity": item.get('quantity'),
            "sku": item.get('sku'),
            "size": item.get('variant_title'),
            "product_image": final_image_url,
            "in_stock": in_stock,
            "available_quantity": available_quantity
        })

    return {
        "order_id": order.get('id'),
        "order_name": order.get('name'),
        "line_items": line_items,
        "fulfillment_status": order.get('fulfillment_status'),
        "tags": order.get('tags', '')
    }, None, 200

# ════════════════════════════════════════════════════════════════════════════
# ROUTES - Navigation
# ════════════════════════════════════════════════════════════════════════════

@app.route('/')
def home():
    return render_template('index.html', active_page='scan')

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
        return jsonify({"error": "Shopify credentials not configured."}), 500
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/orders/{order_id}.json"
    try:
        response = requests.get(order_url, headers=headers, params={"fields": "tags"})
        response.raise_for_status()
        order = response.json().get('order')
        existing_tags = order.get("tags", "")
        new_tag = "Packed"
        updated_tags = f"{existing_tags}, {new_tag}".strip(", ")
        update_payload = {"order": {"id": order_id, "tags": updated_tags}}
        update_response = requests.put(order_url, headers=headers, json=update_payload)
        update_response.raise_for_status()
        return jsonify({"message": "Order tagged successfully", "tag": new_tag})
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

@app.route('/api/tag_order', methods=['POST'])
def tag_order_as_paid():
    if not credentials_ok():
        return jsonify({"error": "Shopify credentials not configured."}), 500
    data = request.get_json()
    order_id = data.get('order_id')
    if not order_id:
        return jsonify({"error": "order_id is required"}), 400
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/orders/{order_id}.json"
    try:
        response = requests.get(order_url, headers=headers, params={"fields": "tags"})
        response.raise_for_status()
        order = response.json().get('order')
        existing_tags = order.get("tags", "")
        new_tag = "Paid"
        updated_tags = f"{existing_tags}, {new_tag}".strip(", ")
        update_payload = {"order": {"id": order_id, "tags": updated_tags}}
        update_response = requests.put(order_url, headers=headers, json=update_payload)
        update_response.raise_for_status()
        return jsonify({"message": "Order tagged as Paid", "tag": new_tag})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/mark_paid_batch', methods=['POST'])
def mark_paid_batch():
    if not credentials_ok():
        return jsonify({"error": "Shopify credentials not configured."}), 500
    data = request.get_json()
    order_ids = data.get('order_ids', [])
    if not order_ids:
        return jsonify({"error": "order_ids list is required"}), 400

    headers = get_headers()
    results = []
    for order_id in order_ids:
        order_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/orders/{order_id}.json"
        try:
            resp = requests.get(order_url, headers=headers, params={"fields": "tags,name"})
            resp.raise_for_status()
            order = resp.json().get('order', {})
            existing_tags = order.get("tags", "")
            updated_tags = f"{existing_tags}, Paid".strip(", ")
            update_payload = {"order": {"id": order_id, "tags": updated_tags}}
            update_resp = requests.put(order_url, headers=headers, json=update_payload)
            update_resp.raise_for_status()
            results.append({"order_id": order_id, "name": order.get("name"), "status": "success"})
        except Exception as e:
            results.append({"order_id": order_id, "status": "error", "details": str(e)})

    return jsonify({"results": results})

@app.route('/check_csv_orders', methods=['POST'])
def check_csv_orders():
    if not credentials_ok():
        return jsonify({"error": "Shopify credentials not configured."}), 500
    data = request.get_json()
    order_names = data.get('order_names', [])
    headers = get_headers()
    results = []
    for name in order_names:
        shopify_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/orders.json"
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
        return jsonify({"error": "Shopify credentials not configured."}), 500
    headers = get_headers()
    order_url = f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/orders/{order_id}.json"
    try:
        response = requests.get(order_url, headers=headers, params={"fields": "tags"})
        response.raise_for_status()
        order = response.json().get('order')
        existing_tags = order.get("tags", "")
        new_tag = "Returned"
        updated_tags = f"{existing_tags}, {new_tag}".strip(", ")
        update_payload = {"order": {"id": order_id, "tags": updated_tags}}
        update_response = requests.put(order_url, headers=headers, json=update_payload)
        update_response.raise_for_status()
        return jsonify({"message": "Order tagged as Returned", "tag": new_tag})
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": "Shopify API error", "details": e.response.text}), e.response.status_code
    except Exception as e:
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

# ════════════════════════════════════════════════════════════════════════════
# STOCK APP
# ════════════════════════════════════════════════════════════════════════════

def get_graphql_url():
    return f"https://{SHOPIFY_STORE_URL}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"

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
            "title": node['title'],
            "image_url": node['featuredImage']['url'] if node.get('featuredImage') else None,
            "current_qty": current_qty,
            "threshold": threshold,
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
                        "title": node['title'],
                        "image_url": node['featuredImage']['url'] if node.get('featuredImage') else None,
                        "current_qty": qty,
                        "needed_qty": 0 - qty
                    })
    sorted_products = sorted(products_to_display, key=lambda p: p['needed_qty'], reverse=True)
    return render_template('urgent_page.html', products=sorted_products, page_title="Urgent", active_page='stock', active_stock='urgent')

@app.route('/stock/<category_slug>')
def show_category(category_slug):
    if category_slug not in STOCK_CATEGORIES:
        abort(404)
    category = STOCK_CATEGORIES[category_slug]
    tag = category["tag"]
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
            metafield(namespace: "{METAFIELD_NAMESPACE}", key: "{METAFIELD_KEY}") {{
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

# ── Diagnostics ──────────────────────────────────────────────────────────────
@app.route('/api/check_config')
def check_config():
    return jsonify({
        "store_url": SHOPIFY_STORE_URL,
        "token_loaded": bool(SHOPIFY_ACCESS_TOKEN),
        "token_last8": SHOPIFY_ACCESS_TOKEN[-8:] if SHOPIFY_ACCESS_TOKEN else "MISSING",
        "api_version": SHOPIFY_API_VERSION,
        "base_dir": BASE_DIR
    })

# ── Startup ──────────────────────────────────────────────────────────────────
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
        height=800
    )
    webview.start()