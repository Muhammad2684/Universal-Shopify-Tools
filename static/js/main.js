const orderIdInput = document.getElementById('orderIdInput');
const orderDetailsDiv = document.getElementById('orderDetails');
const orderNameSpan = document.getElementById('orderName');
const shopifyOrderIdSpan = document.getElementById('shopifyOrderId');
const fulfillmentStatusSpan = document.getElementById('fulfillmentStatus');
const itemList = document.getElementById('itemList');
const statusMessageDiv = document.getElementById('statusMessage');
const markPackedBtn = document.getElementById('markPackedBtn');
const packedOrdersList = document.getElementById('packedOrdersList');
const packedTotalSpan = document.getElementById('packedTotal');

const imageModal = document.getElementById("imageModal");
const modalImage = document.getElementById("modalImage");
const modalClose = document.querySelector(".image-modal .close");

modalClose.onclick = () => { imageModal.style.display = "none"; };
window.onclick = function (event) {
    if (event.target == imageModal) imageModal.style.display = "none";
};

let packedOrders = [];
let currentOrder = null;
let itemCounters = {};

const SESSION_KEY = 'scanpack_state';

function saveState() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        packedOrders,
        currentOrder,
        itemCounters
    }));
}

function loadState() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        packedOrders = state.packedOrders || [];
        currentOrder = state.currentOrder || null;
        itemCounters = state.itemCounters || {};
    } catch(e) {}
}

function restoreUI() {
    updatePackedOrdersUI();

    if (!currentOrder) return;

    orderNameSpan.textContent = currentOrder.order_name;
    shopifyOrderIdSpan.textContent = currentOrder.order_id;
    fulfillmentStatusSpan.textContent = "N/A";
    itemList.innerHTML = '';

    currentOrder.line_items.forEach(item => {
        const qty = item.quantity || 1;
        const li = document.createElement('li');
        li.dataset.variantId = item.variant_id;

        const imageHtml = item.product_image
            ? `<img src="${item.product_image}" alt="${item.title}" style="width: 70px; height: auto; margin-right: 10px; cursor: zoom-in; border-radius: 13px;" onclick="openImageModal('${item.product_image}')">`
            : '';

        li.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                ${imageHtml}
                <div>
                    <span>${item.title} (SKU: ${item.sku || 'N/A'})</span><br>
                    <span>Size: ${item.size || 'N/A'}</span><br>
                    ${item.customized_name ? `<span>Customized Name: ${item.customized_name}</span><br>` : ''}
                    <div style="display: flex; align-items: center;">
                        <span class="item-quantity">Packed: <span id="packed-${item.variant_id}">0</span> / ${qty}</span>
                        <div class="counter-controls">
                            <button onclick="decrementQuantity('${item.variant_id}')">-</button>
                            <button onclick="incrementQuantity('${item.variant_id}')">+</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (item.quantity > item.available_quantity) {
            li.style.backgroundColor = 'rgba(255, 0, 0, 0.39)';
            li.title = `Warning: Not enough stock! Ordered ${item.quantity}, but only ${item.available_quantity ?? 0} available.`;
        }

        itemList.appendChild(li);

        // Restore counter display
        const packedSpan = document.getElementById(`packed-${item.variant_id}`);
        if (packedSpan) {
            packedSpan.textContent = itemCounters[item.variant_id] || 0;
            if (itemCounters[item.variant_id] === item.quantity) {
                li.classList.add('packed');
            }
        }
    });

    orderDetailsDiv.style.display = 'block';
    checkPackingCompletion();
}

orderIdInput.addEventListener('keypress', function (event) {
    if (event.key === 'Enter') fetchOrder();
});

function showMessage(message, type = 'info') {
    statusMessageDiv.textContent = message;
    statusMessageDiv.className = `status-message ${type}`;
    statusMessageDiv.style.display = 'block';
}

function clearMessage() {
    statusMessageDiv.textContent = '';
    statusMessageDiv.style.display = 'none';
}

