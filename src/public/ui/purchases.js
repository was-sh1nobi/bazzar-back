(() => {
    const {esc, fmt, fmtDate, guard, buildTopbar} = window.uiShared;
    let page = 0;
    let totalPages = 1;
    let playerQuery = "";
    let itemQuery = "";

    const render = (rows) => {
        const tbody = document.getElementById("rows");
        tbody.innerHTML = rows.length
            ? rows.map((r, i) => `
                <tr style="--i:${i}">
                    <td class="mono dim">${r.id}</td>
                    <td class="mono">
                        <a class="row-link" href="/ui/players/${encodeURIComponent(r.username)}">${esc(r.username)}</a>
                    </td>
                    <td class="mono"><span class="badge material-badge">${esc(r.material)}</span> <span class="dim">(${esc(r.itemId)})</span></td>
                    <td class="mono">${fmt.format(r.amount)}</td>
                    <td class="mono">$${fmt.format(r.priceEach)}</td>
                    <td class="mono text-success">$${fmt.format(r.totalCost)}</td>
                    <td class="dim">${fmtDate(r.created_at)}</td>
                </tr>`).join("")
            : `<tr class="empty-row"><td colspan="7">No shop purchases recorded.</td></tr>`;
    };

    const load = async () => {
        const me = await guard();
        if (!me) return;
        buildTopbar(me);

        const qs = new URLSearchParams({page: String(page), pageSize: "25"});
        if (playerQuery) qs.set("player", playerQuery);
        if (itemQuery) qs.set("itemId", itemQuery);

        const res = await fetch(`/ui/api/purchases?${qs}`);
        if (res.status === 401 || res.status === 403) {
            location.href = "/ui/login";
            return;
        }
        const data = await res.json();
        totalPages = Math.max(1, data.totalPages);
        page = Math.min(page, totalPages - 1);
        document.getElementById("count").textContent = `${fmt.format(data.total)} purchases`;
        document.getElementById("pageinfo").textContent = `Page ${data.page + 1} / ${totalPages}`;
        document.getElementById("prev").disabled = data.page <= 0;
        document.getElementById("next").disabled = data.page + 1 >= totalPages;
        render(data.purchases || []);
    };

    document.getElementById("prev").addEventListener("click", () => {
        if (page > 0) { page--; load(); }
    });
    document.getElementById("next").addEventListener("click", () => {
        if (page + 1 < totalPages) { page++; load(); }
    });

    let timeout;
    const onFilterChange = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            playerQuery = document.getElementById("search-player").value.trim();
            itemQuery = document.getElementById("search-item").value.trim();
            page = 0;
            load();
        }, 300);
    };

    document.getElementById("search-player").addEventListener("input", onFilterChange);
    document.getElementById("search-item").addEventListener("input", onFilterChange);

    load();
})();
