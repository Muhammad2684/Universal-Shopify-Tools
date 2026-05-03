/**
 * Custom Right-Click Context Menu
 * Edit menu items and functions in the CONFIG section below
 */

(function() {
    // ════════════════════════════════════════════════════════════════════════════
    // CONFIG - Edit your menu items here
    // ════════════════════════════════════════════════════════════════════════════

    const MENU_ITEMS = [
        {
            label: 'Refresh Page',
            action: function() { location.reload(); }
        },
        {
            label: 'Go Back',
            action: function() { history.back(); }
        },
        {
            label: 'Go Forward',
            action: function() { history.forward(); }
        },
        {
            label: 'divider',
            divider: true
        },
        {
            label: 'Select',
            action: function() {
                // Stock app selection mode - only activates on stock pages
                if (typeof window.toggleStockSelectMode === 'function') {
                    window.toggleStockSelectMode();
                }
            },
            stockOnly: true
        }
        // Add new items here:
        // {
        //     label: 'Your Option',
        //     action: function() { /* your code */ }
        // },
    ];

    // ════════════════════════════════════════════════════════════════════════════
    // STYLES - Injected automatically
    // ════════════════════════════════════════════════════════════════════════════

    const STYLES = `
        .context-menu {
            position: absolute;
            background: var(--bg-secondary, #1a1a2e);
            border: 1px solid var(--border-color, #33334d);
            box-shadow: 2px 2px 5px rgba(0,0,0,0.2);
            z-index: 10000;
            padding: 5px 0;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, visibility 0.2s ease;
            border-radius: 4px;
            min-width: 150px;
        }
        .context-menu ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .context-menu li {
            margin: 0;
            padding: 0;
        }
        .context-menu li a {
            display: block;
            padding: 8px 15px;
            text-decoration: none;
            color: var(--text-light, #e0e0e0);
            transition: background 0.2s ease;
            cursor: pointer;
            white-space: nowrap;
        }
        .context-menu li a:hover {
            background: var(--accent-color, #e94560);
            color: var(--button-text, #ffffff);
        }
        .context-menu .divider {
            height: 1px;
            background: var(--border-color, #33334d);
            margin: 4px 0;
        }
    `;

    // ════════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ════════════════════════════════════════════════════════════════════════════

    function init() {
        // Skip if already initialized
        if (document.getElementById('rmenu-styles') || document.getElementById('context-menu')) return;

        // Inject styles
        const styleSheet = document.createElement('style');
        styleSheet.id = 'rmenu-styles';
        styleSheet.textContent = STYLES;
        document.head.appendChild(styleSheet);

        // Create menu HTML
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';
        menu.innerHTML = buildMenuHTML();
        document.body.appendChild(menu);

        // Attach event listeners
        attachEvents(menu);
    }

    function buildMenuHTML() {
        const isStockPage = typeof window.toggleStockSelectMode === 'function';

        const items = MENU_ITEMS.map((item, index) => {
            if (item.divider) {
                return '<div class="divider"></div>';
            }
            // Skip stock-only items on non-stock pages
            if (item.stockOnly && !isStockPage) {
                return '';
            }
            return `<li><a href="#" data-index="${index}">${escapeHtml(item.label)}</a></li>`;
        }).filter(item => item !== '').join('');

        return `<ul>${items}</ul>`;
    }

    function attachEvents(menu) {
        // Right-click to show menu
        document.addEventListener('contextmenu', function(e) {
            e.preventDefault();

            // Position menu
            let x = e.pageX;
            let y = e.pageY;

            // Keep menu within viewport
            const menuRect = menu.getBoundingClientRect();
            if (x + menuRect.width > window.innerWidth) {
                x = window.innerWidth - menuRect.width - 5;
            }
            if (y + menuRect.height > window.innerHeight) {
                y = window.innerHeight - menuRect.height - 5;
            }

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.opacity = '1';
            menu.style.visibility = 'visible';
        });

        // Left-click to hide menu
        document.addEventListener('click', function() {
            menu.style.opacity = '0';
            menu.style.visibility = 'hidden';
        });

        // Handle menu item clicks
        menu.addEventListener('click', function(e) {
            const link = e.target.closest('a[data-index]');
            if (!link) return;

            e.preventDefault();
            e.stopPropagation();

            const index = parseInt(link.dataset.index, 10);
            const item = MENU_ITEMS[index];

            if (item && typeof item.action === 'function') {
                // Hide menu first
                menu.style.opacity = '0';
                menu.style.visibility = 'hidden';
                // Execute action
                item.action();
            }
        });

        // Hide on scroll
        document.addEventListener('scroll', function() {
            menu.style.opacity = '0';
            menu.style.visibility = 'hidden';
        }, true);

        // Hide on escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                menu.style.opacity = '0';
                menu.style.visibility = 'hidden';
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose global function to add custom items from other scripts
    window.RMenu = {
        addItem: function(label, action) {
            MENU_ITEMS.push({ label, action });
        },
        addDivider: function() {
            MENU_ITEMS.push({ divider: true });
        },
        clearItems: function() {
            MENU_ITEMS.length = 0;
        }
    };
})();
