# Universal Shopify Tools (USHT) — UI Elements Catalog

Catalog of reusable UI elements across the USHT desktop app (Flask + Vanilla JS, templates in `templates/`, assets in `static/`). Every page shares a dark theme, a global `:root` token set, and jQuery-era JS helpers. Styles are numbered per feature: `style.css`/`main.js` (Scan & Pack), `style2.css`/`main2.js`, `style3.css`/`main3.js` (Returned), `style4.css`/`stock-select.js` (Stock), `style5.css`/`main5.js` (QTY Deduction), `settings.css`/`settings.js` (Settings modal).

## 1. Tables / Grids

- **Product grid** (stock pages) — `.dash-grid`/product-grid wrappers auto-fit columns; each cell is a `.product-card` with full `data-*` attributes (id, sku, title, qty, comment), image `200px` `object-fit: cover`, and stock badges.
  - Files: `templates/category_page.html`, `templates/urgent_page.html`, `templates/stock_base.html`; CSS in `static/css/style4.css`; selection logic in `static/js/stock-select.js`.
  - Image fallback: `/static/icons/Icon.png` when a product has no image.
  - Edge case: selection toggles a `.product-selected` accent outline and a `.product-checkbox` at `top/right 10px`; state persists in `localStorage.stock_selected_products_data`.
- **Order/line-item list** (Scan & Pack, Returned) — `.order-list`/`#itemList` of `<li>` rows with a `70px` thumbnail (`border-radius: 13px`, `cursor: zoom-in`).
  - Files: `templates/index.html`, `templates/returned.html`; logic in `static/js/main.js`, `static/js/main3.js`.
  - Edge case: packed/removed items re-render from `sessionStorage` state and their images hide on "packed".
- **Category manager rows** — `.cat-row` (`radius 10px`, `padding 12px 16px`) with per-row `.btn-cat` actions (`del` → red on hover, `products` → `#22c55e` on hover) and a monospace `.cat-tag-badge`.
  - File: `templates/manage_categories.html`.
- **Dashboard stat grid** — `.dash-grid` (4 columns, `gap 18px`) of `.stat-card` tiles (accent `::before` strip, hover lift `translateY(-2px)` + accent border).
  - File: `templates/dashboard.html`.

## 2. Search / Filters

- **Order search input** — `#orderInput` text field, Enter submits; supports full order IDs, `#1234`-style and short IDs (resolved by `fetch_order_data()` on the backend).
  - Files: `templates/index.html` (`input[type=text]`, 12px padding, `6px` radius, accent focus ring), `static/js/main.js`, `app.py`.
  - Edge case: no match → `showMessage(..., 'error')` + `playError()` (220Hz).
- **SKU / order lookup** — `#orderIdInput` on Returned, `#skuInput`-style on QTY Deduction; results render into a detail block (`#orderDetails`) and a packed list (`#packedOrdersList`).
  - Files: `templates/returned.html`, `templates/qty_deduct.html`; `static/js/main3.js`, `static/js/main5.js`.
- **Deduction column search/queue** — SKU queue in `main5.js` (`skuQueue`) filters submitted lines; summary totals update live via `updateSummary()`.
  - Edge case: `escHtml()` escapes user input before render; queued state survives refresh via `sessionStorage.qty_deduct_state`.
- **Search bar toggles** — `.search-bar-wrap` hidden by default, expands with `slideDown` `0.15s` keyframes (`.open` class).
  - Files: `templates/qty_deduct.html`, `templates/returned.html`.
- **Bulk column filter bar** — `.col-toggle-bar` (`flex-wrap`) of `.col-toggle-btn` chips; `.col-toggle-label` uppercase micro-labels.
  - File: `templates/bulk_mark.html` (Bootstrap 5.3.3 CDN + `style2.css`).

## 3. Forms / Inputs

- **Text inputs** — `input[type=text]`/`input[type=password]`: full-width (`calc(100% - 22px)`), `12px` padding, `--input-bg` on `--input-border`, `6px` radius, accent focus ring (`box-shadow 0 0 0 3px`).
  - Globals: `static/css/style.css` (line 99+); identical tokens in `style2.css`/`style3.css`.
- **License key input** — monospace uppercase `.key-input` inside `.license-card`.
  - File: `templates/license.html`.
- **Login form** — centered form extending `layout.html`, standard inputs + submit.
  - File: `templates/login.html`.
- **CSV upload (bulk mark)** — file input + client-side parsing: `parseCSVFile()` splits rows on `\r?\n`, drag-and-drop via `fileDrop`.
  - Files: `templates/bulk_mark.html`, `static/js/main5.js`-style parsing (also used by QTY batch).
  - Edge case: empty rows and malformed lines are skipped; totals recount after import.
