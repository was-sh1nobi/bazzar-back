(() => {
    const {esc, fmt, fmtDate, guard, buildTopbar, statusBadge} = window.uiShared;

    const playerName = decodeURIComponent(location.pathname.split("/").pop() ?? "");
    let banned = false;

    const renderProfile = (p) => {
        banned = !!p.banned;
        document.getElementById("profile").innerHTML = `
            <div>
                <div class="profile-name">${esc(p.username)} ${p.banned ? statusBadge("banned") : `<span class="badge available">active</span>`}</div>
                <div class="profile-uuid">${esc(p.playeruuid)}</div>
            </div>
            <div class="profile-meta">
                <span>Balance: <strong class="mono">${fmt.format(p.balance ?? 0)}</strong></span>
                <span>Joined: <strong>${fmtDate(p.created_at)}</strong></span>
            </div>
            <button class="icon-btn ${p.banned ? "" : "danger"}" id="ban-toggle" type="button">
                ${p.banned ? "Unban player" : "Ban player"}
            </button>`;
        document.getElementById("ban-toggle").addEventListener("click", toggleBan);
    };

    const toggleBan = async () => {
        const res = await fetch("/ui/api/ban", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({player: playerName, banned: !banned}),
        }).catch(() => null);
        if (res && res.ok) load();
    };

    const load = async () => {
        const me = await guard();
        if (!me) return;
        buildTopbar(me);
        if (!playerName) { location.href = "/ui/players"; return; }

        const res = await fetch(`/ui/api/player/${encodeURIComponent(playerName)}`);
        if (res.status === 401 || res.status === 403) { location.href = "/ui/login"; return; }
        if (res.status === 404) {
            document.getElementById("profile").innerHTML = `<span class="dim">Player not found.</span>`;
            return;
        }
        const data = await res.json();
        renderProfile(data.player);

        document.getElementById("listings-count").textContent = `${data.listings.length} listing(s)`;
        document.getElementById("listings-rows").innerHTML = data.listings.length
            ? data.listings.map((r) => `
                <tr>
                    <td class="mono dim">${r.id}</td>
                    <td class="mono">${esc(r.material)}</td>
                    <td class="mono">${fmt.format(r.amount)}</td>
                    <td class="mono">${fmt.format(r.price)}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td class="dim">${esc(r.origin ?? "-")}</td>
                    <td class="dim">${esc(r.source ?? "-")}</td>
                </tr>`).join("")
            : `<tr class="empty-row"><td colspan="7">This player has no listings.</td></tr>`;

        document.getElementById("history-count").textContent = `${data.history.length} transaction(s)`;
        document.getElementById("history-rows").innerHTML = data.history.length
            ? data.history.map((r) => `
                <tr>
                    <td class="mono dim">${r.id}</td>
                    <td class="mono">${esc(r.seller)}</td>
                    <td class="mono">${esc(r.buyer)}</td>
                    <td class="mono">${esc(r.material)}</td>
                    <td class="mono">${fmt.format(r.amount)}</td>
                    <td class="mono">${fmt.format(r.price)}</td>
                    <td class="dim">${esc(r.origin ?? "-")}</td>
                </tr>`).join("")
            : `<tr class="empty-row"><td colspan="7">No transactions.</td></tr>`;
    };

    load();
})();