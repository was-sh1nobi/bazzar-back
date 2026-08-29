(() => {
    const {esc, fmt, guard, buildTopbar, statusBadge} = window.uiShared;
    const mode = document.body.dataset.mode || "all"; // all | active | sold
    const endpoint = mode === "sold" ? "/ui/api/sold" : "/ui/api/listings";

    let page = 0;
    let totalPages = 1;
    let seller = "";

    const render = (rows) => {
        const tbody = document.getElementById("rows");
        if (mode === "sold") {
            tbody.innerHTML = rows.length
                ? rows.map((r, i) => `
                    <tr style="--i:${i}">
                        <td class="mono dim">${r.id}</td>
                        <td class="mono"><a class="row-link" href="/ui/players/${encodeURIComponent(r.seller)}">${esc(r.seller)}</a></td>
                        <td class="mono"><a class="row-link" href="/ui/players/${encodeURIComponent(r.buyer)}">${esc(r.buyer)}</a></td>
                        <td class="mono">${esc(r.material)}</td>
                        <td class="mono">${fmt.format(r.amount)}</td>
                        <td class="mono">${fmt.format(r.price)}</td>
                        <td class="dim">${esc(r.origin ?? "-")}</td>
                    </tr>`).join("")
                : `<tr class="empty-row"><td colspan="7">No sales recorded yet.</td></tr>`;
        } else {
            tbody.innerHTML = rows.length
                ? rows.map((r, i) => `
                    <tr style="--i:${i}">
                        <td class="mono dim">${r.id}</td>
                        <td class="mono"><a class="row-link" href="/ui/players/${encodeURIComponent(r.seller)}">${esc(r.seller)}</a></td>
                        <td class="mono">${esc(r.material)}</td>
                        <td class="mono">${fmt.format(r.amount)}</td>
                        <td class="mono">${fmt.format(r.price)}</td>
                        <td>${statusBadge(r.status)}</td>
                        <td class="dim">${esc(r.origin ?? "-")}</td>
                        <td class="dim">${esc(r.source ?? "-")}</td>
                    </tr>`).join("")
                : `<tr class="empty-row"><td colspan="8">No listings found.</td></tr>`;
        }
    };

    const load = async () => {
        const me = await guard();
        if (!me) return;
        buildTopbar(me);
        const qs = new URLSearchParams({page: String(page)});
        if (mode === "active") qs.set("status", "AVAILABLE");
        if (seller) qs.set("seller", seller);
        const res = await fetch(`${endpoint}?${qs}`);
        if (res.status === 401 || res.status === 403) { location.href = "/ui/login"; return; }
        const data = await res.json();
        totalPages = Math.max(1, data.totalPages);
        page = Math.min(page, totalPages - 1);
        document.getElementById("count").textContent = `${fmt.format(data.total)} ${mode === "sold" ? "sales" : "listings"}`;
        document.getElementById("pageinfo").textContent = `Page ${data.page + 1} / ${totalPages}`;
        document.getElementById("prev").disabled = data.page <= 0;
        document.getElementById("next").disabled = data.page + 1 >= totalPages;
        render(data.items);
    };

    document.getElementById("prev").addEventListener("click", () => { if (page > 0) { page--; load(); } });
    document.getElementById("next").addEventListener("click", () => { if (page + 1 < totalPages) { page++; load(); } });

    const search = document.getElementById("search");
    if (search) {
        let t;
        search.addEventListener("input", () => {
            clearTimeout(t);
            t = setTimeout(() => { seller = search.value.trim(); page = 0; load(); }, 300);
        });
    }

    load();
})();