- **Number/qty controls (accountant)** — numeric inputs with `.acc-section-title` labels; values persist to `accountant_data.json` via `/api/accountant/...` routes.
  - Files: `templates/accountant.html` (Chart.js 4.4.0 CDN), `app.py`.
- **Settings toggles/selects** — `.sw-switch` toggle (`42×22px`, knob `translateX(20px)` when on) and `.sw-select-btn` (`min-width 120px`).
  - Files: `templates/settings_modal.html`, `static/css/settings.css`, `static/js/settings.js`.

## 4. Modals / Popups

- **Image modal** — `.image-modal` with `.close` button; closes on click-outside (`window.onclick` → `event.target == imageModal`).
  - Files: `templates/index.html`, `templates/returned.html`; `static/js/main.js`, `static/js/main3.js` (`openImageModal`).
- **Settings modal** — `.settings-window` `860×540px`, `14px` radius, `settingsPop` `0.25s` entrance; `.settings-overlay` backdrop `z-index 3000` with `6px` blur; sidebar tabs: Global / Stores / About with `switchTab()`; store cards render profile list, `swActivateProfile` POSTs `/api/profiles/{id}/activate` then `sessionStorage.clear()`, `swDeleteProfile` uses `window.CustomModal.confirm`.
  - Files: `templates/settings_modal.html`, `static/js/settings.js`, `static/js/Rmenu.js`.
- **Right-click context menu** — `Rmenu.js` shared menu, `z-index 100000`, `min-width 180px`; default items: Refresh / Go Back / Go Forward + divider; themed confirm/alert modals (`window.CustomModal.*`).
  - File: `static/js/Rmenu.js`.
- **Flash messages** — server-flashed banners (.flash.success/.danger/.info) auto-fade after `0.5s` and remove from DOM.
  - File: `templates/layout.html` (flashed via `get_flashed_messages`).
- **Access-denied / license popups** — 403 card (`403.html`) and license-required screen have `fadeIn`/`pulse` animations.

## 5. Navigation / Layouts

- **Global nav** — 60px bar, `#0f0f1d`, `border-bottom: #33334d`; `.nav-links` `gap 15px`; active/hover item gets `border-bottom: 3px solid #e94560`; `.update-dot` (9px) pulses every 2s when an update is available; `.update-overlay` (z-index 2000) for the auto-update prompt.
  - Files: `templates/navigation.html` (extended by every page).
- **Fixed footer** — `.app-footer` bottom bar; `body` gets extra bottom padding so content never hides behind it.
  - File: `static/css/style.css`.
- **Two-column tool layouts** — left control rail + right results pane (see `ContainerLeft/Right`), plus feature-specific wrappers:
  - `.manage-layout` (Stock manage), `.qd-layout` (QTY, left 320px), `.acc-layout` (Accountant, left 340px + border-right).
  - Files: `templates/manage_categories.html`, `templates/qty_deduct.html`, `templates/accountant.html`.
- **Stock nav pill** — `.stock-nav-manage` (`margin-left: auto`, `6px` radius); `.active` gets a filled accent background.
  - File: `templates/stock_base.html` (base template for stock pages).
- **Accountant mobile tabs** — fixed bottom `.tab-bar` (`--tab-h: 64px`) with `.tab-btn` (SVG + uppercase micro-label, `.active` = accent), `100dvh` app shell.
  - File: `templates/accountant_mobile.html`.

## 6. Action Buttons

- **Primary buttons** — accent background (`--button-bg: #e94560`), white text; used for fulfill/confirm/mark actions (e.g. `#markPackedBtn` — "Mark Order as Packed in Shopify" on Scan & Pack, "Mark Order as Returned" on Returned).
  - Files: `templates/index.html`, `templates/returned.html`; globals in `static/css/style.css`.
- **Column toggles** — `.col-toggle-btn` chips (see §2) selecting which columns/marks apply in bulk mode.
  - File: `templates/bulk_mark.html`.
- **Row actions** — `.btn-cat` per-row buttons in the category manager; destructive rows turn red on hover.
  - File: `templates/manage_categories.html`.
- **Status-aware scans** — Scan & Pack marks an item packed (→ `--item-packed-bg: #4CAF50`) and plays the success beep; errors trigger `playError()`.
  - Files: `static/js/main.js`, `static/js/main2.js`, `static/js/main.js`.
- **Upload/reset/export** — CSV import + clear buttons on bulk mark; accountant CSV export.
  - Files: `templates/bulk_mark.html`, `templates/accountant.html`; routes in `app.py`.
- **Audio feedback on buttons** — success actions play `playBeep()` (880Hz sine), errors `playError()` (220Hz square), popups `playPopup()` (660→440Hz), all in `static/js/main2.js`.