/* ---------- DOM refs ---------- */
const input     = document.getElementById("orderInput");
const statusDiv = document.getElementById("statusMessage");
const orderList = document.getElementById("orderList");

/* ---------- state ---------- */
let queuedOrders = [];

/* ---------- sounds ---------- */
function playBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
    } catch(e) {}
}
function playError() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
    } catch(e) {}
}
function playPopup() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [660, 440].forEach((freq, i) => {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine';
            const t = ctx.currentTime + i * 0.12;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
            osc.start(t); osc.stop(t + 0.12);
        });
    } catch(e) {}
}

/* ---------- helpers ---------- */
function showMessage(msg, type = "info") {
    statusDiv.textContent   = msg;
    statusDiv.className     = `status-message ${type}`;
    statusDiv.style.display = "block";
    if (type === 'error') playError();
    if (type === 'success') playBeep();
}
function clearMessage() {
    statusDiv.textContent   = "";
    statusDiv.style.display = "none";
}
function clearAll() {
    input.value         = "";
    orderList.innerHTML = "";
    queuedOrders        = [];
    clearMessage();
    hideProgressBar();
    document.getElementById("orderListHeader").style.display = "none";
    document.getElementById("orderTotal").style.display      = "none";
    document.getElementById("totalAmount").textContent       = "0.00";
}
function updateTotalAmount() {
    const total = queuedOrders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
    document.getElementById("totalAmount").textContent = total.toFixed(2);
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---------- renumber all rows after delete ---------- */
function renumberRows() {
    const rows = orderList.querySelectorAll('li[data-id]');
    rows.forEach((li, i) => {
        const numEl = li.querySelector('.row-num');
        if (numEl) numEl.textContent = i + 1;
    });
}

/* ---------- delete an order from queue ---------- */
function deleteOrder(orderId) {
    queuedOrders = queuedOrders.filter(o => String(o.order_id) !== String(orderId));
    const li = orderList.querySelector(`li[data-id="${orderId}"]`);
    if (li) li.remove();
    renumberRows();
    updateTotalAmount();
    saveSessionState();
    if (!queuedOrders.length) {
        document.getElementById("orderListHeader").style.display = "none";
        document.getElementById("orderTotal").style.display      = "none";
        document.getElementById("colToggleBar").style.display    = "none";
    }
}

/* ---------- inline edit ---------- */
function editOrder(orderId) {
    const order = queuedOrders.find(o => String(o.order_id) === String(orderId));
    if (!order) return;

    const li = orderList.querySelector(`li[data-id="${orderId}"]`);
    if (!li) return;

    // Already in edit mode — bail
    if (li.dataset.editing === 'true') return;
    li.dataset.editing = 'true';

    const nameEl   = li.querySelector('.row-name');
    const amountEl = li.querySelector('.col-amount');

    const origName  = order.order_name;
    const origPrice = parseFloat(order.total_price || 0).toFixed(2);

    // Replace name with input
    const nameInput = document.createElement('input');
    nameInput.type  = 'text';
    nameInput.value = origName;
    nameInput.style.cssText = 'width:100%;background:#1a1a2e;color:#e0e0e0;border:1px solid #e94560;border-radius:4px;padding:3px 7px;font-size:0.93em;';
    nameEl.innerHTML = '';
    nameEl.appendChild(nameInput);

    // Replace amount with input (only if visible)
    let priceInput = null;
    if (amountEl && colState.amount) {
        priceInput = document.createElement('input');
        priceInput.type  = 'text';
        priceInput.value = origPrice;
        priceInput.style.cssText = 'width:90px;background:#1a1a2e;color:#e0e0e0;border:1px solid #e94560;border-radius:4px;padding:3px 7px;font-size:0.93em;text-align:right;';
        amountEl.innerHTML = 'Rs. ';
        amountEl.appendChild(priceInput);
    }

    // Swap edit button to save button
    const editBtn = li.querySelector('.btn-edit');
    if (editBtn) {
        editBtn.textContent = 'Save';
        editBtn.style.borderColor = '#28a745';
        editBtn.style.color       = '#28a745';
        editBtn.onclick = () => saveEdit(orderId, nameInput, priceInput, origName, origPrice);
    }

    // Also save on Enter
    nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveEdit(orderId, nameInput, priceInput, origName, origPrice);
        if (e.key === 'Escape') cancelEdit(orderId, origName, origPrice);
    });
    if (priceInput) {
        priceInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') saveEdit(orderId, nameInput, priceInput, origName, origPrice);
            if (e.key === 'Escape') cancelEdit(orderId, origName, origPrice);
        });
    }

    nameInput.focus();
    nameInput.select();
}

