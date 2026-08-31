(() => {
    const PRIVILEGED = new Set(["owner", "admin"]);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
    const fmt = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});
    const fmtDate = (ts) => ts
        ? new Date(ts * 1000).toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"})
        : "—";

    const tbody = document.getElementById("users-tbody");

    const redirectToLogin = () => { location.href = "/ui/login"; };

    /** Eased count-up micro-animation for the dashboard stat cards. */
    const countUp = (el, target) => {
        if (prefersReducedMotion() || !Number.isFinite(target)) {
            el.textContent = fmt.format(target ?? 0);
            return;
        }
        const duration = 700;
        const start = performance.now();
        const step = (now) => {
            const k = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt.format(Math.round(target * eased));
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    const prefersReducedMotion = () =>
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const load = async () => {
        // 1. Session identity — bounce to login if the cookie is gone/expired
        let me;
        try {
            const meRes = await fetch("/ui/api/me");
            if (meRes.status === 401) return redirectToLogin();
            me = await meRes.json();
        } catch {
            return redirectToLogin();
        }
        if (!PRIVILEGED.has(me.role)) return redirectToLogin();

        document.getElementById("username").textContent = me.username;
        const badge = document.getElementById("role-badge");
        badge.textContent = me.role;
        badge.className = `badge ${me.role}`;

        // 2. Stats + users in parallel
        const [statsRes, usersRes] = await Promise.all([
            fetch("/ui/api/stats"),
            fetch("/ui/api/users"),
        ]);
        if (statsRes.status === 401 || usersRes.status === 401) return redirectToLogin();

        if (statsRes.ok) {
            const s = await statsRes.json();
            for (const key of ["totalListings", "activeListings", "totalSold", "totalUsers", "totalPlayers", "totalShopItems", "totalShopPurchases"]) {
                const el = document.getElementById(key);
                if (el) countUp(el, s[key] ?? 0);
            }
        }

        if (usersRes.ok) {
            const {users} = await usersRes.json();
            tbody.innerHTML = users.length
                ? users.map((u, i) => `
                    <tr style="--i:${i}">
                        <td class="mono dim">${esc(u.id)}</td>
                        <td class="mono">${esc(u.username)}</td>
                        <td><span class="badge ${esc(u.role)}">${esc(u.role)}</span></td>
                        <td class="dim">${fmtDate(u.created_at)}</td>
                    </tr>`).join("")
                : `<tr class="empty-row"><td colspan="4">No website users yet.</td></tr>`;
        } else {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Could not load users.</td></tr>`;
        }
    };

    document.getElementById("logout").addEventListener("click", async () => {
        await fetch("/ui/api/logout", {method: "POST"}).catch(() => {});
        location.href = "/ui/login";
    });

    document.getElementById("refresh").addEventListener("click", () => location.reload());

    load();
})();