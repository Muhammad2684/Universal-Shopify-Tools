/* ---------- DOM refs ---------- */
const input     = document.getElementById("orderInput");
const statusDiv = document.getElementById("statusMessage");
const orderList = document.getElementById("orderList");

/* ---------- state ---------- */
let queuedOrders = [];

/* ---------- helpers ---------- */
function showMessage(msg, type = "info") {
    statusDiv.textContent   = msg;
    statusDiv.className     = `status-message ${type}`;
    statusDiv.style.display = "block";
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
    document.getElementById("orderListHeader").style.display = "none";
    document.getElementById("orderTotal").style.display      = "none";
    document.getElementById("totalAmount").textContent       = "0.00";
}
function renderOrderToList(order, index) {
    const li = document.createElement("li");
    li.dataset.id = order.order_id;
    li.style.display    = "flex";
    li.style.alignItems = "center";
    li.style.gap        = "10px";
    li.innerHTML = `
        <div style="width:40px;text-align:left;"><strong>${index}</strong></div>
        <div style="flex-grow:1;text-align:left;">${order.order_name}</div>
        <div style="min-width:120px;text-align:right;">Rs. ${parseFloat(order.total_price || 0).toFixed(2)}</div>
    `;
    orderList.appendChild(li);
}
function updateTotalAmount() {
    const total = queuedOrders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
    document.getElementById("totalAmount").textContent = total.toFixed(2);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

        renderOrderToList(data, queuedOrders.length);
        if (!orderNumber) input.value = "";
        clearMessage();

        document.getElementById("orderListHeader").style.display = "flex";
        document.getElementById("orderTotal").style.display      = "block";
        updateTotalAmount();
    } catch (e) {
        console.error(e);
        showMessage("Error loading order", "error");
    }
}

/* ---------- CSV Upload Handler — sequential, rate-limit safe ---------- */
function handleCsvUpload(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
        const csvText   = e.target.result;
        const lines     = csvText.split('\n').map(l => l.trim()).filter(l => l);
        const orderNums = lines.map(l => l.replace(/^#/, '').trim()).filter(l => l);

        const modal = new bootstrap.Modal(document.getElementById('csvModal'));
        modal.show();

        const listContainer = document.getElementById('csv-list');
        listContainer.innerHTML = '';

        const summary = document.getElementById('csv-summary');
        summary.textContent   = `Processing 0 / ${orderNums.length}...`;
        summary.style.display = 'block';

        // Pre-create all list rows so the user sees them immediately
        const rows = orderNums.map((orderNumber, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>#${index + 1} - ${orderNumber}</strong> — <span style="color:gray;">Waiting...</span>`;
            listContainer.appendChild(li);
            return { li, orderNumber };
        });

        let validCount = 0, skippedCount = 0;

        // Process sequentially — one at a time with a 300ms gap to avoid rate limits
        for (let i = 0; i < rows.length; i++) {
            const { li, orderNumber } = rows[i];
            const span = li.querySelector('span');
            span.textContent = 'Checking...';
            span.style.color = 'gray';

            try {
                // Use the lightweight CSV check route — only 1 API call per order
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
                    // Store enough data so confirm doesn't need another API call
                    li.dataset.orderId    = data.order_id;
                    li.dataset.orderName  = data.order_name;
                    li.dataset.totalPrice = data.total_price || '0';
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

            // 300ms pause between requests — stays well within Shopify's 2 req/sec limit
           
        }

        summary.textContent = `Done — ${validCount} valid, ${skippedCount} skipped`;
    };
    reader.readAsText(file);
    document.getElementById('csvInput').value = '';
}

/* ---------- CSV Confirm Button — no extra API calls needed ---------- */
document.getElementById('confirmCsvOrders').addEventListener('click', () => {
    document.querySelectorAll('#csv-list li').forEach(row => {
        if (row.dataset.valid !== 'true') return;

        // Data already fetched during CSV check — just push directly
        const order = {
            order_id:    row.dataset.orderId,
            order_name:  row.dataset.orderName,
            total_price: row.dataset.totalPrice,
        };

        if (!queuedOrders.find(o => o.order_id === order.order_id)) {
            queuedOrders.push(order);
            renderOrderToList(order, queuedOrders.length);
        }
    });

    document.getElementById("orderListHeader").style.display = "flex";
    document.getElementById("orderTotal").style.display      = "block";
    updateTotalAmount();

    const modal = bootstrap.Modal.getInstance(document.getElementById('csvModal'));
    modal.hide();
});

/* ---------- Mark All as Paid ---------- */
async function markAllAsPaid() {
    if (!queuedOrders.length)
        return showMessage("Queue is empty.", "error");

    showMessage("Tagging orders...", "info");

    for (let i = 0; i < queuedOrders.length; i++) {
        const order = queuedOrders[i];
        const li    = document.querySelector(`li[data-id="${order.order_id}"]`);
        if (!li) continue;

        const statusSpan = document.createElement("span");
        statusSpan.style.marginLeft = "10px";
        statusSpan.style.fontStyle  = "italic";
        statusSpan.style.color      = "gray";
        statusSpan.textContent      = "Tagging...";
        li.appendChild(statusSpan);

        try {
            const res  = await fetch("/api/tag_order", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ order_id: order.order_id })
            });
            const data = await res.json();

            if (res.ok && data.message) {
                statusSpan.textContent   = "Tagged Paid";
                statusSpan.style.color   = "white";
                li.style.backgroundColor = "#28a745";
                li.style.color           = "white";
            } else {
                statusSpan.textContent   = `Failed: ${data.error || "Unknown error"}`;
                statusSpan.style.color   = "white";
                li.style.backgroundColor = "#dc3545";
                li.style.color           = "white";
            }
        } catch (err) {
            statusSpan.textContent = "Request error";
            statusSpan.style.color = "#e94560";
            li.style.opacity       = "0.6";
        }

        // Small delay between tagging requests too
        if (i < queuedOrders.length - 1) await sleep(150);
    }

    showMessage("Finished tagging.", "success");
    queuedOrders = [];
    updateTotalAmount();
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH  —  paste these functions at the bottom of main2.js
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
        if (q && items.length > 0) {
            countEl.textContent   = `(${visible} shown)`;
            countEl.style.display = 'inline';
        } else {
            countEl.style.display = 'none';
        }
    }
}