function saveEdit(orderId, nameInput, priceInput, origName, origPrice) {
    const order = queuedOrders.find(o => String(o.order_id) === String(orderId));
    if (!order) return;

    const newName  = nameInput.value.trim() || origName;
    const newPrice = priceInput ? (parseFloat(priceInput.value) || parseFloat(origPrice)) : parseFloat(order.total_price || 0);

    order.order_name  = newName;
    order.total_price = String(newPrice);

    const li = orderList.querySelector(`li[data-id="${orderId}"]`);
    if (li) li.dataset.editing = 'false';

    // Re-render this row in place
    rerenderRow(orderId);
    updateTotalAmount();
    saveSessionState();
}

function cancelEdit(orderId, origName, origPrice) {
    const order = queuedOrders.find(o => String(o.order_id) === String(orderId));
    if (!order) return;
    order.order_name  = origName;
    order.total_price = origPrice;
    const li = orderList.querySelector(`li[data-id="${orderId}"]`);
    if (li) li.dataset.editing = 'false';
    rerenderRow(orderId);
}

function rerenderRow(orderId) {
    const order = queuedOrders.find(o => String(o.order_id) === String(orderId));
    if (!order) return;
    const li = orderList.querySelector(`li[data-id="${orderId}"]`);
    if (!li) return;
    const idx = queuedOrders.indexOf(order) + 1;
    const cityVal  = order.city  || '—';
    const priceVal = parseFloat(order.total_price || 0).toFixed(2);
    li.innerHTML = buildRowInnerHTML(idx, order.order_name, cityVal, priceVal, orderId);
    li.dataset.editing = 'false';
    applyColState();
}

function buildRowInnerHTML(index, orderName, cityVal, priceVal, orderId) {
    return `
        <div style="width:40px;text-align:left;"><strong class="row-num">${index}</strong></div>
        <div class="row-name" style="flex-grow:1;text-align:left;">${orderName}</div>
        <div class="col-city"   style="min-width:100px;display:${colState.city   ? '' : 'none'};">${cityVal}</div>
        <div class="col-amount" style="min-width:120px;text-align:right;display:${colState.amount ? '' : 'none'};">Rs. ${priceVal}</div>
        <div class="row-actions" style="display:flex;gap:5px;margin-left:8px;flex-shrink:0;">
            <button class="btn-edit"
                style="padding:3px 10px;font-size:0.78em;border:1px solid #4a9eff;color:#4a9eff;background:none;border-radius:4px;cursor:pointer;"
                onclick="editOrder('${orderId}')">Edit</button>
            <button class="btn-del"
                style="padding:3px 10px;font-size:0.78em;border:1px solid #e94560;color:#e94560;background:none;border-radius:4px;cursor:pointer;"
                onclick="deleteOrder('${orderId}')">Del</button>
        </div>
    `;
}

/* ---------- progress bar ---------- */
function showProgressBar() {
    let bar = document.getElementById('markPaidProgress');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'markPaidProgress';
        bar.style.cssText = 'margin:12px 0 4px;';
        bar.innerHTML = `
            <div style="background:#1a1a2e;border-radius:8px;height:16px;overflow:hidden;border:1px solid #33334d;">
                <div id="markPaidFill" style="height:100%;background:#e94560;border-radius:8px;width:0%;transition:width 0.25s ease;"></div>
            </div>
            <div id="markPaidText" style="text-align:center;font-size:0.82em;color:#888;margin-top:4px;">0 / 0</div>
        `;
        statusDiv.insertAdjacentElement('afterend', bar);
    }
    bar.style.display = 'block';
}
function updateProgressBar(done, total) {
    const fill = document.getElementById('markPaidFill');
    const text = document.getElementById('markPaidText');
    if (fill) fill.style.width = `${Math.round((done / total) * 100)}%`;
    if (text) text.textContent = `${done} / ${total}`;
}
function hideProgressBar() {
    const bar = document.getElementById('markPaidProgress');
    if (bar) bar.style.display = 'none';
}

