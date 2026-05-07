/**
 * Stock App - Multi-Select Mode
 * Enables checkbox selection on product cards with bulk actions
 */

(function() {
    // State - Persisted in localStorage
    let selectionMode = localStorage.getItem('stock_selection_mode') === 'true';
    let selectedProducts = new Map(); // Map<id, {sku, title}>
    
    try {
        const saved = localStorage.getItem('stock_selected_products_data');
        if (saved) {
            const arr = JSON.parse(saved);
            arr.forEach(p => selectedProducts.set(p.id, p));
        }
    } catch(e) { console.error('Failed to load selected products', e); }

    function saveState() {
        localStorage.setItem('stock_selection_mode', selectionMode);
        localStorage.setItem('stock_selected_products_data', JSON.stringify(Array.from(selectedProducts.values())));
    }

    // ── STYLES ───────────────────────────────────────────────────────────────
    const SELECT_STYLES = `
        .product-checkbox {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 100;
            background: var(--bg-secondary, #1a1a2e);
            border-radius: 4px;
            padding: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .product-checkbox input {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--accent-color, #e94560);
            margin: 0;
        }
        .product-selected {
            outline: 2px solid var(--accent-color, #e94560) !important;
            outline-offset: 2px;
        }
        body.stock-select-mode .product-card {
            transition: outline 0.2s, transform 0.2s;
            position: relative;
        }
        body.stock-select-mode .product-card:hover {
            transform: translateY(-4px);
        }
        
        /* Modal Styles */
        .stock-action-overlay {
            display: flex;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.65);
            backdrop-filter: blur(4px);
            z-index: 10001;
            align-items: center;
            justify-content: center;
        }
        .stock-action-modal {
            background: var(--bg-secondary, #1a1a2e);
            border: 1px solid var(--border-color, #33334d);
            border-radius: 14px;
            width: 480px;
            max-width: 95vw;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            animation: modalIn 0.25s ease;
        }
        @keyframes modalIn {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        .stock-action-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 18px 20px;
            border-bottom: 1px solid var(--border-color, #33334d);
        }
        .stock-action-header h3 {
            margin: 0;
            color: var(--accent-color, #e94560);
            font-size: 1.1em;
        }
        .stock-action-close {
            background: none;
            border: none;
            color: var(--text-dark, #888);
            font-size: 1.4em;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
        }
        .stock-action-close:hover { color: var(--text-light, #fff); }
        .stock-action-body { padding: 20px; }
        .stock-action-info {
            margin: 0 0 16px;
            color: var(--text-light, #e0e0e0);
            font-size: 0.9em;
        }
        .stock-action-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 16px;
        }
        .stock-action-option {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 20px;
            background: var(--bg-primary, #0f0f1d);
            border: 1px solid var(--border-color, #33334d);
            border-radius: 10px;
            color: var(--text-light, #e0e0e0);
            cursor: pointer;
            transition: all 0.2s;
        }
        .stock-action-option:hover {
            border-color: var(--accent-color, #e94560);
            background: var(--item-bg, #1a1a2e);
            transform: translateY(-2px);
        }
        .stock-action-option svg { opacity: 0.8; }
        .stock-action-option span { font-size: 0.85em; font-weight: 600; }
        .stock-action-footer {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            padding-top: 16px;
            border-top: 1px solid var(--border-color, #33334d);
        }
        .stock-action-cancel, .stock-action-clear {
            padding: 9px 18px;
            border-radius: 8px;
            font-size: 0.88em;
            cursor: pointer;
            transition: all 0.15s;
        }
        .stock-action-cancel {
            background: none;
            color: var(--text-dark, #888);
            border: 1px solid var(--border-color, #33334d);
        }
        .stock-action-cancel:hover {
            border-color: var(--accent-color, #e94560);
            color: var(--accent-color, #e94560);
        }
        .stock-action-clear {
            background: none;
            color: #ef4444;
            border: 1px solid #ef4444;
        }
        .stock-action-clear:hover {
            background: #ef4444;
            color: #fff;
        }

        /* Export Options Modal */
        .export-options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin: 15px 0;
            background: var(--bg-primary, #0f0f1d);
            padding: 15px;
            border-radius: 10px;
            border: 1px solid var(--border-color, #33334d);
        }
        .export-option-item {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-light, #e0e0e0);
            font-size: 0.9em;
            cursor: pointer;
        }
        .export-option-item input {
            cursor: pointer;
            accent-color: var(--accent-color, #e94560);
        }
    `;

    // Define Bulk Actions for Context Menu
    const BULK_ACTIONS = [
        {
            label: 'Select All',
            action: function() { selectAllOnPage(); }
        },
        {
            label: 'Deduct QTY',
            action: function() { handleBulkAction('deduct_qty'); }
        },
        {
            label: 'Add Comment',
            action: function() { handleBulkAction('add_comment'); }
        },
        {
            label: 'Change Category',
            action: function() { handleBulkAction('change_category'); }
        },
        {
            label: 'Export Selected',
            action: function() { handleBulkAction('export_options'); }
        },
        {
            label: 'Download Images',
            action: function() { handleBulkAction('download_images'); }
        },
        {
            label: 'PDF Generator',
            action: function() { handleBulkAction('generate_pdf'); }
        },
        {
            divider: true
        },
        {
            label: 'Exit Selection Mode',
            action: function() { exitSelectionMode(); }
        }
    ];

    // Export Column Definitions
    const EXPORT_COLUMNS = [
        { id: 'product_id',  label: 'Product ID',     default: true },
        { id: 'title',       label: 'Product Name',   default: true },
        { id: 'sku',         label: 'SKU',            default: true },
        { id: 'category',    label: 'Category',       default: true },
        { id: 'image_url',   label: 'Image URL',      default: false },
        { id: 'sizes',       label: 'Sizes',          default: true },
        { id: 'current_qty', label: 'Current Qty',    default: true },
        { id: 'threshold',   label: 'Threshold',      default: true },
        { id: 'needed_qty',  label: 'Needed Qty',     default: true },
        { id: 'status',      label: 'Stock Status',   default: true },
        { id: 'comment',     label: 'Comment',        default: true }
    ];

    // ── INITIALIZATION ────────────────────────────────────────────────────────
    function init() {
        // Inject styles
        if (!document.getElementById('stock-select-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'stock-select-styles';
            styleEl.textContent = SELECT_STYLES;
            document.head.appendChild(styleEl);
        }

        createActionButton();

        // If selection mode was active, restore it
        if (selectionMode) {
            enterSelectionMode(false); 
        }
    }

    function selectAllOnPage() {
        const productGrid = document.querySelector('.product-grid');
        if (!productGrid) return;
        const productCards = productGrid.querySelectorAll('.product-card');
        productCards.forEach(card => {
            const productId = card.dataset.productId;
            if (productId) {
                const data = {
                    id: productId,
                    title: card.dataset.title || '',
                    sku: card.dataset.sku || '',
                    image_url: card.dataset.imageUrl || '',
                    sizes: card.dataset.sizes || '',
                    current_qty: card.dataset.currentQty || '0',
                    threshold: card.dataset.threshold || '0',
                    comment: card.dataset.comment || '',
                    category: card.dataset.category || ''
                };
                selectedProducts.set(productId, data);
                card.classList.add('product-selected');
                const cb = card.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = true;
            }
        });
        updateActionCount();
        saveState();
    }

    // Create Action Button (inserted beside Manage tab)
    function createActionButton() {
        const existingBtn = document.getElementById('stockSelectActionBtn');
        if (existingBtn) return;

        const stockNav = document.getElementById('stockNav');
        if (!stockNav) return;

        const manageLink = stockNav.querySelector('.stock-nav-manage');
        if (!manageLink) return;

        const actionBtn = document.createElement('button');
        actionBtn.id = 'stockSelectActionBtn';
        actionBtn.className = 'stock-nav-manage';
        actionBtn.style.display = 'none';
        actionBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Action (<span id="stockSelectCount">0</span>)
        `;
        actionBtn.onclick = openActionModal;

        stockNav.insertBefore(actionBtn, manageLink);
    }

    // Toggle selection mode
    window.toggleStockSelectMode = function(startingProductId) {
        if (selectionMode && !startingProductId) {
            exitSelectionMode();
            return;
        }
        enterSelectionMode(true, startingProductId);
    };

    function enterSelectionMode(isManual, startingProductId) {
        selectionMode = true;

        const productGrid = document.querySelector('.product-grid');
        if (!productGrid) return;

        const productCards = productGrid.querySelectorAll('.product-card');

        // Enable selection mode
        document.body.classList.add('stock-select-mode');
        
        // Register bulk actions in RMenu
        if (window.RMenu) {
            window.RMenu.setOverrideItems(BULK_ACTIONS);
        }

        productCards.forEach((card) => {
            const productId = card.dataset.productId;
            if (!productId) return;

            // Add checkbox overlay if not exists
            if (!card.querySelector('.product-checkbox')) {
                const checkbox = document.createElement('div');
                checkbox.className = 'product-checkbox';
                const isChecked = selectedProducts.has(productId);
                checkbox.innerHTML = `
                    <input type="checkbox" data-product-id="${productId}" ${isChecked ? 'checked' : ''} onchange="toggleProductSelect('${productId}', this)">
                `;
                card.appendChild(checkbox);
                if (isChecked) card.classList.add('product-selected');
            }

            // Make card clickable for selection
            card.style.cursor = 'pointer';
            card.onclick = function(e) {
                if (e.target.closest('.product-checkbox') || e.target.closest('.comment-edit-btn') || e.target.closest('.comment-add-btn') || e.target.closest('.comment-edit')) {
                    return;
                }
                const cb = card.querySelector('input[type="checkbox"]');
                if (cb) {
                    cb.checked = !cb.checked;
                    toggleProductSelect(productId, cb);
                }
            };

            // If this is the starting product, select it immediately
            if (startingProductId && productId === startingProductId) {
                const cb = card.querySelector('input[type="checkbox"]');
                if (cb) {
                    cb.checked = true;
                    toggleProductSelect(productId, cb);
                }
            }
        });

        // Show action button
        const actionBtn = document.getElementById('stockSelectActionBtn');
        if (actionBtn) actionBtn.style.display = 'flex';
        
        updateActionCount();
        saveState();
    }

    window.exitSelectionMode = function() {
        selectionMode = false;
        document.body.classList.remove('stock-select-mode');

        // Clear RMenu override
        if (window.RMenu) {
            window.RMenu.clearOverrideItems();
            window.RMenu.hide(); // Ensure menu closes
        }

        // Remove all checkboxes
        document.querySelectorAll('.product-checkbox').forEach(cb => cb.remove());

        // Remove click handlers and styles
        document.querySelectorAll('.product-card').forEach(card => {
            card.style.cursor = '';
            card.onclick = null;
            card.classList.remove('product-selected');
        });

        // Hide action button
        const actionBtn = document.getElementById('stockSelectActionBtn');
        if (actionBtn) actionBtn.style.display = 'none';

        selectedProducts.clear();
        updateActionCount();
        saveState();
    }

    // Toggle individual product selection
    window.toggleProductSelect = function(productId, checkbox) {
        const card = checkbox.closest('.product-card');

        if (checkbox.checked) {
            if (card) {
                const data = {
                    id: productId,
                    title: card.dataset.title || '',
                    sku: card.dataset.sku || '',
                    image_url: card.dataset.imageUrl || '',
                    sizes: card.dataset.sizes || '',
                    current_qty: card.dataset.currentQty || '0',
                    threshold: card.dataset.threshold || '0',
                    comment: card.dataset.comment || '',
                    category: card.dataset.category || ''
                };
                selectedProducts.set(productId, data);
                card.classList.add('product-selected');
            }
        } else {
            selectedProducts.delete(productId);
            if (card) card.classList.remove('product-selected');
        }

        updateActionCount();
        saveState();
    };

    function updateActionCount() {
        const countEl = document.getElementById('stockSelectCount');
        if (countEl) countEl.textContent = selectedProducts.size;

        const actionBtn = document.getElementById('stockSelectActionBtn');
        if (actionBtn) {
            actionBtn.disabled = selectedProducts.size === 0;
            actionBtn.style.opacity = selectedProducts.size === 0 ? '0.5' : '1';
        }
    }

    // Action Modal
    function openActionModal() {
        if (selectedProducts.size === 0) return;

        const existing = document.getElementById('stockActionModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'stockActionModal';
        overlay.className = 'stock-action-overlay';
        overlay.innerHTML = `
            <div class="stock-action-modal">
                <div class="stock-action-header">
                    <h3>Bulk Actions</h3>
                    <button class="stock-action-close" onclick="closeActionModal()">&#10005;</button>
                </div>
                <div class="stock-action-body">
                    <p class="stock-action-info">${selectedProducts.size} product(s) selected</p>
                    <div class="stock-action-options">
                        <button class="stock-action-option" onclick="handleBulkAction('deduct_qty')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M16 3h5v5M8 21H3v-5M8 3H3v5M16 21h5v-5"></path>
                                <path d="M12 8v8M8 12h8"></path>
                            </svg>
                            <span>Deduct QTY</span>
                        </button>
                        <button class="stock-action-option" onclick="handleBulkAction('add_comment')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span>Add Comment</span>
                        </button>
                        <button class="stock-action-option" onclick="handleBulkAction('change_category')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                            </svg>
                            <span>Change Category</span>
                        </button>
                        <button class="stock-action-option" onclick="handleBulkAction('export_options')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>Export Selected</span>
                        </button>
                        <button class="stock-action-option" onclick="handleBulkAction('download_images')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                <polyline points="21 15 16 10 5 21"></polyline>
                            </svg>
                            <span>Image Folder</span>
                        </button>
                        <button class="stock-action-option" onclick="handleBulkAction('generate_pdf')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                            <span>PDF Generator</span>
                        </button>
                    </div>
                    <div class="stock-action-footer">
                        <button class="stock-action-cancel" onclick="closeActionModal()">Cancel</button>
                        <button class="stock-action-clear" onclick="clearSelection()">Clear Selection</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.onclick = function(e) {
            if (e.target === overlay) closeActionModal();
        };
    }

    window.closeActionModal = function() {
        const modal = document.getElementById('stockActionModal');
        if (modal) {
            modal.remove();
        }
    };

    window.clearSelection = function() {
        selectedProducts.clear();
        document.querySelectorAll('.product-checkbox input').forEach(cb => {
            cb.checked = false;
            cb.closest('.product-card')?.classList.remove('product-selected');
        });
        updateActionCount();
        closeActionModal();
    };

    window.handleBulkAction = async function(action) {
        if (selectedProducts.size === 0) {
            window.CustomModal.alert('No Selection', 'Please select at least one product.');
            return;
        }

        const productIdArray = Array.from(selectedProducts.keys());

        switch(action) {
            case 'deduct_qty':
                window.CustomModal.prompt('Deduct QTY', `Enter quantity to deduct from ${productIdArray.length} products:`, 'Quantity (default 1)', async (qty) => {
                    if (qty === null) return;
                    const deductionQty = parseInt(qty) || 1;
                    
                    // Add to QTY Deduct queue
                    const QTY_SESSION_KEY = 'qty_deduct_state';
                    let qtyState = { skuQueue: [], nextId: 0 };
                    try {
                        const raw = sessionStorage.getItem(QTY_SESSION_KEY);
                        if (raw) qtyState = JSON.parse(raw);
                    } catch(e) {}

                    let addedCount = 0;
                    productIdArray.forEach(id => {
                        const p = selectedProducts.get(id);
                        if (p && p.sku) {
                            // Check if already in queue
                            const existing = qtyState.skuQueue.find(i => i.sku === p.sku);
                            if (existing) {
                                existing.qty += deductionQty;
                            } else {
                                qtyState.skuQueue.push({
                                    id: qtyState.nextId++,
                                    sku: p.sku,
                                    qty: deductionQty,
                                    name: p.title
                                });
                            }
                            addedCount++;
                        }
                    });

                    sessionStorage.setItem(QTY_SESSION_KEY, JSON.stringify(qtyState));
                    window.CustomModal.alert('Added to Queue', `Added ${addedCount} products to QTY Deduction queue. Redirecting...`, () => {
                        location.href = '/deduct';
                    });
                });
                break;
            case 'add_comment':
                window.CustomModal.prompt('Add Comment', `Enter comment to add to ${productIdArray.length} products:`, 'Enter note here...', async (comment) => {
                    if (comment === null) return;
                    try {
                        const response = await fetch('/api/stock/add_comment_bulk', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ product_ids: productIdArray, comment: comment })
                        });
                        const result = await response.json();
                        if (result.success) {
                            window.CustomModal.alert('Success', 'Comment Added', () => location.reload());
                        } else {
                            window.CustomModal.alert('Error', result.error);
                        }
                    } catch (e) {
                        window.CustomModal.alert('Error', 'Failed to connect to server');
                    }
                });
                break;
            case 'remove_comments':
                window.CustomModal.confirm('Remove Notes', `Are you sure you want to remove notes from ${productIdArray.length} products?`, async (ok) => {
                    if (!ok) return;
                    try {
                        const response = await fetch('/api/stock/add_comment_bulk', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ product_ids: productIdArray, comment: '' })
                        });
                        const result = await response.json();
                        if (result.success) {
                            window.CustomModal.alert('Success', 'Notes Removed', () => location.reload());
                        } else {
                            window.CustomModal.alert('Error', result.error);
                        }
                    } catch (e) {
                        window.CustomModal.alert('Error', 'Failed to connect to server');
                    }
                });
                break;
            case 'change_category':
                openChangeCategoryModal(productIdArray);
                break;
            case 'export_options':
                openExportOptionsModal(productIdArray);
                break;
            case 'download_images':
                closeActionModal();
                await handleImageDownload(productIdArray);
                break;
            case 'generate_pdf':
                closeActionModal();
                await processBulkPdfExport(productIdArray);
                break;
            case 'export':
                handleBulkExport(productIdArray);
                break;
            default:
                window.CustomModal.alert('Pending', 'This action is not implemented yet');
                break;
        }
    }

    async function openChangeCategoryModal(productIds) {
        closeActionModal();

        try {
            const res = await fetch('/api/stock_categories');
            const cats = await res.json();

            if (!cats || !cats.length) {
                window.CustomModal.alert('Error', 'No categories found.');
                return;
            }

            const existing = document.getElementById('changeCategoryModal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'changeCategoryModal';
            overlay.className = 'stock-action-overlay';
            overlay.innerHTML = `
                <div class="stock-action-modal">
                    <div class="stock-action-header">
                        <h3>Change Category</h3>
                        <button class="stock-action-close" onclick="document.getElementById('changeCategoryModal').remove()">&#10005;</button>
                    </div>
                    <div class="stock-action-body">
                        <p class="stock-action-info">Select new category for ${productIds.length} products:</p>
                        <select id="bulk-category-select" style="width: 100%; padding: 12px; border-radius: 8px; background: var(--bg-primary, #0f0f1d); color: var(--text-light, #e0e0e0); border: 1px solid var(--border-color, #33334d); margin-bottom: 20px; font-size: 0.95em;">
                            ${cats.map(cat => `<option value="${cat.tag}">${cat.title}</option>`).join('')}
                        </select>
                        <div class="stock-action-footer">
                            <button class="stock-action-cancel" onclick="document.getElementById('changeCategoryModal').remove()">Cancel</button>
                            <button class="stock-action-option" style="padding: 9px 22px; border:none; background:var(--accent-color); color:#fff; font-weight:bold; cursor:pointer;" onclick="processBulkCategoryChange()">Update Category</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            window.processBulkCategoryChange = async function() {
                const newTag = document.getElementById('bulk-category-select').value;
                document.getElementById('changeCategoryModal').remove();

                window.CustomModal.alert('Updating', 'Updating categories on Shopify...');

                try {
                    const response = await fetch('/api/stock/change_category_bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product_ids: productIds, new_tag: newTag })
                    });
                    const result = await response.json();
                    if (result.success) {
                        window.CustomModal.alert('Success', 'Category updated for selected products.', () => location.reload());
                    } else {
                        window.CustomModal.alert('Error', result.error);
                    }
                } catch (e) {
                    window.CustomModal.alert('Error', 'Failed to connect to server');
                }
            };

        } catch (e) {
            window.CustomModal.alert('Error', 'Failed to fetch categories');
        }
    }

    function openExportOptionsModal(productIds) {
        closeActionModal();

        const existing = document.getElementById('exportOptionsModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'exportOptionsModal';
        overlay.className = 'stock-action-overlay';
        overlay.innerHTML = `
            <div class="stock-action-modal">
                <div class="stock-action-header">
                    <h3>Export Options</h3>
                    <button class="stock-action-close" onclick="document.getElementById('exportOptionsModal').remove()">&#10005;</button>
                </div>
                <div class="stock-action-body">
                    <p class="stock-action-info">Select columns to include in CSV export:</p>
                    <div class="export-options-grid">
                        ${EXPORT_COLUMNS.map(col => `
                            <label class="export-option-item">
                                <input type="checkbox" name="export-col" value="${col.id}" ${col.default ? 'checked' : ''}>
                                <span>${col.label}</span>
                            </label>
                        `).join('')}
                    </div>
                    <div class="stock-action-footer">
                        <button class="stock-action-cancel" onclick="document.getElementById('exportOptionsModal').remove()">Cancel</button>
                        <button class="stock-action-option" style="padding: 9px 18px; border:none; background:var(--accent-color); color:#fff; font-weight:bold; cursor:pointer; border-radius:8px;" onclick="processBulkExport()">Export CSV</button>
                        <button class="stock-action-option" style="padding: 9px 18px; border:none; background: #3498db; color:#fff; font-weight:bold; cursor:pointer; border-radius:8px; margin-left: 6px;" onclick="processBulkPdfFromExport()">Export PDF</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        window.processBulkPdfFromExport = function() {
            document.getElementById('exportOptionsModal').remove();
            processBulkPdfExport(productIds);
        };

        window.processBulkExport = function() {
            const selectedCols = Array.from(document.querySelectorAll('input[name="export-col"]:checked')).map(cb => cb.value);
            
            if (!selectedCols.length) {
                window.CustomModal.alert('No Selection', 'Please select at least one column to export.');
                return;
            }
            
            document.getElementById('exportOptionsModal').remove();
            handleBulkExport(productIds, selectedCols);
        };
    }

    async function handleImageDownload(productIds) {
        if (!window.showDirectoryPicker) {
            window.CustomModal.alert('Not Supported', 'Your browser does not support folder selection. Please use Chrome or Edge.');
            return;
        }

        const products = productIds.map(id => {
            const p = selectedProducts.get(id);
            return (p && p.image_url) ? {
                id: id,
                title: p.title || 'Product',
                sku: p.sku || id,
                url: p.image_url
            } : null;
        }).filter(p => p && p.url);

        if (!products.length) {
            window.CustomModal.alert('No Images', 'None of the selected products have images.');
            return;
        }

        try {
            const folderHandle = await window.showDirectoryPicker();
            
            window.CustomModal.alert('Downloading', `Starting download of ${products.length} images...`);

            let count = 0;
            for (const p of products) {
                try {
                    const blob = await fetchAndConvertToPng(p.url);
                    if (blob) {
                        const safeTitle = (p.sku || p.title).replace(/[/\\?%*:|"<>]/g, '-');
                        const fileHandle = await folderHandle.getFileHandle(`${safeTitle}.png`, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        count++;
                    }
                } catch (err) {
                    console.error(`Failed to download image for ${p.title}:`, err);
                }
            }

            window.CustomModal.alert('Complete', `Successfully saved ${count} images to the selected folder.`);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Image download failed:', err);
                window.CustomModal.alert('Error', 'Failed to save images to folder.');
            }
        }
    }

    async function processBulkPdfExport(productIds) {
        const filename = `stock_catalog_${new Date().toISOString().split('T')[0]}.pdf`;
        let fileHandle = null;

        // 1. Get save location IMMEDIATELY (while we have user gesture)
        if (window.showSaveFilePicker) {
            try {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'PDF files',
                        accept: { 'application/pdf': ['.pdf'] }
                    }]
                });
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error('Picker failed:', err);
                // Continue to fallback if picker fails but wasn't aborted
            }
        }

        // 2. Show loading modal
        window.CustomModal.loading('Generating PDF', 'Preparing your PDF catalog...');
        window.CustomModal.setProgress(20);

        try {
            // 3. Fetch PDF from server
            const response = await fetch('/api/stock/generate_pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_ids: productIds })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Server error');
            }

            window.CustomModal.setProgress(70);
            const blob = await response.blob();
            if (blob.size === 0) {
                throw new Error('Generated PDF is empty.');
            }

            // 4. Save the file
            if (fileHandle) {
                // Write to the handle we got earlier
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                window.CustomModal.setProgress(100);
                setTimeout(() => {
                    window.CustomModal.alert('Complete', `PDF saved successfully to ${fileHandle.name}`);
                }, 400);
            } else {
                // Fallback for browsers without showSaveFilePicker or if it failed
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.CustomModal.setProgress(100);
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    a.remove();
                    window.CustomModal.alert('Complete', 'Your PDF has been generated and download should start automatically.');
                }, 400);
            }
        } catch (e) {
            console.error('PDF Generation failed:', e);
            window.CustomModal.alert('Error', e.message || 'Failed to generate PDF');
        }
    }

    async function fetchAndConvertToPng(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => resolve(blob), 'image/png');
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    async function handleBulkExport(productIds, selectedCols) {
        // If selectedCols not provided, use defaults
        const colsToExport = selectedCols || EXPORT_COLUMNS.filter(c => c.default).map(c => c.id);

        const rows = productIds.map((id) => {
            const p = selectedProducts.get(id);
            if (!p) return null;

            const currentQty = parseInt(p.current_qty || '0');
            const threshold  = parseInt(p.threshold || '0');
            const neededQty = Math.max(0, threshold - currentQty);
            
            let status = 'In Stock';
            if (currentQty <= 0) status = 'Urgent';
            else if (currentQty < threshold) status = 'Needs Restock';

            return {
                product_id:  p.id || '',
                title:       p.title || '',
                sku:         p.sku || '',
                category:    p.category || '',
                image_url:   p.image_url || '',
                sizes:       p.sizes || '',
                current_qty: currentQty,
                threshold:   threshold,
                needed_qty:  neededQty,
                status:      status,
                comment:     p.comment || ''
            };
        }).filter(Boolean);

        if (!rows.length) {
            window.CustomModal.alert('Export Failed', 'No valid product data found for export.');
            return;
        }

        const csv = convertRowsToCsv(rows, colsToExport);
        const filename = `stock-export-${Date.now()}.csv`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'CSV files',
                        accept: { 'text/csv': ['.csv'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(csv);
                await writable.close();
                window.CustomModal.alert('Export Complete', `Saved to ${handle.name}`);
                return;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Export save failed:', error);
                    window.CustomModal.alert('Export Failed', 'Could not save CSV file.');
                }
                return;
            }
        }

        downloadCsv(csv, filename);
    }

    function convertRowsToCsv(rows, colsToExport) {
        const headers = EXPORT_COLUMNS
            .filter(col => colsToExport.includes(col.id))
            .map(col => col.label);

        const escapeCsv = (value) => {
            if (value == null) return '';
            const stringValue = String(value);
            if (/[,"\n]/.test(stringValue)) {
                return '"' + stringValue.replace(/"/g, '""') + '"';
            }
            return stringValue;
        };

        const lines = [headers.join(',')];
        rows.forEach((row) => {
            const rowData = EXPORT_COLUMNS
                .filter(col => colsToExport.includes(col.id))
                .map(col => escapeCsv(row[col.id]));
            lines.push(rowData.join(','));
        });
        return lines.join('\n');
    }

    function downloadCsv(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose API for external use
    window.StockSelect = {
        isEnabled: () => selectionMode,
        getSelected: () => Array.from(selectedProducts.values()),
        exit: exitSelectionMode
    };
})();
