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