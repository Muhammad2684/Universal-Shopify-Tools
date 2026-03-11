/* State */
var skuQueue = [];
var nextId   = 0;

/* DOM refs */
var skuList       = document.getElementById('skuList');
var confirmBtn    = document.getElementById('confirmBtn');
var listCols      = document.getElementById('listCols');
var listHint      = document.getElementById('listHint');
var statusMessage = document.getElementById('statusMessage');
var progressSec   = document.getElementById('progressSection');
var progressFill  = document.getElementById('progressFill');
var progressText  = document.getElementById('progressText');
var resultsLog    = document.getElementById('resultsLog');

const SESSION_KEY = 'qty_deduct_state';

function saveState() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ skuQueue, nextId }));
}

function loadState() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        skuQueue = state.skuQueue || [];
        nextId   = state.nextId   || 0;
    } catch(e) {}
}

/* Helpers */
function showStatus(msg, type) {
    type = type || 'info';
    statusMessage.textContent   = msg;
    statusMessage.className     = 'status-message ' + type;
    statusMessage.style.display = 'block';
}
function clearStatus() { statusMessage.style.display = 'none'; }

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateSummary() {
    var totalPieces = 0;
    for (var x = 0; x < skuQueue.length; x++) totalPieces += skuQueue[x].qty;
    document.getElementById('totalSkus').textContent   = skuQueue.length;
    document.getElementById('totalPieces').textContent = totalPieces;
    confirmBtn.disabled    = skuQueue.length === 0;
    listCols.style.display = skuQueue.length ? 'grid' : 'none';
    listHint.textContent   = skuQueue.length ? skuQueue.length + ' item(s)' : 'No items yet';
}

function renderList() {
    skuList.innerHTML = '';
    for (var i = 0; i < skuQueue.length; i++) {
        var item = skuQueue[i];
        var li   = document.createElement('li');
        li.className  = 'sku-item';
        li.dataset.id = item.id;
        li.innerHTML  =
            '<span class="item-num">' + (i+1) + '</span>' +
            '<span class="item-sku">' + escHtml(item.sku) + '</span>' +
            '<span class="item-qty">' + item.qty + '</span>' +
            '<div class="item-actions">' +
                '<button class="btn-icon" onclick="startEdit(' + item.id + ')">Edit</button>' +
                '<button class="btn-icon del" onclick="deleteItem(' + item.id + ')">Del</button>' +
            '</div>';
        skuList.appendChild(li);
    }
    updateSummary();
    saveState();
}

/* ✅ Fixed: addItems now merges duplicate SKUs instead of adding new rows */
function addItems(entries) {
    var added = 0;
    for (var i = 0; i < entries.length; i++) {
        var clean = entries[i].sku.trim();
        if (!clean) continue;
        var qty = Math.max(1, parseInt(entries[i].qty) || 1);

        // Check if SKU already exists in queue
        var existing = null;
        for (var j = 0; j < skuQueue.length; j++) {
            if (skuQueue[j].sku === clean) { existing = skuQueue[j]; break; }
        }

        if (existing) {
            // Merge: add qty to existing entry
            existing.qty += qty;
        } else {
            skuQueue.push({ id: nextId++, sku: clean, qty: qty });
            added++;
        }
    }
    renderList();
    return added;
}

/* Manual entry */
document.getElementById('manualSku').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addManualEntry();
});
document.getElementById('manualQty').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addManualEntry();
});

function addManualEntry() {
    var skuInput = document.getElementById('manualSku');
    var qtyInput = document.getElementById('manualQty');
    var sku      = skuInput.value.trim();
    var qty      = parseInt(qtyInput.value) || 1;
    var ms       = document.getElementById('manualStatus');
    if (!sku) { ms.textContent = 'Please enter a SKU.'; ms.style.color = '#e94560'; return; }

    // Check if merging
    var existing = skuQueue.find(function(i) { return i.sku === sku; });
    addItems([{ sku: sku, qty: qty }]);

    skuInput.value = '';
    qtyInput.value = 1;
    if (existing) {
        ms.textContent = 'Merged: ' + sku + ' → now x' + existing.qty;
        ms.style.color = '#e0a020';
    } else {
        ms.textContent = 'Added: ' + sku + ' x' + qty;
        ms.style.color = '#28a745';
    }
    skuInput.focus();
    clearStatus();
}

/* ✅ Fixed: CSV Upload - removed label click handler, using only input change event */
var csvFile  = document.getElementById('csvFile');
var fileDrop = document.getElementById('fileDrop');

fileDrop.addEventListener('dragover',  function(e) { e.preventDefault(); fileDrop.classList.add('drag-over'); });
fileDrop.addEventListener('dragleave', function()  { fileDrop.classList.remove('drag-over'); });
fileDrop.addEventListener('drop',      function(e) {
    e.preventDefault(); fileDrop.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) parseCSVFile(e.dataTransfer.files[0]);
});

/* Single click handler on the visible drop zone div (not label) */
fileDrop.addEventListener('click', function() {
    csvFile.click();
});

