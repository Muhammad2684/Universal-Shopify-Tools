# UI Preset — Universal Shopify Tools (USHT)

Dark-theme UI preset used across all USHT tools. Defines the shared visual language: colors, cards, headers, line items, and layout rhythm. Frontend is Flask + Vanilla JS (jQuery-era patterns), templates in `templates/`, assets in `static/`.

## Layout

- `body`: flex column, `align-items: center`, `min-height: 100vh`, `padding-bottom: 60–70px` (clears the fixed footer nav).
- `.app-header`: full-width band, `--bg-secondary` background, `border-bottom: 1px solid var(--border-color)`, centered content. `h1` uses `--accent-color`.
- `.app-main`: `flex-grow: 1`, full width, `padding: 20px`, `box-sizing: border-box`.
- `.app-footer`: `position: fixed; bottom: 0`, `z-index: 100`, `border-top`, muted text (`--text-dark`, `0.85em`).
- `.container`: the base "page card" — `--bg-secondary` bg, `20px` padding, `8px` radius, soft shadow `0 4px 12px rgba(0,0,0,0.3)`.
- Two-column split pattern (`.container_left` / `.container_right`): left rail `width: 30%` with `border-right: 1px solid #ccc` (index.html), right side `flex-grow: 1`. Variants in the tools (see the `*Layout` classes below) use gap instead of border.
- Content-first flex layouts:
  - `.container` (Scan & Pack): `display: flex; gap: 40px`
  - `.manage-layout` (Stock manage): `gap: 28px`
  - `.qd-layout` (QTY Deduction): `gap: 24px`, left column `320px`, right `flex: 1`
  - `.acc-layout` (My Accountant): `gap: 40px`, left column `340px` with `border-right`

## Cards

- `.stat-card` (dashboard): `12px` radius, `22px 24px` padding; on hover gets an accent border and `translateY(-2px)` lift. A `::before` accent strip marks the top edge.
- `.product-card` (stock product grids): `10px` radius, image `200px` tall with `object-fit: cover`, carries full `data-*` order/stock attributes. Selected state → `.product-selected` accent outline.
- `.qd-card` (QTY Deduction): `10px` radius, `18px` padding, bordered surface for each SKU.
- `.license-card` (license page): centered dark card; paired with a monospace, uppercase `.key-input`.
- `.login-card` / access-denied card (403): centered card with `fadeIn`/`pulse` entry animations.
- Accountant mobile `.sum-card`: `bg --bg2`, `1px` border, `14px` radius, `14px` padding, in a 2-column `.summary-grid`.
- The `.container` itself doubles as a card for single-panel pages.

## Section Headers

- `.app-header h1`: `2em`, accent color, centered.
- `.page-title` (stock pages): page-level heading above grids/lists.
- `.manage-section-title` (Stock manage): uppercase micro-heading.
- `.acc-section-title` (My Accountant): `0.82em`, uppercase section label.
- `.col-toggle-label` (bulk mark): uppercase short label above a toggle bar.
- `.category-divider` (stock category pages): divider row, e.g. "In-stock products", between grid groups.

## Line Items

- `.cat-row` (category rows): `10px` radius, `12px 16px` padding; hover states per action (`del` → red fill, `products` → `#22c55e`).
- `.col-toggle-btn` (bulk column toggles): compact `4px 12px` buttons in a flex-wrap bar.
- Scan/Pack + returned item rows: `<li>` entries with a `70px` product thumbnail (`radius: 13px`, `cursor: zoom-in`, click opens image modal).
- `.product-checkbox`: positioned `top/right 10px` over a product card, accent-colored when selected.
- Stock badge pairs: `.needed-qty` (`1.4em`, accent) vs `.stock-ok` (`1.4em`, `#22c55e`).

## Typography

- Base: `'Roboto', Arial, sans-serif`, `line-height: 1.6`, `--text-light` body, `--text-dark` muted.
- Accent/emphasis: `--accent-color` for headings and active states.
- Monospace/uppercase for machine-readable values: license `.key-input`, `.cat-tag-badge`.
- Flash/status messages: bold white on colored background (`.flash.success/.danger/.info`), auto-fade after 0.5s.
- Branding: **USHT**, version `1.3.1`.