async function fetchOrder() {
    const orderIdentifier = orderIdInput.value.trim();
    if (!orderIdentifier) {
        showMessage("Please scan or enter an Order ID/Number.", "error");
        return;
    }

    clearMessage();
    showMessage("Loading order...", "info");
    orderDetailsDiv.style.display = 'none';
    markPackedBtn.disabled = true;
    itemList.innerHTML = '';

    try {
        const response = await fetch(`/api/get_order/${orderIdentifier}`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Failed to fetch order');

        currentOrder = data;

        const tags = (data.tags || '').toLowerCase().split(',').map(t => t.trim());
        if (tags.some(tag => tag.startsWith('packed'))) {
            showMessage(`Order ${data.order_name} is already tagged as Packed.`, "info");
            saveState();
            return;
        }

        itemCounters = {};

        orderNameSpan.textContent = currentOrder.order_name;
        shopifyOrderIdSpan.textContent = currentOrder.order_id;
        fulfillmentStatusSpan.textContent = "N/A";

        currentOrder.line_items.forEach(item => {
            const qty = item.quantity || 1;
            itemCounters[item.variant_id] = 0;

            const li = document.createElement('li');
            li.dataset.variantId = item.variant_id;

            const imageHtml = item.product_image
                ? `<img src="${item.product_image}" alt="${item.title}" style="width: 70px; height: auto; margin-right: 10px; cursor: zoom-in; border-radius: 13px;" onclick="openImageModal('${item.product_image}')">`
                : '';

            li.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${imageHtml}
                    <div>
                        <span>${item.title} (SKU: ${item.sku || 'N/A'})</span><br>
                        <span>Size: ${item.size || 'N/A'}</span><br>
                        ${item.customized_name ? `<span>Customized Name: ${item.customized_name}</span><br>` : ''}
                        <div style="display: flex; align-items: center;">
                            <span class="item-quantity">Packed: <span id="packed-${item.variant_id}">0</span> / ${qty}</span>
                            <div class="counter-controls">
                                <button onclick="decrementQuantity('${item.variant_id}')">-</button>
                                <button onclick="incrementQuantity('${item.variant_id}')">+</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            if (item.quantity > item.available_quantity) {
                li.style.backgroundColor = 'rgba(255, 0, 0, 0.39)';
                li.title = `Warning: Not enough stock! Ordered ${item.quantity}, but only ${item.available_quantity ?? 0} available.`;
            }

            itemList.appendChild(li);
        });

        orderDetailsDiv.style.display = 'block';
        checkPackingCompletion();
        clearMessage();
        saveState();

    } catch (error) {
        showMessage(`Error: ${error.message}`, "error");
        console.error("Fetch order error:", error);
    } finally {
        orderIdInput.value = '';
        orderIdInput.focus();
    }
}

function openImageModal(imageUrl) {
    modalImage.src = imageUrl;
    imageModal.style.display = "block";
}

function incrementQuantity(variantId) {
    const item = currentOrder.line_items.find(i => i.variant_id == variantId);
    if (!item) return;
    if (itemCounters[variantId] < item.quantity) {
        itemCounters[variantId]++;
        updateItemDisplay(variantId);
        checkPackingCompletion();
        saveState();
    } else {
        showMessage(`Already packed maximum quantity for ${item.title}.`, "info");
    }
}

function decrementQuantity(variantId) {
    const item = currentOrder.line_items.find(i => i.variant_id == variantId);
    if (!item) return;
    if (itemCounters[variantId] > 0) {
        itemCounters[variantId]--;
        updateItemDisplay(variantId);
        checkPackingCompletion();
        saveState();
    } else {
        showMessage(`Quantity for ${item.title} is already zero.`, "info");
    }
}

function updateItemDisplay(variantId) {
    const packedCountSpan = document.getElementById(`packed-${variantId}`);
    if (packedCountSpan) {
        packedCountSpan.textContent = itemCounters[variantId];
        const listItem = packedCountSpan.closest('li');
        const item = currentOrder.line_items.find(i => i.variant_id == variantId);
        if (itemCounters[variantId] === item.quantity) {
            listItem.classList.add('packed');
        } else {
            listItem.classList.remove('packed');
        }
    }
}

function checkPackingCompletion() {
    let allItemsPacked = true;
    currentOrder.line_items.forEach(item => {
        if (item.quantity > 0 && itemCounters[item.variant_id] !== item.quantity) {
            allItemsPacked = false;
        }
    });
    markPackedBtn.disabled = !allItemsPacked;
    if (allItemsPacked) {
        showMessage("All items are packed! Ready to tag order as Packed.", "success");
    } else {
        clearMessage();
    }
}

async function markOrderAsPacked() {
    if (!currentOrder || markPackedBtn.disabled) return;

    clearMessage();
    showMessage("Marking order as Tagged in Shopify...", "info");
    markPackedBtn.disabled = true;

    try {
        const response = await fetch(`/api/fulfill_order/${currentOrder.order_id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            showMessage(data.error || 'Failed to fulfill order', 'error');
            return;
        }

        showMessage(`Order ${currentOrder.order_name} successfully fulfilled!`, "success");
        addPackedOrder(currentOrder.order_name);
        clearOrder();

    } catch (error) {
        showMessage(`Error: ${error.message}`, "error");
        console.error("Fulfillment error:", error);
    } finally {
        orderIdInput.focus();
    }
}

function addPackedOrder(orderName) {
    packedOrders.push(orderName);
    updatePackedOrdersUI();
    saveState();
}

function updatePackedOrdersUI() {
    packedOrdersList.innerHTML = '';
    packedOrders.forEach((order, i) => {
        const li = document.createElement('li');
        li.textContent = `${i + 1}. ${order}`;
        packedOrdersList.appendChild(li);
    });
    packedTotalSpan.textContent = packedOrders.length;
}

function clearPackedOrders() {
    packedOrders = [];
    updatePackedOrdersUI();
    saveState();
}

function clearOrder() {
    currentOrder = null;
    itemCounters = {};
    orderDetailsDiv.style.display = 'none';
    orderIdInput.value = '';
    itemList.innerHTML = '';
    orderNameSpan.textContent = '';
    shopifyOrderIdSpan.textContent = '';
    fulfillmentStatusSpan.textContent = '';
    markPackedBtn.disabled = true;
    clearMessage();
    orderIdInput.focus();
    saveState();
}

async function addEntryToAccountant() {
    const total = packedOrders.length;
    if (total === 0) {
        showMessage('No packed orders to add as entry.', 'error');
        return;
    }

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const dow = today.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dow === 0 || dow === 6;
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayFull  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const rate = isWeekend ? 15 : 13;
    const earnings = total * rate;

    const day = today.getDate();
    const month = today.toLocaleString('default', { month: 'long' });
    const year = today.getFullYear();
    const suffix = day === 1||day===21||day===31 ? 'st' : day===2||day===22 ? 'nd' : day===3||day===23 ? 'rd' : 'th';
    const displayDate = `${dayFull[dow]}, ${day}${suffix} ${month} ${year}`;

    const newEntry = {
        date: dateStr,
        display: displayDate,
        dayName: dayNames[dow],
        isWeekend,
        type: 'packed',
        qty: total,
        earnings,
    };

    try {
        const res = await fetch('/api/accountant/load');
        const data = await res.json();
        const entries = data.entries || [];
        entries.push(newEntry);
        await fetch('/api/accountant/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries })
        });
        showMessage(`Entry added to My Accountant`, 'success');
    } catch (e) {
        showMessage('Failed to add entry to My Accountant.', 'error');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH  —  paste at the bottom of main.js
// Replace the existing window.onload block with the one at the end of this file.
// ════════════════════════════════════════════════════════════════════════════

function toggleSearch() {
    const wrap   = document.getElementById('searchBarWrap');
    const btn    = document.getElementById('searchToggleBtn');
    const isOpen = wrap.classList.contains('open');
    if (isOpen) {
        wrap.classList.remove('open');
        btn.classList.remove('active');
        document.getElementById('searchInput').value = '';
        filterPackedList('');
    } else {
        wrap.classList.add('open');
        btn.classList.add('active');
        setTimeout(() => document.getElementById('searchInput').focus(), 40);
    }
}

function filterPackedList(query) {
    const q     = query.trim().toLowerCase();
    const items = document.querySelectorAll('#packedOrdersList li');
    let visible = 0;
    items.forEach(li => {
        const match = !q || li.textContent.toLowerCase().includes(q);
        li.classList.toggle('search-hidden', !match);
        if (match) visible++;
    });
    const countEl = document.getElementById('searchCount');
    if (countEl) {
        countEl.textContent   = (q && items.length) ? `(showing ${visible})` : '';
        countEl.style.display = (q && items.length) ? 'inline' : 'none';
    }
}

// ════════════════════════════════════════════════════════════════════════════
// F-KEY SHORTCUT
//
// The operator presses the F-key matching the total number of items in the
// order (e.g. 5 items → F5). Each press increments ALL items by 1.
//
// After incrementing:
//   - All items at max qty → auto-fires markOrderAsPacked()
//   - Some items still short → popup listing the short items with option
//     to force-confirm (fills remaining qty + marks packed) or cancel
//
// ════════════════════════════════════════════════════════════════════════════

// Increment every item in the order by 1 (capped at its required qty)
function incrementAllItems() {
    if (!currentOrder) return;
    currentOrder.line_items.forEach(item => {
        if (itemCounters[item.variant_id] < item.quantity) {
            itemCounters[item.variant_id]++;
            updateItemDisplay(item.variant_id);
        }
    });
    saveState();
}

// Returns array of items that haven't reached required qty yet
function getShortItems() {
    if (!currentOrder) return [];
    return currentOrder.line_items.filter(
        item => itemCounters[item.variant_id] < item.quantity
    );
}

// Force-fill all remaining items to their required qty then mark packed
function forceCompleteAndMark() {
    if (!currentOrder) return;
    currentOrder.line_items.forEach(item => {
        itemCounters[item.variant_id] = item.quantity;
        updateItemDisplay(item.variant_id);
    });
    checkPackingCompletion(); // enables button
    saveState();
    markOrderAsPacked();
}

// Popup listing short items — operator can confirm (force complete) or cancel
function showShortItemsPopup(shortItems) {
    return new Promise(resolve => {
        const existing = document.getElementById('fkey-popup');
        if (existing) existing.remove();

        const itemRows = shortItems.map(item => {
            const have    = itemCounters[item.variant_id];
            const need    = item.quantity;
            const label   = item.title + (item.size ? ` — ${item.size}` : '');
            return `<div style="
                display:flex; justify-content:space-between; align-items:center;
                padding:7px 10px; margin-bottom:6px;
                background:var(--item-bg); border-radius:6px;
                font-size:0.88em; color:var(--text-light);
            ">
                <span style="text-align:left; flex:1;">${label}</span>
                <span style="
                    margin-left:12px; white-space:nowrap;
                    color:var(--accent-color); font-weight:bold;
                ">${have} / ${need}</span>
            </div>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.id = 'fkey-popup';
        overlay.style.cssText = `
            position:fixed; inset:0;
            background:rgba(0,0,0,0.6);
            backdrop-filter:blur(4px);
            z-index:9000;
            display:flex; align-items:center; justify-content:center;
        `;
        overlay.innerHTML = `
            <div style="
                background:var(--bg-secondary);
                border:1px solid var(--accent-color);
                border-radius:12px;
                padding:26px 28px;
                min-width:320px; max-width:460px;
                box-shadow:0 16px 48px rgba(0,0,0,0.65);
            ">
                <p style="margin:0 0 4px; font-size:0.75em; font-weight:700;
                    text-transform:uppercase; letter-spacing:0.06em;
                    color:var(--accent-color);">Some items not fully scanned</p>
                <p style="margin:0 0 14px; font-size:0.88em; color:var(--text-dark);">
                    The following items still need more scans:
                </p>
                <div style="margin-bottom:18px;">${itemRows}</div>
                <p style="margin:0 0 18px; font-size:0.85em; color:var(--text-light);">
                    Confirm anyway? The app will fill the remaining quantities and mark the order as packed.
                </p>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button id="fkey-no" style="
                        padding:9px 22px; background:none;
                        color:var(--text-dark); border:1px solid var(--border-color);
                        border-radius:7px; font-size:0.9em; cursor:pointer;
                    ">Cancel</button>
                    <button id="fkey-yes" style="
                        padding:9px 22px; background:var(--accent-color);
                        color:#fff; border:none; border-radius:7px;
                        font-size:0.9em; font-weight:bold; cursor:pointer;
                    ">Confirm &amp; Mark Packed</button>
                </div>
                <p style="margin:12px 0 0; font-size:0.72em; color:var(--text-dark); text-align:right;">
                    <kbd style="background:var(--item-bg);border:1px solid var(--border-color);border-radius:3px;padding:1px 5px;font-family:monospace;">Enter</kbd> Confirm &nbsp;
                    <kbd style="background:var(--item-bg);border:1px solid var(--border-color);border-radius:3px;padding:1px 5px;font-family:monospace;">Esc</kbd> Cancel
                </p>
            </div>
        `;
        document.body.appendChild(overlay);

        function close(result) {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }
        function onKey(e) {
            if (e.key === 'Enter')  { e.preventDefault(); close(true);  }
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
        }

        document.getElementById('fkey-yes').onclick = () => close(true);
        document.getElementById('fkey-no').onclick  = () => close(false);
        document.addEventListener('keydown', onKey);
        document.getElementById('fkey-yes').focus();
    });
}

async function handleFKey(pressedNum) {
    if (!currentOrder) return;

    // Only react if the pressed number matches total item count
    const totalItems = currentOrder.line_items.length;
    if (pressedNum !== totalItems) return;

    // Increment all items by 1
    incrementAllItems();

    // Check if all done
    const short = getShortItems();
    if (short.length === 0) {
        // All items at max — mark automatically
        checkPackingCompletion();
        markOrderAsPacked();
        return;
    }

    // Not all done — show popup with short items
    const confirmed = await showShortItemsPopup(short);
    if (confirmed) forceCompleteAndMark();
}

// ── Replace your existing window.onload ────────────────────────────────────

window.onload = () => {
    loadState();
    restoreUI();
    orderIdInput.focus();
};

document.addEventListener('keydown', function (e) {
    const searchOpen = document.getElementById('searchBarWrap').classList.contains('open');
    const onOrderIn  = document.activeElement === orderIdInput;
    const popupOpen  = !!document.getElementById('fkey-popup');

    // F1–F10 — the operator presses the F-key = total item count
    if (/^F([1-9]|10)$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey && !popupOpen) {
        const num = parseInt(e.key.slice(1), 10);
        if (currentOrder) { e.preventDefault(); handleFKey(num); }
        return;
    }

    // Enter — load order from input field
    if (e.key === 'Enter' && onOrderIn) {
        e.preventDefault();
        fetchOrder();
        return;
    }

    // Escape — close search first, then clear order
    if (e.key === 'Escape' && !popupOpen) {
        if (searchOpen) { toggleSearch(); return; }
        if (currentOrder) { clearOrder(); return; }
    }

    // Ctrl+F — open / re-focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (!searchOpen) toggleSearch();
        else document.getElementById('searchInput').focus();
        return;
    }
});