csvFile.addEventListener('change', function() {
    if (csvFile.files[0]) parseCSVFile(csvFile.files[0]);
    csvFile.value = ''; // reset so same file can be re-uploaded
});

function parseCSVFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        var lines   = e.target.result.split(/\r?\n/).filter(function(l) { return l.trim(); });
        var entries = [];
        for (var i = 0; i < lines.length; i++) {
            var cols = lines[i].split(',');
            var sku  = (cols[0] || '').trim();
            var qty  = (cols[1] || '').trim();
            if (sku) entries.push({ sku: sku, qty: qty || '1' });
        }
        var added = addItems(entries);
        document.getElementById('fileDropText').textContent = 'Loaded: ' + file.name + ' (' + added + ' new SKUs added)';
        clearStatus();
    };
    reader.readAsText(file);
}

/* Edit / Delete */
function startEdit(id) {
    var item = null;
    var idx  = 0;
    for (var i = 0; i < skuQueue.length; i++) { if (skuQueue[i].id === id) { item = skuQueue[i]; idx = i; break; } }
    if (!item) return;
    var li = skuList.querySelector('[data-id="' + id + '"]');
    li.innerHTML =
        '<span class="item-num">' + (idx+1) + '</span>' +
        '<input class="edit-sku" id="edit-sku-' + id + '" value="' + escHtml(item.sku) + '">' +
        '<input class="edit-qty-input" type="number" min="1" id="edit-qty-' + id + '" value="' + item.qty + '">' +
        '<div class="item-actions">' +
            '<button class="btn-icon save" onclick="saveEdit(' + id + ')">Save</button>' +
            '<button class="btn-icon" onclick="renderList()">Cancel</button>' +
        '</div>';
    document.getElementById('edit-sku-' + id).focus();
}

function saveEdit(id) {
    for (var i = 0; i < skuQueue.length; i++) {
        if (skuQueue[i].id === id) {
            var newSku = document.getElementById('edit-sku-' + id).value.trim();
            var newQty = parseInt(document.getElementById('edit-qty-' + id).value) || 1;
            if (!newSku) { alert('SKU cannot be empty.'); return; }
            skuQueue[i].sku = newSku;
            skuQueue[i].qty = Math.max(1, newQty);
            break;
        }
    }
    renderList();
}

function deleteItem(id) {
    skuQueue = skuQueue.filter(function(i) { return i.id !== id; });
    renderList();
}

/* Clear All */
function clearAll() {
    skuQueue = [];
    nextId = 0;
    renderList();
    document.getElementById('fileDropText').textContent = 'Click or drag & drop CSV here';
    document.getElementById('manualStatus').textContent = '';
    progressSec.style.display = 'none';
    clearStatus();
    saveState();
}

/* Confirm & Execute */
async function confirmDeduction() {
    if (skuQueue.length === 0) return;
    confirmBtn.disabled       = true;
    clearStatus();
    progressSec.style.display = 'block';
    resultsLog.innerHTML      = '';
    progressFill.style.width  = '0%';
    progressText.textContent  = '0 / ' + skuQueue.length;
    progressSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    var done = 0, succeeded = 0, failed = 0, total = skuQueue.length;

    for (var i = 0; i < skuQueue.length; i++) {
        var item = skuQueue[i];
        try {
            var res  = await fetch('/api/deduct_qty', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku: item.sku, qty: item.qty })
            });
            var data = await res.json();
            if (res.ok && data.success) {
                addLogItem(item.sku, item.qty, true, 'New qty: ' + data.new_qty);
                succeeded++;
            } else {
                addLogItem(item.sku, item.qty, false, data.error || 'Failed');
                failed++;
            }
        } catch (err) {
            addLogItem(item.sku, item.qty, false, 'Network error');
            failed++;
        }
        done++;
        progressFill.style.width = Math.round((done / total) * 100) + '%';
        progressText.textContent = done + ' / ' + total;
    }

    if (failed === 0)       showStatus('All ' + succeeded + ' SKU(s) deducted successfully!', 'success');
    else if (succeeded===0) showStatus('All ' + failed + ' SKU(s) failed. Check results below.', 'error');
    else                    showStatus('Done: ' + succeeded + ' succeeded, ' + failed + ' failed.', 'info');
    confirmBtn.disabled = false;
}

function addLogItem(sku, qty, ok, message) {
    var div       = document.createElement('div');
    div.className = 'log-item ' + (ok ? 'ok' : 'fail');
    div.innerHTML =
        '<span class="log-sku">' + escHtml(sku) + ' <small style="color:var(--text-dark)">x' + qty + '</small></span>' +
        '<span style="font-size:0.8em;color:var(--text-dark);flex:1;padding:0 8px;">' + escHtml(message) + '</span>' +
        '<span class="log-badge">' + (ok ? 'OK' : 'FAIL') + '</span>';
    resultsLog.appendChild(div);
    resultsLog.scrollTop = resultsLog.scrollHeight;
}

window.onload = function() {
    loadState();
    renderList();
};

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