## Colors

Defined in `:root` (repeated across style.css, style2.css, style3.css; style4.css/style5.css add their own extras).

- `--bg-primary: #1a1a2e` — page background
- `--bg-secondary: #0f0f1d` — header, footer, nav, container/card surface
- `--text-light: #e0e0e0` — body text
- `--text-dark: #b0b0b0` — muted/labels/footer
- `--accent-color: #e94560` — accent, buttons, active states, loading bar
- `--border-color: #33334d` — borders, dividers
- `--button-bg: #e94560` / `--button-text: #ffffff`
- `--input-bg: #2b2b40` / `--input-border: #44446b`
- `--success-bg: #28a745` / `--success-text: #ffffff`
- `--error-bg: #dc3545` / `--error-text: #ffffff`
- `--item-bg: #33334d` / `--item-packed-bg: #4CAF50` / `--item-packed-text: #ffffff`
- style4.css (stock): `--card-bg: #22223b`
- style5.css (QTY deduction): `--success: #28a745`, `--error-col: #dc3545`, `--warning: #e0a020`
- Accountant mobile is a standalone dark scheme: `--bg:#0a0a14`, `--bg2:#0f0f1d`, `--bg3:#14142a`, `--border:#1e1e3a`, `--accent:#e94560`, `--text:#e8e8f0`, `--muted:#6b6b8a`, plus semantic `--green:#22c55e`, `--blue:#60a5fa`, `--purple:#c084fc`, `--yellow:#facc15`

## Data Pattern

- Session-persist per-tool UI state in `sessionStorage` under a namespaced key; restore on load with `loadState()`/`restoreUI()`:
  - `scanpack_state` (Scan & Pack, main.js)
  - `returned_state` (Mark as Returned, main3.js)
  - `qty_deduct_state` (QTY Deduction, main5.js)
- Bulk selection persists in `localStorage` (survives restarts): `stock_selection_mode`, `stock_selected_products_data` (Map of product id → `{sku, title}`).
- Backend calls: `fetch('/api/...')` JSON endpoints; POST bodies in `content-type: application/json`.
- Audio feedback (main2.js, Web Audio API):
  - `playBeep()` — 880Hz sine, success
  - `playError()` — 220Hz square, error
  - `playPopup()` — 660→440Hz double sine, popup
- Every page shows a `.page-loading-bar` (fixed top, `8px`, accent color, 2s `bar-load` animation) injected via inline `<style>`.

## Example Card Structure

Product card (stock pages — urgent_page.html / category_page.html):

```html
<div class="product-card" data-id="..." data-sku="..." data-title="..." data-qty="..."
     data-comment="...">
  <article></article>
  <div class="product-details">
    <img src="/static/icons/Icon.png" alt="...">
    <h3 class="product-title">Title</h3>
    <p class="product-comment">Note box (accent border)</p>
    <p class="needed-qty">Stock / Needed</p>
    <p class="stock-ok">In stock (green)</p>
  </div>
</div>
```

No-data edge case: falls back to `/static/icons/Icon.png` when the product image is missing.

## Responsive Breakpoints

- Desktop app target window; layouts are flex (two columns) that collapse responsibility to stock page grid wrappers (`{display: grid}` with auto-fit columns that reflow with viewport width).
- Bulk mark `.col-toggle-bar` is `flex-wrap: wrap` so toggle chips reflow instead of overflowing.
- `.search-bar-wrap` is hidden by default and expands with a `slideDown` 0.15s animation when toggled open.
- Accountant mobile (`accountant_mobile.html`) is a separate mobile-first PWA-style surface:
  - `html, body` locked to `height: 100%`/`100dvh`, `overflow: hidden`
  - Fixed bottom `.tab-bar` (`--tab-h: 64px`) with `.tab-btn` (SVG + uppercase micro-label), `active` = accent
  - `.page.active` shows, others `display: none`
  - Content scrolls in `.content` with bottom padding clearing the tab bar