/* ---------- renderOrderToList (base — overridden below) ---------- */
function renderOrderToList(order, index) {
    const li = document.createElement("li");
    li.dataset.id = order.order_id;
    li.style.cssText = 'display:flex; align-items:center; gap:10px;';
    const cityVal  = order.city  || '—';
    const priceVal = parseFloat(order.total_price || 0).toFixed(2);
    li.innerHTML = buildRowInnerHTML(index, order.order_name, cityVal, priceVal, order.order_id);
    orderList.appendChild(li);
}

/* ---------- manual "Add Order" button ---------- */
async function addOrder(orderNumber = null) {
    const id = orderNumber ? orderNumber.trim() : input.value.trim();
    if (!id) return showMessage("Please enter an order ID", "error");

    showMessage("Loading order...", "info");

    try {
        const res  = await fetch(`/api/get_order_mark_paid/${encodeURIComponent(id)}`);
        const data = await res.json();

        if (!res.ok)
            return showMessage(data.error || "Failed to load order", "error");
        if (data.payment_status === "paid")
            return showMessage(`${data.order_name} is already marked as paid.`, "error");
        if ((data.tags || "").toLowerCase().includes("paid"))
            return showMessage(`Order ${data.order_name} is already tagged as Paid.`, "error");
        if (queuedOrders.find(o => o.order_id === data.order_id))
            return showMessage(`${data.order_name} is already added.`, "error");

        queuedOrders.push({
            order_id:    data.order_id,
            order_name:  data.order_name,
            city:        data.city,
            total_price: data.total_price
        });

        renderOrderToList(queuedOrders[queuedOrders.length - 1], queuedOrders.length);
        if (!orderNumber) input.value = "";
        clearMessage();

        document.getElementById("orderListHeader").style.display = "flex";
        document.getElementById("orderTotal").style.display      = "block";
        document.getElementById("colToggleBar").style.display    = "flex";
        updateTotalAmount();
        saveSessionState();
    } catch (e) {
        console.error(e);
        showMessage("Error loading order", "error");
    }
}

/* ---------- CSV Upload Handler ---------- */
function handleCsvUpload(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
        const csvText   = e.target.result;
        const lines     = csvText.split('\n').map(l => l.trim()).filter(l => l);
        const orderNums = lines.map(l => l.replace(/^#/, '').trim()).filter(l => l);

        playPopup();
        const modal = new bootstrap.Modal(document.getElementById('csvModal'));
        modal.show();

        const listContainer = document.getElementById('csv-list');
        listContainer.innerHTML = '';

        const summary = document.getElementById('csv-summary');
        summary.textContent   = `Processing 0 / ${orderNums.length}...`;
        summary.style.display = 'block';

        const rows = orderNums.map((orderNumber, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>#${index + 1} - ${orderNumber}</strong> — <span style="color:gray;">Waiting...</span>`;
            listContainer.appendChild(li);
            return { li, orderNumber };
        });

        let validCount = 0, skippedCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const { li, orderNumber } = rows[i];
            const span = li.querySelector('span');
            span.textContent = 'Checking...';
            span.style.color = 'gray';

            try {
                const res  = await fetch(`/api/check_order_csv/${encodeURIComponent(orderNumber)}`);
                const data = await res.json();

                const alreadyIn = queuedOrders.some(
                    q => q.order_name === data.order_name || q.order_id == data.order_id
                );

                let valid = true, reason = '';
                if (!res.ok || !data.found)                                    { valid = false; reason = data.error || "Not found"; }
                else if ((data.financial_status || '') === 'paid')             { valid = false; reason = "Already paid"; }
                else if ((data.tags || '').toLowerCase().includes('paid'))     { valid = false; reason = "Already tagged Paid"; }
                else if (alreadyIn)                                            { valid = false; reason = "Already in list"; }

                li.dataset.valid       = valid ? 'true' : 'false';
                li.dataset.orderNumber = orderNumber;

                if (valid) {
                    validCount++;
                    li.dataset.orderId    = data.order_id;
                    li.dataset.orderName  = data.order_name;
                    li.dataset.totalPrice = data.total_price || '0';
                    li.dataset.city       = data.city || '';
                    span.textContent = 'Valid';
                    span.style.color = 'lightgreen';
                } else {
                    skippedCount++;
                    span.textContent = `Skipped: ${reason}`;
                    span.style.color = '#e94560';
                    li.style.opacity = '0.6';
                }
            } catch (err) {
                skippedCount++;
                span.textContent = 'Error';
                span.style.color = '#e94560';
            }

            summary.textContent = `Processing ${i + 1} / ${orderNums.length} — ${validCount} valid, ${skippedCount} skipped`;
        }

        summary.textContent = `Done — ${validCount} valid, ${skippedCount} skipped`;
    };
    reader.readAsText(file);
    document.getElementById('csvInput').value = '';
}

