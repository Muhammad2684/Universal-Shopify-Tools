/**
 * Custom Right-Click Context Menu (Shared) & Themed Modals
 * This script manages a single, app-wide context menu and custom themed modals.
 */

(function () {
    // ════════════════════════════════════════════════════════════════════════════
    // CONFIG & STATE
    // ════════════════════════════════════════════════════════════════════════════

    let DEFAULT_ITEMS = [
        {
            label: 'Refresh Page',
            action: function () { location.reload(); }
        },
        {
            label: 'Go Back',
            action: function () { history.back(); }
        },
        {
            label: 'Go Forward',
            action: function () { history.forward(); }
        },
        {
            label: 'divider',
            divider: true
        }
    ];

    let OVERRIDE_ITEMS = null;
    let currentActiveItems = [];

    const STYLES = `
        /* Context Menu */
        .context-menu {
            position: absolute;
            background: var(--bg-secondary, #1a1a2e);
            border: 1px solid var(--border-color, #33334d);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            z-index: 100000;
            padding: 5px 0;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.15s ease, visibility 0.15s ease, transform 0.15s ease;
            transform: scale(0.95);
            transform-origin: top left;
            border-radius: 8px;
            min-width: 180px;
            backdrop-filter: blur(8px);
        }
        .context-menu.visible {
            opacity: 1;
            visibility: visible;
            transform: scale(1);
        }
        .context-menu ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .context-menu li a {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            text-decoration: none;
            color: var(--text-light, #e0e0e0);
            transition: all 0.2s ease;
            cursor: pointer;
            white-space: nowrap;
            font-size: 14px;
            font-weight: 500;
        }
        .context-menu li a:hover {
            background: var(--accent-color, #e94560);
            color: #ffffff;
        }
        .context-menu .divider {
            height: 1px;
            background: var(--border-color, #33334d);
            margin: 4px 0;
            opacity: 0.5;
        }
        .context-menu li a.stock-select-item {
            font-weight: 600;
        }

        /* Custom Modals */
        .custom-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 200000;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, visibility 0.2s ease;
        }
        .custom-modal-overlay.visible {
            opacity: 1;
            visibility: visible;
        }
        .custom-modal-box {
            background: var(--bg-secondary, #1a1a2e);
            border: 1px solid var(--border-color, #33334d);
            border-radius: 14px;
            width: 400px;
            max-width: 90vw;
            padding: 24px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            transform: scale(0.9);
            transition: transform 0.2s ease;
        }
        .custom-modal-overlay.visible .custom-modal-box {
            transform: scale(1);
        }
        .custom-modal-title {
            color: var(--accent-color, #e94560);
            font-size: 1.2em;
            font-weight: 700;
            margin-bottom: 12px;
        }
        .custom-modal-message {
            color: var(--text-light, #e0e0e0);
            font-size: 0.95em;
            line-height: 1.5;
            margin-bottom: 20px;
        }
        .custom-modal-input {
            width: 100%;
            padding: 12px;
            background: var(--bg-primary, #0f0f1d);
            border: 1px solid var(--border-color, #33334d);
            border-radius: 8px;
            color: #fff;
            margin-bottom: 20px;
            font-size: 1em;
            outline: none;
        }
        .custom-modal-input:focus {
            border-color: var(--accent-color, #e94560);
        }
        .custom-modal-actions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        }
        .custom-modal-btn {
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            font-size: 0.9em;
        }
        .custom-modal-btn.primary {
            background: var(--accent-color, #e94560);
            color: #fff;
        }
        .custom-modal-btn.primary:hover {
            filter: brightness(1.1);
            transform: translateY(-1px);
        }
        .custom-modal-btn.secondary {
            background: transparent;
            border: 1px solid var(--border-color, #33334d);
            color: var(--text-dark, #888);
        }
        .custom-modal-btn.secondary:hover {
            border-color: #fff;
            color: #fff;
        }
    `;

    // ════════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ════════════════════════════════════════════════════════════════════════════

    function init() {
        const oldStyles = document.getElementById('rmenu-styles');
        if (oldStyles) oldStyles.remove();
        const oldMenu = document.getElementById('context-menu');
        if (oldMenu) oldMenu.remove();

        const styleSheet = document.createElement('style');
        styleSheet.id = 'rmenu-styles';
        styleSheet.textContent = STYLES;
        document.head.appendChild(styleSheet);

        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';
        document.body.appendChild(menu);

        createModalStructure();
        attachEvents(menu);
    }

    function createModalStructure() {
        if (document.getElementById('custom-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'custom-modal-overlay';
        overlay.className = 'custom-modal-overlay';
        overlay.innerHTML = `
            <div class="custom-modal-box">
                <div class="custom-modal-title" id="custom-modal-title"></div>
                <div class="custom-modal-message" id="custom-modal-message"></div>
                <input type="text" class="custom-modal-input" id="custom-modal-input" style="display: none;">
                <div id="custom-modal-progress-container" style="display: none; margin-top: 15px;">
                    <div style="width: 100%; background: #333; height: 8px; border-radius: 4px; overflow: hidden;">
                        <div id="custom-modal-progress-bar" style="width: 0%; height: 100%; background: var(--accent-color, #e94560); transition: width 0.3s;"></div>
                    </div>
                </div>
                <div class="custom-modal-actions">
                    <button class="custom-modal-btn secondary" id="custom-modal-cancel">Cancel</button>
                    <button class="custom-modal-btn primary" id="custom-modal-confirm">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.onclick = (e) => {
            if (e.target === overlay) window.CustomModal.close();
        };
    }

    function buildMenuHTML(targetId) {
        const inSelectionMode = window.StockSelect && window.StockSelect.isEnabled();
        const isStockPage = typeof window.toggleStockSelectMode === 'function';

        let items = (inSelectionMode && OVERRIDE_ITEMS) ? [...OVERRIDE_ITEMS] : [...DEFAULT_ITEMS];

        if (isStockPage && targetId && !inSelectionMode) {
            items.push({
                label: 'Select Product',
                action: function (id) {
                    if (window.toggleStockSelectMode) window.toggleStockSelectMode(id);
                },
                isStock: true
            });

            const productCard = document.querySelector(`[data-product-id="${targetId}"]`);
            if (productCard && productCard.querySelector('.comment-text')) {
                items.push({
                    label: 'Remove Note',
                    action: function (id) {
                        window.CustomModal.confirm('Remove Note', 'Are you sure you want to remove the note from this product?', (ok) => {
                            if (ok && window.saveComment) window.saveComment(id, true);
                        });
                    },
                    isStock: true
                });
            }
        }

        currentActiveItems = items;

        const html = items.map((item, index) => {
            if (item.divider) return '<div class="divider"></div>';
            const className = item.isStock ? 'stock-select-item' : '';
            return `<li><a href="#" class="${className}" data-index="${index}">${escapeHtml(item.label)}</a></li>`;
        }).join('');

        return `<ul>${html}</ul>`;
    }

    function attachEvents(menu) {
        document.addEventListener('contextmenu', function (e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                hideMenu(menu);
                return;
            }
            e.preventDefault();

            const productCard = e.target.closest('.product-card');
            const targetId = productCard ? productCard.dataset.productId : '';
            menu.dataset.targetId = targetId;

            menu.innerHTML = buildMenuHTML(targetId);

            let x = e.pageX;
            let y = e.pageY;
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            const menuW = 200;
            const menuH = menu.offsetHeight || 200;

            if (x + menuW > winW) x -= menuW;
            if (y + menuH > winH) y -= menuH;
            if (x < 0) x = 5;
            if (y < 0) y = 5;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.classList.add('visible');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#context-menu')) hideMenu(menu);
        });

        menu.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-index]');
            if (!link) return;
            e.preventDefault();
            e.stopPropagation();
            const index = parseInt(link.dataset.index, 10);
            const item = currentActiveItems[index];
            if (item && typeof item.action === 'function') {
                const targetId = menu.dataset.targetId;
                hideMenu(menu);
                item.action(targetId);
            }
        });

        window.addEventListener('scroll', () => hideMenu(menu), true);
        window.addEventListener('resize', () => hideMenu(menu));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(menu); });
    }

    function hideMenu(menu) { menu.classList.remove('visible'); }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // MODAL API
    // ════════════════════════════════════════════════════════════════════════════

    window.CustomModal = {
        callback: null,

        show: function (title, message, isPrompt, callback, placeholder = '') {
            this.callback = callback;
            const overlay = document.getElementById('custom-modal-overlay');
            const input = document.getElementById('custom-modal-input');
            const confirmBtn = document.getElementById('custom-modal-confirm');
            const cancelBtn = document.getElementById('custom-modal-cancel');

            document.getElementById('custom-modal-title').textContent = title;
            document.getElementById('custom-modal-message').textContent = message;

            if (isPrompt) {
                input.style.display = 'block';
                input.value = '';
                input.placeholder = placeholder;
                confirmBtn.textContent = 'Submit';
                setTimeout(() => input.focus(), 100);
            } else {
                input.style.display = 'none';
                confirmBtn.textContent = 'Confirm';
            }

            confirmBtn.onclick = () => {
                const val = isPrompt ? input.value : true;
                this.close();
                if (this.callback) this.callback(val);
            };

            cancelBtn.onclick = () => {
                this.close();
                if (this.callback) this.callback(isPrompt ? null : false);
            };

            overlay.classList.add('visible');
            document.getElementById('custom-modal-progress-container').style.display = 'none';

            // Keyboard support
            const keyHandler = (e) => {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                    document.removeEventListener('keydown', keyHandler);
                } else if (e.key === 'Escape') {
                    cancelBtn.click();
                    document.removeEventListener('keydown', keyHandler);
                }
            };
            document.addEventListener('keydown', keyHandler);
        },

        alert: function (title, message, callback) {
            this.show(title, message, false, callback);
            document.getElementById('custom-modal-cancel').style.display = 'none';
            document.getElementById('custom-modal-confirm').textContent = 'OK';
        },

        confirm: function (title, message, callback) {
            this.show(title, message, false, callback);
            document.getElementById('custom-modal-cancel').style.display = 'block';
        },

        prompt: function (title, message, placeholder, callback) {
            this.show(title, message, true, callback, placeholder);
            document.getElementById('custom-modal-cancel').style.display = 'block';
        },

        loading: function (title, message) {
            this.show(title, message, false, null);
            document.getElementById('custom-modal-cancel').style.display = 'none';
            document.getElementById('custom-modal-confirm').style.display = 'none';
            document.getElementById('custom-modal-progress-container').style.display = 'block';
            this.setProgress(0);
        },

        setProgress: function (percent) {
            const bar = document.getElementById('custom-modal-progress-bar');
            if (bar) bar.style.width = percent + '%';
        },

        close: function () {
            document.getElementById('custom-modal-overlay').classList.remove('visible');
            document.getElementById('custom-modal-confirm').style.display = 'block';
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.RMenu = {
        addItem: (label, action) => DEFAULT_ITEMS.push({ label, action }),
        setOverrideItems: (items) => { OVERRIDE_ITEMS = items; },
        clearOverrideItems: () => { OVERRIDE_ITEMS = null; },
        hide: () => { const m = document.getElementById('context-menu'); if (m) m.classList.remove('visible'); }
    };
})();
