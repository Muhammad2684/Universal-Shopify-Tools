/* ── Settings Modal — Logic ────────────────────────────────────────────────── */
(function () {

    // ── Profiles state (shared with nav) ────────────────────────────────────
    let _profiles = [];
    let _activeId  = null;

    // ── Open / Close ─────────────────────────────────────────────────────────
    window.openSettingsModal = function (tab) {
        const overlay = document.getElementById('settingsOverlay');
        if (!overlay) return;
        overlay.classList.add('open');
        tab = tab || 'license';
        const navItem = document.querySelector(`.sw-nav-item[onclick*="'${tab}'"]`);
        switchTab(tab, navItem);
        _fetchSettingsInfo();
        _swFetchProfiles();
    };

    window.closeSettingsModal = function () {
        const overlay = document.getElementById('settingsOverlay');
        if (overlay) overlay.classList.remove('open');
    };

    window.handleSettingsOverlayClick = function (e) {
        if (e.target === document.getElementById('settingsOverlay')) closeSettingsModal();
    };

    // ── Tab switching ─────────────────────────────────────────────────────────
    window.switchTab = function (tabId, el) {
        document.querySelectorAll('.sw-nav-item').forEach(i => i.classList.remove('active'));
        if (el) el.classList.add('active');

        document.querySelectorAll('.sw-tab-content').forEach(t => t.classList.remove('active'));
        const target = document.getElementById('tab-' + tabId);
        if (target) target.classList.add('active');

        const title = document.getElementById('swHeaderTitle');
        if (title && el) title.textContent = 'Settings — ' + el.textContent.trim();

        if (tabId === 'profiles') _swFetchProfiles();
    };

    // ── Fetch version + license info ─────────────────────────────────────────
    async function _fetchSettingsInfo() {
        try {
            const vRes  = await fetch('/api/check_update');
            const vData = await vRes.json();
            const curVer = document.getElementById('swCurrentVer');
            if (curVer) curVer.textContent = 'v' + (vData.current_version || '—');

            const lRes  = await fetch('/api/license/status');
            const lData = await lRes.json();
            if (lData.valid) {
                const badge  = document.getElementById('swPlanBadge');
                const desc   = document.getElementById('swPlanDesc');
                const expiry = document.getElementById('swExpiryValue');
                const label  = lData.free_trial ? 'FREE TRIAL' : (lData.label || lData.plan);
                if (badge)  badge.textContent  = label.toUpperCase();
                if (desc)   desc.textContent   = 'Plan: ' + (lData.free_trial ? 'Free Trial' : lData.label);
                if (expiry) expiry.textContent = lData.expires_at ? lData.expires_at.split('T')[0] : 'Never (Lifetime)';
            }

            const alert = document.getElementById('swUpdateAlert');
            if (alert) alert.style.display = vData.update_available ? 'block' : 'none';
        } catch (e) {
            console.error('Settings info fetch failed:', e);
        }
    }

    // ── Profiles ──────────────────────────────────────────────────────────────
    async function _swFetchProfiles() {
        try {
            const res  = await fetch('/api/profiles');
            const data = await res.json();
            _profiles = data.profiles || [];
            _activeId  = data.active;
            _swRenderProfiles();
            _updateFab();
        } catch (e) {}
    }

    function _swRenderProfiles() {
        const container = document.getElementById('swProfilesList');
        if (!container) return;
        if (!_profiles.length) {
            container.innerHTML = '<div style="color:#44446b;font-size:12px;padding:8px 0;">No profiles yet. Add one below.</div>';
            return;
        }
        container.innerHTML = '';
        _profiles.forEach(p => {
            const isActive = p.id === _activeId;
            const card = document.createElement('div');
            card.className  = 'sw-profile-card' + (isActive ? ' active-profile' : '');
            card.dataset.id = p.id;
            card.innerHTML  = `
                <div class="sw-profile-card-info">
                    <div class="sw-profile-card-name">${_esc(p.name)}</div>
                    <div class="sw-profile-card-url">${_esc(p.store_url)}</div>
                </div>
                ${isActive ? '<span class="sw-profile-active-badge">Active</span>' : ''}
                <div class="sw-profile-actions">
                    ${!isActive ? `<button class="sw-profile-btn sw-activate" onclick="swActivateProfile('${p.id}')">Switch</button>` : ''}
                    <button class="sw-profile-btn" onclick="swEditProfile('${p.id}')">Edit</button>
                    <button class="sw-profile-btn sw-del" onclick="swDeleteProfile('${p.id}')">Del</button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    function _updateFab() {
        const fab = document.getElementById('fabStoreName');
        if (!fab) return;
        const active = _profiles.find(p => p.id === _activeId);
        fab.textContent = active ? active.name : 'No store';
    }

    window.swActivateProfile = async function (id) {
        const res  = await fetch(`/api/profiles/${id}/activate`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            _activeId = id;
            _swRenderProfiles();
            _updateFab();
            sessionStorage.clear();
            _swStatus('Switched to ' + data.name, 'ok');
        }
    };

    window.swDeleteProfile = async function (id) {
        window.CustomModal.confirm('Delete Profile', 'Are you sure you want to delete this profile?', async (ok) => {
            if (!ok) return;
            const res  = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) _swFetchProfiles();
        });
    };

    window.swEditProfile = function (id) {
        const p    = _profiles.find(x => x.id === id);
        if (!p) return;
        const card = document.getElementById('swProfilesList').querySelector(`[data-id="${id}"]`);
        const form = document.createElement('div');
        form.className = 'sw-profile-edit-form';
        form.innerHTML = `
            <input class="sw-pm-input" id="swedit-name-${id}"  value="${_esc(p.name)}"                placeholder="Profile name">
            <input class="sw-pm-input" id="swedit-url-${id}"   value="${_esc(p.store_url)}"           placeholder="Store URL">
            <input class="sw-pm-input" id="swedit-token-${id}" placeholder="New token (leave blank to keep)" type="password">
            <div style="display:flex;gap:8px;">
                <input class="sw-pm-input" id="swedit-ver-${id}" value="${_esc(p.api_version)}" placeholder="API Version" style="flex:1;">
            </div>
            <div style="display:flex;gap:8px;">
                <input class="sw-pm-input" id="swedit-ns-${id}"  value="${_esc(p.metafield_namespace)}" placeholder="Namespace" style="flex:1;">
                <input class="sw-pm-input" id="swedit-key-${id}" value="${_esc(p.metafield_key)}"       placeholder="Key" style="flex:1;">
            </div>
            <div class="sw-edit-actions">
                <button class="sw-btn-save-edit"   onclick="swSaveEdit('${id}')">Save</button>
                <button class="sw-btn-cancel-edit" onclick="swCancelEdit()">Cancel</button>
            </div>
        `;
        card.replaceWith(form);
    };

    window.swCancelEdit = function () { _swFetchProfiles(); };

    window.swSaveEdit = async function (id) {
        const body = {
            name:                document.getElementById(`swedit-name-${id}`).value.trim(),
            store_url:           document.getElementById(`swedit-url-${id}`).value.trim(),
            access_token:        document.getElementById(`swedit-token-${id}`).value.trim(),
            api_version:         document.getElementById(`swedit-ver-${id}`).value.trim(),
            metafield_namespace: document.getElementById(`swedit-ns-${id}`).value.trim(),
            metafield_key:       document.getElementById(`swedit-key-${id}`).value.trim(),
        };
        const res  = await fetch(`/api/profiles/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) _swFetchProfiles();
    };

    window.swAddProfile = async function () {
        const name    = document.getElementById('swNewName').value.trim();
        const url     = document.getElementById('swNewUrl').value.trim();
        const token   = document.getElementById('swNewToken').value.trim();
        const version = document.getElementById('swNewVersion').value.trim() || '2024-07';
        const ns      = document.getElementById('swNewNs').value.trim();
        const key     = document.getElementById('swNewKey').value.trim();

        if (!name || !url || !token) { _swStatus('Name, URL, and Token are required.', 'err'); return; }

        const res  = await fetch('/api/profiles', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, store_url: url, access_token: token, api_version: version, metafield_namespace: ns, metafield_key: key })
        });
        const data = await res.json();
        if (data.success) {
            ['swNewName','swNewUrl','swNewToken','swNewVersion','swNewNs','swNewKey'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            _swStatus('Profile added!', 'ok');
            _swFetchProfiles();
        } else {
            _swStatus('Error adding profile.', 'err');
        }
    };

    function _swStatus(msg, type) {
        const el = document.getElementById('swAddStatus');
        if (!el) return;
        el.textContent = msg;
        el.className   = 'sw-add-status ' + type;
        setTimeout(() => { el.textContent = ''; el.className = 'sw-add-status'; }, 3000);
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Open profiles tab from store-fab ─────────────────────────────────────
    window.openProfilesFromFab = function () {
        openSettingsModal('profiles');
    };

    window.openLicenseAdmin = function () {
        window.open('https://usht.pythonanywhere.com/admin', '_blank');
    };

})();