/* ---------- CSV Confirm Button ---------- */
document.getElementById('confirmCsvOrders').addEventListener('click', () => {
    document.querySelectorAll('#csv-list li').forEach(row => {
        if (row.dataset.valid !== 'true') return;
        const order = {
            order_id:    row.dataset.orderId,
            order_name:  row.dataset.orderName,
            total_price: row.dataset.totalPrice,
            city:        row.dataset.city || '',
        };
        if (!queuedOrders.find(o => o.order_id === order.order_id)) {
            queuedOrders.push(order);
            renderOrderToList(order, queuedOrders.length);
        }
    });

    document.getElementById("orderListHeader").style.display = "flex";
    document.getElementById("orderTotal").style.display      = "block";
    document.getElementById("colToggleBar").style.display    = "flex";
    updateTotalAmount();
    saveSessionState();

    const modal = bootstrap.Modal.getInstance(document.getElementById('csvModal'));
    modal.hide();
});

/* ---------- Mark All as Paid ---------- */
async function markAllAsPaid() {
    if (!queuedOrders.length)
        return showMessage("Queue is empty.", "error");

    // Disable action buttons during processing
    document.querySelectorAll('.btn-edit, .btn-del').forEach(b => b.disabled = true);

    showMessage(`Tagging ${queuedOrders.length} orders...`, "info");
    showProgressBar();
    updateProgressBar(0, queuedOrders.length);

    let successCount = 0, failCount = 0;

    for (let i = 0; i < queuedOrders.length; i++) {
        const order = queuedOrders[i];
        const li    = orderList.querySelector(`li[data-id="${order.order_id}"]`);

        // Update progress first
        updateProgressBar(i + 1, queuedOrders.length);

        if (!li) continue;

        // Remove action buttons on this row while processing
        const actions = li.querySelector('.row-actions');
        if (actions) actions.remove();

        // Append status span
        const statusSpan = document.createElement("span");
        statusSpan.style.cssText = 'margin-left:10px;font-style:italic;font-size:0.85em;';
        statusSpan.style.color   = 'gray';
        statusSpan.textContent   = "Tagging...";
        li.appendChild(statusSpan);

        try {
            const res  = await fetch("/api/tag_order", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ order_id: order.order_id })
            });
            const data = await res.json();

            if (res.ok && data.message) {
                successCount++;
                statusSpan.textContent   = "Paid";
                statusSpan.style.color   = "#fff";
                li.style.backgroundColor = "#28a745";
                li.style.color           = "#fff";
            } else {
                failCount++;
                statusSpan.textContent   = `Failed: ${data.error || "Unknown"}`;
                statusSpan.style.color   = "#fff";
                li.style.backgroundColor = "#dc3545";
                li.style.color           = "#fff";
            }
        } catch (err) {
            failCount++;
            statusSpan.textContent = "Request error";
            statusSpan.style.color = "#e94560";
            li.style.opacity       = "0.6";
        }

        if (i < queuedOrders.length - 1) await sleep(150);
    }

    const msg = failCount === 0
        ? `Done — ${successCount} orders tagged as Paid.`
        : `Done — ${successCount} tagged, ${failCount} failed.`;
    showMessage(msg, failCount === 0 ? "success" : "error");

    // Final progress fill to 100%
    updateProgressBar(queuedOrders.length, queuedOrders.length);

    queuedOrders = [];
    updateTotalAmount();
    sessionStorage.removeItem(MAP_SESSION_KEY);
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH
// ════════════════════════════════════════════════════════════════════════════

