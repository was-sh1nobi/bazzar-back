(() => {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
    const fmt = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});
    const fmtDate = (ts) => ts
        ? new Date(ts * 1000).toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"})
        : "—";

    const ICONS = {
        gem: `<svg class="brand-mark" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>`,
        user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        logout: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`,
        trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    };

    /** Auth guard for management pages: resolves the session or redirects to login. */
    const guard = async () => {
        try {
            const r = await fetch("/ui/api/me");
            if (!r.ok) { location.href = "/ui/login"; return null; }
            const me = await r.json();
            if (!["owner", "admin"].includes(me.role)) { location.href = "/ui/login"; return null; }
            return me;
        } catch {
            location.href = "/ui/login";
            return null;
        }
    };

    /** Builds the shared topbar (brand + nav + user chip + logout) into #topbar. */
    const buildTopbar = (me) => {
        const el = document.getElementById("topbar");
        if (!el) return;
        el.innerHTML = `
        <div class="brand" aria-hidden="true">${ICONS.gem}<span class="brand-name">BAZZAR</span></div>
        <nav class="nav" aria-label="Main">
            <a class="nav-link" href="/ui/dashboard">Dashboard</a>
            <a class="nav-link" href="/ui/listings">Listings</a>
            <a class="nav-link" href="/ui/active">Active</a>
            <a class="nav-link" href="/ui/sold">Sold</a>
            <a class="nav-link" href="/ui/players">Players</a>
            <a class="nav-link" href="/ui/shop">Shop</a>
            <a class="nav-link" href="/ui/purchases">Purchases</a>
        </nav>
        <div class="spacer"></div>
        <div class="user-chip">
            <span class="badge member" id="role-badge"></span>
            <span class="name" id="username"></span>
            <span class="avatar" aria-hidden="true">${ICONS.user}</span>
        </div>
        <button class="icon-btn danger" id="logout" type="button">${ICONS.logout}<span class="btn-text">Log out</span></button>`;
        document.getElementById("username").textContent = me.username;
        const badge = document.getElementById("role-badge");
        badge.textContent = me.role;
        badge.className = `badge ${me.role}`;
        el.querySelectorAll(".nav-link").forEach((a) => {
            if (a.getAttribute("href") === location.pathname) a.classList.add("current");
        });
        el.querySelector("#logout").addEventListener("click", async () => {
            await fetch("/ui/api/logout", {method: "POST"}).catch(() => {});
            location.href = "/ui/login";
        });
    };

    const statusBadge = (s) => `<span class="badge ${esc(String(s)).toLowerCase()}">${esc(s)}</span>`;

    /** Small unobtrusive toast notification (auto-dismisses). */
    const toast = (message, type = "success") => {
        let root = document.getElementById("toast-root");
        if (!root) {
            root = document.createElement("div");
            root.id = "toast-root";
            document.body.appendChild(root);
        }
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.setAttribute("role", "status");
        el.textContent = message;
        root.appendChild(el);
        requestAnimationFrame(() => el.classList.add("in"));
        setTimeout(() => {
            el.classList.remove("in");
            el.classList.add("out");
            setTimeout(() => el.remove(), 400);
        }, 3200);
    };

    /** Accessible confirm dialog. Resolves true only when confirmed. */
    const confirmModal = ({title, message, confirmText = "Confirm", danger = false}) =>
        new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
                <h3>${esc(title)}</h3>
                <p>${esc(message)}</p>
                <div class="modal-actions">
                    <button class="icon-btn" data-act="cancel" type="button">Cancel</button>
                    <button class="icon-btn ${danger ? "danger" : ""}" data-act="confirm" type="button">${esc(confirmText)}</button>
                </div>
            </div>`;
            const close = (result) => {
                document.removeEventListener("keydown", onKey);
                overlay.classList.add("closing");
                setTimeout(() => overlay.remove(), 200);
                resolve(result);
            };
            const onKey = (e) => { if (e.key === "Escape") close(false); };
            overlay.addEventListener("click", (e) => {
                const act = e.target instanceof Element ? e.target.closest("[data-act]") : null;
                if (act) close(act.dataset.act === "confirm");
                else if (e.target === overlay) close(false);
            });
            document.addEventListener("keydown", onKey);
            document.body.appendChild(overlay);
            overlay.querySelector('[data-act="confirm"]').focus();
        });

    window.uiShared = {esc, fmt, fmtDate, guard, buildTopbar, statusBadge, toast, confirmModal, ICONS};
})();