# AGENTS.md

## Project overview

Universal Shopify Tools (USHT) is a desktop app (pywebview + Flask) for managing Shopify stores. It wraps a local Flask server in a native window and provides several license-gated tools:

- **Scan & Pack** (`/scanpack`) — pack orders by scanning order numbers, fulfill via Shopify, add order notes.
- **Mark as Paid** (`/markpaid`) — tag orders/manual orders as paid (incl. batch + CSV upload).
- **Mark as Returned** (`/returned`) — tag orders as returned.
- **Stock App** (`/stock`, `/stock/manage`) — browse products by category, set urgent thresholds, edit metafield stock comments and wholesale prices, bulk operations, PDF/CSV export.
- **QTY Deduction** (`/deduct`) — deduct quantities from product inventory.
- **My Accountant** (`/accountant`) — daily earnings/expense tracking, CSV export.

App name/version branding: **USHT**, currently `1.3.1` (see `version.json`).

## Tech stack

- Python 3 + **Flask** (single-file backend, `app.py`, ~2100 lines)
- **pywebview** for the desktop window (auto-opened in `__main__`); `launcher.py` opens a browser instead
- **Shopify** REST + GraphQL Admin APIs
- **reportlab** for PDF generation
- **PyInstaller** for packaging (`.spec` files + `swap.bat`)
- Optional integrations via flags: Telegram (`python-telegram-bot`), Twilio
- Frontend: vanilla JS (jQuery-era patterns), HTML templates in `templates/`, assets in `static/`. Each tool has its own CSS/JS pair numbered by feature (`style2.css`/`main2.js`, ... `style5.css`/`main5.js`).

## Getting started

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py          # desktop window via pywebview
python launcher.py     # local browser at http://127.0.0.1:5000
```

Data is never tested against a live store config automatically; you must add a store profile and (for some features) a valid license.

## Architecture

- `app.py` defines a global Flask `app`. In `__main__` it starts Flask on port 5000 in a daemon thread, then opens a pywebview window pointing at `http://127.0.0.1:5000`.
- **Profiles** (`profiles.json`) hold per-store credentials (store URL, access token, API version, metafield namespace/key). One profile is `active` at a time; credentials are read through helpers `SHOPIFY_STORE_URL()`, `SHOPIFY_ACCESS_TOKEN()`, etc. (`app.py:41`). `boot_active_profile()` runs at import time (`app.py:2065`) before serving.
- **Licensing**: a remote license server (`usht-license-server/license_server.py`, deployed at `usht.pythonanywhere.com`) validates license keys and returns permission flags. `ROUTE_PERMISSIONS` (`app.py:67`) maps page/API routes to flags (`has_sap`, `has_map`, `has_mar`, `has_stock_app`, `has_qty_deduction`, `has_accountant`). Local license cache in `license.json`.
- **Shopify calls** go through `get_headers()`/`get_rest_url()` (REST) and `run_graphql_query()` (GraphQL for product catalog). `fetch_order_data()` is the main order fetch used by SAP/MAP/MAR and handles both full and short order identifiers.

## Key data / config locations

All runtime data lives in `BASE_DIR` = `%APPDATA%\UniversalSHTools` (Windows) or `~/.UniversalSHTools`:

| Path | Purpose |
|---|---|
| `profiles.json` | Store profiles + which one is active |
| `license.json` | Cached license/permissions |
| `categories.json` | Stock app category tree (parents/subcats) |
| `accountant_data.json` | Accountant earnings/expense entries |
| `.env` | Local dev secrets (gitignored) |
| `version.json` | Version + release notes + download URL for auto-update (pulled from GitHub raw; update check hits this repo's `version.json`) |

`accountant_data.json` also appears at repo root (runtime copy); the canonical path is `BASE_DIR`.

## Build / packaging (PyInstaller)

`.spec` files exist for different artifact names (`app.spec`, `launcher.spec`, `UniversalSHTools.spec`, `USHT.spec`) plus `swap.bat` to swap them. When frozen, Flask is pointed at bundled `templates/`/`static/` via `sys._MEIPASS` (`app.py:19`). Built output goes to `dist/`/`build/`. Version bumps should update `version.json` to match the release tag before shipping.

## Conventions

- Single-file backend: keep adding routes to `app.py` rather than splitting modules (existing pattern).
- Follow the existing route helper pattern: `@app.route('/api/...')` for JSON endpoints, plain paths for pages. Guard new pages/endpoints by adding them to `ROUTE_PERMISSIONS`.
- New tools get numbered style/JS bundles: `styleN.css` + `mainN.js` matching the existing `2,3,5` sequence.
- Use pinned versions in `requirements.txt` (no `>=`).
- Keep feature ideas in `Improvements.md` (checkboxes tracked there). `Plan.html` holds planning/scope notes.
- Time/datetime handling uses the app's configured timezone (pytz/tzlocal present in requirements).
- Do not commit `.env`, `venv/`, `dist/`, `build/`, `*.spec`, `__pycache__/`, or root `profiles.json` (see `.gitignore`).

## Commands

- Run in dev: `python launcher.py` (browser) or `python app.py` (desktop window).
- `pip install -r requirements.txt` after pulling (env in `venv/`).
- No test suite or linter is configured in this repo; verify changes by running the app against a test store/manual testing.