function toggleSearch() {
    const wrap = document.getElementById('searchBarWrap');
    const btn  = document.getElementById('searchToggleBtn');
    const isOpen = wrap.classList.contains('open');
    if (isOpen) {
        wrap.classList.remove('open');
        btn.classList.remove('active');
        document.getElementById('searchInput').value = '';
        filterOrderList('');
    } else {
        wrap.classList.add('open');
        btn.classList.add('active');
        setTimeout(() => document.getElementById('searchInput').focus(), 40);
    }
}

function filterOrderList(query) {
    const q     = query.trim().toLowerCase();
    const items = document.querySelectorAll('#orderList li');
    let visible = 0;
    items.forEach(li => {
        const match = !q || li.textContent.toLowerCase().includes(q);
        li.classList.toggle('search-hidden', !match);
        if (match) visible++;
    });
    const countEl = document.getElementById('searchCount');
    if (countEl) {
        countEl.textContent   = (q && items.length) ? `(${visible} shown)` : '';
        countEl.style.display = (q && items.length) ? 'inline' : 'none';
    }
}

document.addEventListener('keydown', function(e) {
    const wrap       = document.getElementById('searchBarWrap');
    const searchOpen = wrap && wrap.classList.contains('open');
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (!searchOpen) toggleSearch();
        else document.getElementById('searchInput').focus();
        return;
    }
    if (e.key === 'Escape' && searchOpen) { toggleSearch(); return; }
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION MEMORY + COLUMN TOGGLES
// ════════════════════════════════════════════════════════════════════════════

const MAP_SESSION_KEY = 'markpaid_state';
const MAP_PREFS_KEY   = 'markpaid_prefs';

let colState = { city: true, amount: true };

function loadPrefs() {
    try {
        const raw = localStorage.getItem(MAP_PREFS_KEY);
        if (raw) colState = Object.assign(colState, JSON.parse(raw));
    } catch (e) {}
}
function savePrefs() {
    localStorage.setItem(MAP_PREFS_KEY, JSON.stringify(colState));
}
function applyColState() {
    document.querySelectorAll('.col-city').forEach(el => {
        el.style.display = colState.city ? '' : 'none';
    });
    document.querySelectorAll('.col-amount').forEach(el => {
        el.style.display = colState.amount ? '' : 'none';
    });
    const btnCity   = document.getElementById('togCity');
    const btnAmount = document.getElementById('togAmount');
    if (btnCity)   btnCity.classList.toggle('on',   colState.city);
    if (btnAmount) btnAmount.classList.toggle('on', colState.amount);
}
function toggleColumn(col) {
    colState[col] = !colState[col];
    applyColState();
    savePrefs();
}

// ── Session state ─────────────────────────────────────────────────────────
function saveSessionState() {
    sessionStorage.setItem(MAP_SESSION_KEY, JSON.stringify({ queuedOrders }));
}
function loadSessionState() {
    try {
        const raw = sessionStorage.getItem(MAP_SESSION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            queuedOrders = parsed.queuedOrders || [];
        }
    } catch (e) {}
}
function restoreUI() {
    if (!queuedOrders.length) return;
    orderList.innerHTML = '';
    queuedOrders.forEach((order, idx) => renderOrderToList(order, idx + 1));
    document.getElementById('orderListHeader').style.display = 'flex';
    document.getElementById('orderTotal').style.display      = 'block';
    document.getElementById('colToggleBar').style.display    = 'flex';
    updateTotalAmount();
    applyColState();
}

// Patch clearAll to wipe session + progress bar
const _origClearAll = clearAll;
clearAll = function() {
    _origClearAll();
    sessionStorage.removeItem(MAP_SESSION_KEY);
    document.getElementById('colToggleBar').style.display = 'none';
};

// ── Init ──────────────────────────────────────────────────────────────────
window.onload = () => {
    loadPrefs();
    loadSessionState();
    applyColState();
    restoreUI();
    document.getElementById('orderInput').focus();
};