document.addEventListener('keydown', function (e) {
    const searchOpen = document.getElementById('searchBarWrap').classList.contains('open');
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (!searchOpen) toggleSearch();
        else document.getElementById('searchInput').focus();
        return;
    }
    if (e.key === 'Escape' && searchOpen) {
        toggleSearch();
        return;
    }
});


// ════════════════════════════════════════════════════════════════════════════
// SESSION MEMORY + COLUMN TOGGLES + SEARCH
// Paste at the bottom of main2.js — replace any existing window.onload.
// ════════════════════════════════════════════════════════════════════════════

const MAP_SESSION_KEY = 'markpaid_state';
const MAP_PREFS_KEY   = 'markpaid_prefs';   // localStorage — survives app restart

// ── Column visibility state ────────────────────────────────────────────────
// cols.city   = true/false
// cols.amount = true/false
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
    // City columns
    document.querySelectorAll('.col-city').forEach(el => {
        el.style.display = colState.city ? '' : 'none';
    });
    // Amount columns
    document.querySelectorAll('.col-amount').forEach(el => {
        el.style.display = colState.amount ? '' : 'none';
    });
    // Toggle button active states
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

// ── Patched renderOrderToList — adds City + Amount as column cells ─────────
// Replaces the original so city and amount cells respect colState.
const _origRender = renderOrderToList;
renderOrderToList = function(order, index) {
    const li = document.createElement('li');
    li.dataset.id = order.order_id;
    li.style.cssText = 'display:flex; align-items:center; gap:10px;';

    const cityVal   = order.city   || '—';
    const priceVal  = parseFloat(order.total_price || 0).toFixed(2);

    li.innerHTML = `
        <div style="width:40px;text-align:left;"><strong>${index}</strong></div>
        <div style="flex-grow:1;text-align:left;">${order.order_name}</div>
        <div class="col-city"   style="min-width:100px;display:${colState.city   ? '' : 'none'};">${cityVal}</div>
        <div class="col-amount" style="min-width:120px;text-align:right;display:${colState.amount ? '' : 'none'};">Rs. ${priceVal}</div>
    `;
    orderList.appendChild(li);
    saveSessionState();
};

// ── Session state (orders list) ────────────────────────────────────────────

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
    // Use patched renderOrderToList so city/amount cols are correct
    queuedOrders.forEach((order, idx) => renderOrderToList(order, idx + 1));

    document.getElementById('orderListHeader').style.display = 'flex';
    document.getElementById('orderTotal').style.display      = 'block';
    document.getElementById('colToggleBar').style.display    = 'flex';
    updateTotalAmount();
}

// Show column toggle bar whenever list header becomes visible
const _origAddOrder = addOrder;
addOrder = async function(orderNumber = null) {
    await _origAddOrder(orderNumber);
    // Show col toggle bar once at least one order is in the list
    if (queuedOrders.length > 0) {
        document.getElementById('colToggleBar').style.display = 'flex';
    }
};

// Patch clearAll — wipe session too
const _origClearAll = clearAll;
clearAll = function() {
    _origClearAll();
    sessionStorage.removeItem(MAP_SESSION_KEY);
    document.getElementById('colToggleBar').style.display = 'none';
};

// Patch markAllAsPaid — wipe session after tagging done
const _origMarkAll = markAllAsPaid;
markAllAsPaid = async function() {
    await _origMarkAll();
    sessionStorage.removeItem(MAP_SESSION_KEY);
};

// Patch CSV confirm button to also show col toggle bar
const _csvConfirmBtn = document.getElementById('confirmCsvOrders');
if (_csvConfirmBtn) {
    const _origClick = _csvConfirmBtn.onclick;
    _csvConfirmBtn.addEventListener('click', () => {
        setTimeout(() => {
            if (queuedOrders.length > 0) {
                document.getElementById('colToggleBar').style.display = 'flex';
            }
        }, 100);
    });
}

// ── Search ─────────────────────────────────────────────────────────────────

function toggleSearch() {
    const wrap   = document.getElementById('searchBarWrap');
    const btn    = document.getElementById('searchToggleBtn');
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

// ── Init ───────────────────────────────────────────────────────────────────

window.onload = () => {
    loadPrefs();
    loadSessionState();
    applyColState();
    restoreUI();
    document.getElementById('orderInput').focus();
};