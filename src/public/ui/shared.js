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

    window.uiShared = {esc, fmt, fmtDate, guard, buildTopbar, statusBadge, ICONS};
})();