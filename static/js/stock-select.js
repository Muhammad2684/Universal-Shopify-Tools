/**
 * Stock App - Multi-Select Mode
 * Enables checkbox selection on product cards with bulk actions
 */

(function() {
    // State
    let selectionMode = false;
    let selectedProducts = new Set();

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
    window.toggleStockSelectMode = function() {
        selectionMode = !selectionMode;
        selectedProducts.clear();

        const productGrid = document.querySelector('.product-grid');
        if (!productGrid) return;

        const productCards = productGrid.querySelectorAll('.product-card');

        if (selectionMode) {
            // Enable selection mode
            document.body.classList.add('stock-select-mode');
            productCards.forEach((card, index) => {
                const productId = card.dataset.productId || card.querySelector('[data-product-id]')?.dataset.productId;
                if (!productId) return;

                // Add checkbox overlay
                const checkbox = document.createElement('div');
                checkbox.className = 'product-checkbox';
                checkbox.innerHTML = `
                    <input type="checkbox" data-product-id="${productId}" onchange="toggleProductSelect('${productId}', this)">
                `;
                card.appendChild(checkbox);

                // Make card clickable for selection
                card.style.cursor = 'pointer';
                card.onclick = function(e) {
                    if (e.target.closest('.product-checkbox') || e.target.closest('.comment-edit-btn') || e.target.closest('.comment-add-btn')) {
                        return;
                    }
                    const cb = card.querySelector('input[type="checkbox"]');
                    if (cb) {
                        cb.checked = !cb.checked;
                        toggleProductSelect(productId, cb);
                    }
                };
            });

            // Show action button
            const actionBtn = document.getElementById('stockSelectActionBtn');
            if (actionBtn) actionBtn.style.display = 'flex';

        } else {
            // Disable selection mode
            exitSelectionMode();
        }
    };

    function exitSelectionMode() {
        document.body.classList.remove('stock-select-mode');

        // Remove all checkboxes
        document.querySelectorAll('.product-checkbox').forEach(cb => cb.remove());

        // Remove click handlers
        document.querySelectorAll('.product-card').forEach(card => {
            card.style.cursor = '';
            card.onclick = null;
        });

        // Hide action button
        const actionBtn = document.getElementById('stockSelectActionBtn');
        if (actionBtn) actionBtn.style.display = 'none';

        selectedProducts.clear();
        updateActionCount();
    }

    // Toggle individual product selection
    window.toggleProductSelect = function(productId, checkbox) {
        const card = checkbox.closest('.product-card');

        if (checkbox.checked) {
            selectedProducts.add(productId);
            if (card) card.classList.add('product-selected');
        } else {
            selectedProducts.delete(productId);
            if (card) card.classList.remove('product-selected');
        }

        updateActionCount();
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
                        <button class="stock-action-option" onclick="handleBulkAction('mark_urgent')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                            <span>Mark as Urgent</span>
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
                        <button class="stock-action-option" onclick="handleBulkAction('export')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>Export Selected</span>
                        </button>
                    </div>
                    <div class="stock-action-footer">
                        <button class="stock-action-cancel" onclick="closeActionModal()">Cancel</button>
                        <button class="stock-action-clear" onclick="clearSelection()">Clear Selection</button>
                    </div>
                </div>
            </div>
        `;

        // Add styles
        const styles = document.createElement('style');
        styles.textContent = `
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
            .product-checkbox {
                position: absolute;
                top: 10px;
                right: 10px;
                z-index: 100;
                background: var(--bg-secondary, #1a1a2e);
                border-radius: 4px;
                padding: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            .product-checkbox input {
                width: 18px;
                height: 18px;
                cursor: pointer;
                accent-color: var(--accent-color, #e94560);
            }
            .product-selected {
                outline: 2px solid var(--accent-color, #e94560) !important;
                outline-offset: 2px;
            }
            body.stock-select-mode .product-card {
                transition: outline 0.2s, transform 0.2s;
            }
            body.stock-select-mode .product-card:hover {
                transform: translateY(-4px);
            }
        `;
        document.head.appendChild(styles);

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
            // Remove injected styles
            const styles = document.querySelector('style[data-stock-action-styles]');
            if (styles) styles.remove();
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

    window.handleBulkAction = function(action) {
        const productIdArray = Array.from(selectedProducts);

        switch(action) {
            case 'mark_urgent':
                alert('Mark ' + productIdArray.length + ' product(s) as urgent - TODO: Implement API call');
                break;
            case 'add_comment':
                const comment = prompt('Enter comment to add to selected products:');
                if (comment) {
                    // TODO: Implement bulk comment API
                    alert('Add comment to ' + productIdArray.length + ' products - TODO: Implement API call');
                }
                break;
            case 'change_category':
                alert('Change category for ' + productIdArray.length + ' product(s) - TODO: Implement category selector');
                break;
            case 'export':
                // Export selected SKUs
                const skuList = productIdArray.join(',');
                console.log('Export SKUs:', skuList);
                alert('Exporting ' + productIdArray.length + ' product(s) - Check console for SKU list');
                break;
        }
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createActionButton);
    } else {
        createActionButton();
    }

    // Expose API for external use
    window.StockSelect = {
        isEnabled: () => selectionMode,
        getSelected: () => Array.from(selectedProducts),
        exit: exitSelectionMode
    };
})();
