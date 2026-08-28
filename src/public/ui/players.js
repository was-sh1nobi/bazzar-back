(() => {
    const {esc, fmt, fmtDate, guard, buildTopbar, statusBadge} = window.uiShared;
    let search = "";
    let bannedOnly = false;

    const render = (players) => {
        const tbody = document.getElementById("rows");
        tbody.innerHTML = players.length
            ? players.map((p) => `
                <tr>
                    <td class="mono"><a class="row-link" href="/ui/players/${encodeURIComponent(p.username)}">${esc(p.username)}</a></td>
                    <td class="mono dim" title="${esc(p.playeruuid)}">${esc(p.playeruuid.slice(0, 8))}…</td>
                    <td class="mono">${fmt.format(p.balance ?? 0)}</td>
                    <td>${p.banned ? statusBadge("banned") : `<span class="dim">active</span>`}</td>
                    <td class="dim">${fmtDate(p.created_at)}</td>
                    <td>
                        <button class="icon-btn ${p.banned ? "" : "danger"} ban-btn" type="button"
                                data-uuid="${esc(p.playeruuid)}" data-banned="${p.banned ? "1" : "0"}">
                            ${p.banned ? "Unban" : "Ban"}
                        </button>
                    </td>
                </tr>`).join("")
            : `<tr class="empty-row"><td colspan="6">No players found.</td></tr>`;

        tbody.querySelectorAll(".ban-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                btn.disabled = true;
                const res = await fetch("/ui/api/ban", {
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({player: btn.dataset.uuid, banned: btn.dataset.banned !== "1"}),
                }).catch(() => null);
                if (res && res.ok) load();
                else btn.disabled = false;
            });
        });
    };

    const load = async () => {
        const me = await guard();
        if (!me) return;
        buildTopbar(me);
        const qs = new URLSearchParams();
        if (search) qs.set("q", search);
        if (bannedOnly) qs.set("banned", "1");
        const res = await fetch(`/ui/api/players?${qs}`);
        if (res.status === 401 || res.status === 403) { location.href = "/ui/login"; return; }
        const data = await res.json();
        const bannedCount = data.players.filter((p) => p.banned).length;
        document.getElementById("count").textContent =
            `${fmt.format(data.players.length)} players · ${bannedCount} banned`;
        render(data.players);
    };

    const searchInput = document.getElementById("search");
    let t;
    searchInput.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => { search = searchInput.value.trim(); load(); }, 300);
    });

    document.getElementById("banned-only").addEventListener("change", (e) => {
        bannedOnly = e.target.checked;
        load();
    });

    load();
})();