import os
import json
import random
import string
import sqlite3
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template_string, redirect, url_for, session

app = Flask(__name__)
app.secret_key = 'USHT#SECRET#2024'

ADMIN_PASSWORD = 'USHT#ADMIN'
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'keys.db')

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS keys (
                key                TEXT PRIMARY KEY,
                plan               TEXT NOT NULL,
                customer           TEXT DEFAULT '',
                revoked            INTEGER DEFAULT 0,
                free_trial         INTEGER DEFAULT 0,
                created_at         TEXT,
                expires_at         TEXT,
                last_seen          TEXT,
                last_ip            TEXT,
                usage_count        INTEGER DEFAULT 0,
                has_sap            INTEGER DEFAULT 1,
                has_map            INTEGER DEFAULT 1,
                has_mar            INTEGER DEFAULT 1,
                has_qty_deduction  INTEGER DEFAULT 1,
                has_accountant     INTEGER DEFAULT 1,
                has_stock_app      INTEGER DEFAULT 1
            )
        ''')
        conn.commit()

init_db()

PLANS = {
    'BASIC':    {'label': 'Basic',    'monthly': True,  'price': 'Rs. 2,000/month'},
    'PRO':      {'label': 'Pro',      'monthly': True,  'price': 'Rs. 2,500/month'},
    'LIFETIME': {'label': 'Lifetime', 'monthly': False, 'price': 'Rs. 30,000'},
}

def row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    for field in ('revoked', 'free_trial', 'has_sap', 'has_map', 'has_mar',
                  'has_qty_deduction', 'has_accountant', 'has_stock_app'):
        d[field] = bool(d.get(field, 1))
    return d

def load_keys():
    with get_db() as conn:
        rows = conn.execute('SELECT * FROM keys').fetchall()
    return {row['key']: row_to_dict(row) for row in rows}

def get_key(key):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM keys WHERE key = ?', (key,)).fetchone()
    return row_to_dict(row)

def save_key(key, entry):
    with get_db() as conn:
        conn.execute('''
            INSERT INTO keys (key, plan, customer, revoked, free_trial, created_at,
                expires_at, last_seen, last_ip, usage_count,
                has_sap, has_map, has_mar, has_qty_deduction, has_accountant, has_stock_app)
            VALUES (:key, :plan, :customer, :revoked, :free_trial, :created_at,
                :expires_at, :last_seen, :last_ip, :usage_count,
                :has_sap, :has_map, :has_mar, :has_qty_deduction, :has_accountant, :has_stock_app)
            ON CONFLICT(key) DO UPDATE SET
                plan=excluded.plan, customer=excluded.customer,
                revoked=excluded.revoked, free_trial=excluded.free_trial,
                created_at=excluded.created_at, expires_at=excluded.expires_at,
                last_seen=excluded.last_seen, last_ip=excluded.last_ip,
                usage_count=excluded.usage_count,
                has_sap=excluded.has_sap, has_map=excluded.has_map,
                has_mar=excluded.has_mar, has_qty_deduction=excluded.has_qty_deduction,
                has_accountant=excluded.has_accountant, has_stock_app=excluded.has_stock_app
        ''', {**entry, 'key': key})
        conn.commit()

def generate_key(plan):
    chars = string.ascii_uppercase + string.digits
    part1 = ''.join(random.choices(chars, k=3))
    part2 = ''.join(random.choices(chars, k=3))
    return f'USHT-{plan}-{part1}-{part2}'

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated

@app.route('/api/store_token', methods=['POST'])
def save_store_token():
    body         = request.get_json(silent=True) or {}
    license_key  = (body.get('license_key') or '').strip().upper()
    shop         = (body.get('shop') or '').strip()
    access_token = (body.get('access_token') or '').strip()

    if not license_key or not shop or not access_token:
        return jsonify({'success': False, 'error': 'Missing fields'}), 400

    # Verify the license key exists and is valid
    entry = get_key(license_key)
    if not entry or entry.get('revoked'):
        return jsonify({'success': False, 'error': 'Invalid license key'}), 403

    with get_db() as conn:
        conn.execute('''
            INSERT INTO store_tokens (license_key, shop, access_token, connected_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(license_key) DO UPDATE SET
                shop=excluded.shop,
                access_token=excluded.access_token,
                connected_at=excluded.connected_at
        ''', (license_key, shop, access_token, datetime.utcnow().isoformat()))
        conn.commit()

    return jsonify({'success': True})


@app.route('/api/store_token', methods=['GET'])
def get_store_token():
    license_key = (request.args.get('license_key') or '').strip().upper()

    if not license_key:
        return jsonify({'success': False, 'error': 'Missing license_key'}), 400

    with get_db() as conn:
        row = conn.execute(
            'SELECT shop, access_token FROM store_tokens WHERE license_key = ?',
            (license_key,)
        ).fetchone()

    if not row:
        return jsonify({'success': False, 'error': 'No store connected'}), 404

    return jsonify({
        'success':      True,
        'shop':         row['shop'],
        'access_token': row['access_token']
    })

@app.route('/api/validate', methods=['POST'])
def validate():
    body = request.get_json(silent=True) or {}
    key  = (body.get('key') or '').strip().upper()
    if not key:
        return jsonify({'valid': False, 'error': 'No key provided'}), 400
    entry = get_key(key)
    if not entry:
        return jsonify({'valid': False, 'error': 'Invalid license key'}), 200
    entry['last_seen']   = datetime.utcnow().isoformat()
    entry['last_ip']     = request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown').split(',')[0].strip()
    entry['usage_count'] = entry.get('usage_count', 0) + 1
    save_key(key, entry)
    if entry.get('revoked'):
        return jsonify({'valid': False, 'error': 'Invalid license key'}), 200
    if entry.get('expires_at'):
        expires = datetime.fromisoformat(entry['expires_at'])
        if datetime.utcnow() > expires:
            return jsonify({'valid': False, 'error': 'License key has expired. Please renew your subscription.'}), 200
    return jsonify({
        'valid': True, 'plan': entry['plan'],
        'label': PLANS[entry['plan']]['label'],
        'expires_at': entry.get('expires_at'),
        'customer': entry.get('customer', ''),
        'free_trial': entry.get('free_trial', False),
        'permissions': {
            'has_sap': entry.get('has_sap', True),
            'has_map': entry.get('has_map', True),
            'has_mar': entry.get('has_mar', True),
            'has_qty_deduction': entry.get('has_qty_deduction', True),
            'has_accountant': entry.get('has_accountant', True),
            'has_stock_app': entry.get('has_stock_app', True),
        }
    }), 200

@app.route('/api/get_permissions', methods=['POST'])
def get_permissions():
    body = request.get_json(silent=True) or {}
    key  = (body.get('key') or '').strip().upper()
    if not key:
        return jsonify({'error': 'No key provided'}), 400
    entry = get_key(key)
    if not entry:
        return jsonify({'error': 'Invalid license key'}), 404
    return jsonify({
        'has_sap': entry.get('has_sap', True),
        'has_map': entry.get('has_map', True),
        'has_mar': entry.get('has_mar', True),
        'has_qty_deduction': entry.get('has_qty_deduction', True),
        'has_accountant': entry.get('has_accountant', True),
        'has_stock_app': entry.get('has_stock_app', True),
    })

LOGIN_HTML = '''<!DOCTYPE html><html><head><meta charset="UTF-8"><title>USHT Admin</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0f0f1d;color:#e0e0e0;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a2e;border:1px solid #33334d;border-radius:12px;padding:2rem;width:340px}h1{color:#e94560;font-size:1.3em;font-weight:500;margin-bottom:1.5rem;text-align:center}input{width:100%;padding:10px 12px;background:#2b2b40;border:1px solid #44446b;border-radius:6px;color:#e0e0e0;font-size:.95em;margin-bottom:12px}button{width:100%;padding:11px;background:#e94560;color:#fff;border:none;border-radius:6px;font-size:1em;cursor:pointer}.error{color:#e94560;font-size:.85em;margin-bottom:10px;text-align:center}</style>
</head><body><div class="card"><h1>USHT Admin</h1>{% if error %}<p class="error">{{ error }}</p>{% endif %}
<form method="post"><input type="password" name="password" placeholder="Admin password" autofocus><button type="submit">Login</button></form></div></body></html>'''

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == ADMIN_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('admin_dashboard'))
        error = 'Wrong password'
    return render_template_string(LOGIN_HTML, error=error)

@app.route('/admin/logout')
def admin_logout():
    session.clear()
    return redirect(url_for('admin_login'))

DASHBOARD_HTML = '''<!DOCTYPE html><html><head><meta charset="UTF-8"><title>USHT Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f1d;color:#e0e0e0;font-family:-apple-system,sans-serif;padding:2rem}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem}
h1{color:#e94560;font-size:1.4em;font-weight:500}
.logout{color:#b0b0b0;font-size:.85em;text-decoration:none;border:1px solid #33334d;padding:6px 14px;border-radius:6px}
.logout:hover{border-color:#e94560;color:#e94560}
.stats{display:flex;gap:12px;margin-bottom:1.5rem;flex-wrap:wrap}
.stat{background:#1a1a2e;border:1px solid #33334d;border-radius:8px;padding:12px 18px}
.stat .num{font-size:1.6em;font-weight:500;color:#e94560}
.stat .lbl{font-size:.75em;color:#b0b0b0;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
.gen-card{background:#1a1a2e;border:1px solid #33334d;border-radius:10px;padding:1.25rem;margin-bottom:2rem;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.gen-card label{font-size:.78em;color:#b0b0b0;display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em}
.gen-card input,.gen-card select{padding:9px 12px;background:#2b2b40;border:1px solid #44446b;border-radius:6px;color:#e0e0e0;font-size:.9em}
.gen-card input{width:220px}
.new-key-box{background:#0f3d1f;border:1px solid #22c55e;border-radius:8px;padding:12px 16px;margin-bottom:1.5rem;display:none}
.new-key-box.show{display:block}
.new-key-box p{font-size:.82em;color:#22c55e;margin-bottom:6px}
.new-key-box code{font-size:1.1em;color:#fff;letter-spacing:.05em}
table{width:100%;border-collapse:collapse;font-size:.85em}
th{text-align:left;padding:8px 12px;background:#0f0f1d;color:#b0b0b0;font-size:.75em;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #33334d;white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid #1e1e35;vertical-align:middle}
tr:hover td{background:#1a1a2e}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.78em;font-weight:500}
.badge.BASIC{background:rgba(96,165,250,.15);color:#60a5fa}
.badge.PRO{background:rgba(192,132,252,.15);color:#c084fc}
.badge.LIFETIME{background:rgba(34,197,94,.15);color:#22c55e}
.badge.revoked{background:rgba(233,69,96,.15);color:#e94560}
.badge.expired{background:rgba(234,179,8,.15);color:#facc15}
.badge.free_trial{background:rgba(234,179,8,.15);color:#facc15}
.key-code{font-family:monospace;letter-spacing:.04em;color:#e0e0e0;font-size:.88em}
.muted{color:#666;font-size:.82em}
.btn{padding:5px 12px;border:none;border-radius:5px;cursor:pointer;font-size:.78em;font-weight:600;transition:filter .15s}
.btn:hover{filter:brightness(1.1)}
.btn.primary{background:#e94560;color:#fff}
.btn.outline{background:none;border:1px solid #44446b;color:#b0b0b0}
.btn.outline:hover{border-color:#e94560;color:#e94560}
.btn.green{background:none;border:1px solid #22c55e;color:#22c55e}
.btn.green:hover{background:#22c55e;color:#0f0f1d}
.btn.yellow{background:none;border:1px solid #facc15;color:#facc15}
.btn.yellow:hover{background:#facc15;color:#0f0f1d}
.actions{display:flex;gap:5px;flex-wrap:wrap}
.empty{padding:2rem;text-align:center;color:#555}
.flags-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;width:100%}
.flag-item{display:flex;align-items:center;gap:6px;font-size:.78em;color:#b0b0b0}
.flag-item input{width:auto;margin:0}
.perm-badge{font-size:.7em;padding:1px 5px;border-radius:4px;border:1px solid #33334d;color:#666}
.perm-badge.active{border-color:#22c55e;color:#22c55e;background:rgba(34,197,94,0.1)}
.modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:none;align-items:center;justify-content:center;z-index:1000}
.modal{background:#1a1a2e;border:1px solid #33334d;border-radius:12px;padding:2rem;width:400px;box-shadow:0 10px 40px rgba(0,0,0,0.5)}
.modal h2{color:#e94560;font-size:1.2rem;margin-bottom:1.5rem}
.modal .btn-row{display:flex;gap:10px;margin-top:1.5rem;justify-content:flex-end}
</style></head><body>
<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <h2 id="modalTitle">Edit Flags</h2>
    <div class="flags-grid" id="modalFlags">
      <label class="flag-item"><input type="checkbox" id="m_has_sap"> SAP</label>
      <label class="flag-item"><input type="checkbox" id="m_has_map"> MAP</label>
      <label class="flag-item"><input type="checkbox" id="m_has_mar"> MAR</label>
      <label class="flag-item"><input type="checkbox" id="m_has_qty_deduction"> QTY</label>
      <label class="flag-item"><input type="checkbox" id="m_has_accountant"> ACC</label>
      <label class="flag-item"><input type="checkbox" id="m_has_stock_app"> STOCK</label>
    </div>
    <div class="btn-row">
      <button class="btn outline" onclick="closeModal()">Cancel</button>
      <button class="btn primary" id="saveFlagsBtn">Save Changes</button>
    </div>
  </div>
</div>
<div class="top"><h1>USHT License Admin</h1><a href="/admin/logout" class="logout">Logout</a></div>
<div class="stats">
  <div class="stat"><div class="num">{{ total }}</div><div class="lbl">Total</div></div>
  <div class="stat"><div class="num">{{ active }}</div><div class="lbl">Active</div></div>
  <div class="stat"><div class="num">{{ trials }}</div><div class="lbl">Free Trial</div></div>
  <div class="stat"><div class="num">{{ revoked }}</div><div class="lbl">Revoked</div></div>
  <div class="stat"><div class="num">{{ expired }}</div><div class="lbl">Expired</div></div>
</div>
<div class="gen-card">
  <div><label>Customer name</label><input type="text" id="customer" placeholder="e.g. Ahmed Store"></div>
  <div><label>Plan</label><select id="plan">
    <option value="BASIC">Basic - Rs. 2,000/month</option>
    <option value="PRO">Pro - Rs. 2,500/month</option>
    <option value="LIFETIME">Lifetime - Rs. 30,000</option>
  </select></div>
  <div class="flags-grid">
    <label class="flag-item"><input type="checkbox" id="has_sap" checked> SAP</label>
    <label class="flag-item"><input type="checkbox" id="has_map" checked> MAP</label>
    <label class="flag-item"><input type="checkbox" id="has_mar" checked> MAR</label>
    <label class="flag-item"><input type="checkbox" id="has_qty_deduction" checked> QTY</label>
    <label class="flag-item"><input type="checkbox" id="has_accountant" checked> ACC</label>
    <label class="flag-item"><input type="checkbox" id="has_stock_app" checked> STOCK</label>
  </div>
  <button class="btn primary" onclick="generateKey()" style="margin-top:10px">Generate Key</button>
</div>
<div class="new-key-box" id="newKeyBox"><p>New key generated - copy and send to customer:</p><code id="newKeyCode"></code></div>
<table><thead><tr>
  <th>Key</th><th>Customer</th><th>Plan</th><th>Status</th><th>Modules</th><th>Last Seen</th><th>Last IP</th><th>Uses</th><th>Expires</th><th>Actions</th>
</tr></thead><tbody>
{% for key, e in keys.items() %}
<tr>
  <td class="key-code">{{ key }}</td>
  <td>{{ e.customer or "-" }}</td>
  <td><span class="badge {{ e.plan }}">{{ e.plan }}</span></td>
  <td>
    {% if e.revoked %}<span class="badge revoked">Revoked</span>
    {% elif e.expires_at and e.expires_at < now_str %}<span class="badge expired">Expired</span>
    {% elif e.free_trial %}<span class="badge free_trial">Free Trial</span>
    {% else %}<span class="badge {{ e.plan }}">Active</span>{% endif %}
  </td>
  <td>
    <div style="display:flex;gap:3px;flex-wrap:wrap">
        <span class="perm-badge {{ 'active' if e.get('has_sap', True) else '' }}">SAP</span>
        <span class="perm-badge {{ 'active' if e.get('has_map', True) else '' }}">MAP</span>
        <span class="perm-badge {{ 'active' if e.get('has_mar', True) else '' }}">MAR</span>
        <span class="perm-badge {{ 'active' if e.get('has_qty_deduction', True) else '' }}">QTY</span>
        <span class="perm-badge {{ 'active' if e.get('has_accountant', True) else '' }}">ACC</span>
        <span class="perm-badge {{ 'active' if e.get('has_stock_app', True) else '' }}">STK</span>
    </div>
  </td>
  <td class="muted">{{ e.last_seen[:16].replace("T"," ") if e.last_seen else "Never" }}</td>
  <td class="muted">{{ e.last_ip or "-" }}</td>
  <td class="muted">{{ e.usage_count or 0 }}</td>
  <td class="muted">{{ e.expires_at[:10] if e.expires_at else "Never" }}</td>
  <td><div class="actions">
    {% if e.revoked %}
      <form method="post" action="/admin/restore"><input type="hidden" name="key" value="{{ key }}"><button class="btn green">Restore</button></form>
    {% else %}
      {% if e.free_trial %}
        <form method="post" action="/admin/set_state"><input type="hidden" name="key" value="{{ key }}"><input type="hidden" name="state" value="active"><button class="btn outline">Set Active</button></form>
      {% else %}
        <form method="post" action="/admin/set_state"><input type="hidden" name="key" value="{{ key }}"><input type="hidden" name="state" value="free_trial"><button class="btn yellow">Free Trial</button></form>
      {% endif %}
      <form method="post" action="/admin/revoke" onsubmit="return confirm('Revoke this key?')"><input type="hidden" name="key" value="{{ key }}"><button class="btn outline" style="border-color:#e94560;color:#e94560;">Revoke</button></form>
    {% endif %}
    <button class="btn outline" onclick="editFlags('{{ key }}', {{ e.get('has_sap', True)|tojson }}, {{ e.get('has_map', True)|tojson }}, {{ e.get('has_mar', True)|tojson }}, {{ e.get('has_qty_deduction', True)|tojson }}, {{ e.get('has_accountant', True)|tojson }}, {{ e.get('has_stock_app', True)|tojson }})">Flags</button>
  </div></td>
</tr>
{% else %}<tr><td colspan="9" class="empty">No keys yet</td></tr>{% endfor %}
</tbody></table>
<script>
async function generateKey() {
  const body = {
    customer: document.getElementById('customer').value.trim(),
    plan: document.getElementById('plan').value,
    has_sap: document.getElementById('has_sap').checked,
    has_map: document.getElementById('has_map').checked,
    has_mar: document.getElementById('has_mar').checked,
    has_qty_deduction: document.getElementById('has_qty_deduction').checked,
    has_accountant: document.getElementById('has_accountant').checked,
    has_stock_app: document.getElementById('has_stock_app').checked
  };
  const res  = await fetch('/admin/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json();
  if (data.key) { document.getElementById('newKeyCode').textContent=data.key; document.getElementById('newKeyBox').classList.add('show'); setTimeout(()=>location.reload(),2500); }
}
function editFlags(key, sap, map, mar, qty, acc, stk) {
    document.getElementById('modalTitle').textContent = `Flags: ${key}`;
    document.getElementById('m_has_sap').checked = sap;
    document.getElementById('m_has_map').checked = map;
    document.getElementById('m_has_mar').checked = mar;
    document.getElementById('m_has_qty_deduction').checked = qty;
    document.getElementById('m_has_accountant').checked = acc;
    document.getElementById('m_has_stock_app').checked = stk;
    
    document.getElementById('saveFlagsBtn').onclick = () => saveAllFlags(key);
    document.getElementById('modalOverlay').style.display = 'flex';
}
function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}
async function saveAllFlags(key) {
    const body = {
        key: key,
        flags: {
            has_sap:           document.getElementById('m_has_sap').checked,
            has_map:           document.getElementById('m_has_map').checked,
            has_mar:           document.getElementById('m_has_mar').checked,
            has_qty_deduction: document.getElementById('m_has_qty_deduction').checked,
            has_accountant:    document.getElementById('m_has_accountant').checked,
            has_stock_app:     document.getElementById('m_has_stock_app').checked
        }
    };
    const res = await fetch('/admin/update_flags', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    if (res.ok) location.reload();
}
</script></body></html>'''

@app.route('/admin')
@login_required
def admin_dashboard():
    keys    = load_keys()
    now_str = datetime.utcnow().isoformat()
    total   = len(keys)
    revoked = sum(1 for e in keys.values() if e.get('revoked'))
    expired = sum(1 for e in keys.values() if not e.get('revoked') and e.get('expires_at') and e['expires_at'] < now_str)
    trials  = sum(1 for e in keys.values() if not e.get('revoked') and e.get('free_trial'))
    active  = total - revoked - expired - trials
    return render_template_string(DASHBOARD_HTML,
        keys=dict(sorted(keys.items(), key=lambda x: x[1].get('created_at',''), reverse=True)),
        total=total, active=active, revoked=revoked, expired=expired, trials=trials, now_str=now_str)

@app.route('/admin/generate', methods=['POST'])
@login_required
def admin_generate():
    body     = request.get_json(silent=True) or {}
    plan     = body.get('plan', 'BASIC').upper()
    customer = body.get('customer', '').strip()
    if plan not in PLANS:
        return jsonify({'error': 'Invalid plan'}), 400
    key   = generate_key(plan)
    entry = {
        'plan': plan, 'customer': customer, 'revoked': False, 'free_trial': False,
        'created_at': datetime.utcnow().isoformat(), 'expires_at': None,
        'last_seen': None, 'last_ip': None, 'usage_count': 0,
        'has_sap': body.get('has_sap', True),
        'has_map': body.get('has_map', True),
        'has_mar': body.get('has_mar', True),
        'has_qty_deduction': body.get('has_qty_deduction', True),
        'has_accountant': body.get('has_accountant', True),
        'has_stock_app': body.get('has_stock_app', True),
    }
    if PLANS[plan]['monthly']:
        entry['expires_at'] = (datetime.utcnow() + timedelta(days=30)).isoformat()
    save_key(key, entry)
    return jsonify({'key': key})

@app.route('/admin/revoke', methods=['POST'])
@login_required
def admin_revoke():
    key   = request.form.get('key', '').strip()
    entry = get_key(key)
    if entry:
        entry['revoked']    = True
        entry['free_trial'] = False
        save_key(key, entry)
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/restore', methods=['POST'])
@login_required
def admin_restore():
    key   = request.form.get('key', '').strip()
    entry = get_key(key)
    if entry:
        entry['revoked']    = False
        entry['free_trial'] = False
        if PLANS[entry['plan']]['monthly']:
            entry['expires_at'] = (datetime.utcnow() + timedelta(days=30)).isoformat()
        save_key(key, entry)
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/set_state', methods=['POST'])
@login_required
def admin_set_state():
    key   = request.form.get('key', '').strip()
    state = request.form.get('state', '').strip()
    entry = get_key(key)
    if entry:
        entry['free_trial'] = (state == 'free_trial')
        entry['revoked']    = False
        save_key(key, entry)
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/update_flags', methods=['POST'])
@login_required
def admin_update_flags():
    body  = request.get_json(silent=True) or {}
    key   = body.get('key', '').strip()
    flags = body.get('flags', {})
    entry = get_key(key)
    if entry:
        for field, value in flags.items():
            if field in ['has_sap', 'has_map', 'has_mar', 'has_qty_deduction', 'has_accountant', 'has_stock_app']:
                entry[field] = bool(value)
        save_key(key, entry)
        return jsonify({'success': True})
    return jsonify({'success': False}), 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port)