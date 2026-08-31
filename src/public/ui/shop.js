(() => {
    const {esc, fmt, guard, buildTopbar, toast} = window.uiShared;
    let items = [];
    let categories = [];
    let activeCategory = "";
    let searchTerm = "";
    let page = 0;
    const pageSize = 32;
    let totalItems = 0;
    let hasMore = true;
    let loading = false;

    const grid = document.getElementById("shop-grid");
    const catSelect = document.getElementById("category-filter");
    const searchInput = document.getElementById("search");
    const countEl = document.getElementById("count");
    const anchor = document.getElementById("infinite-scroll-anchor");
    const anchorSpinner = document.getElementById("anchor-spinner");
    const anchorText = document.getElementById("anchor-text");

    const editPriceModal = (item) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-label="Edit Price for ${esc(item.id)}">
            <h3>Edit Shop Price: <span class="mono text-success">${esc(item.id)}</span></h3>
            <p class="dim" style="margin-bottom:14px; font-size:12.5px;">Material: <strong class="mono">${esc(item.material)}</strong> | Category: <strong class="mono">${esc(item.category)}</strong></p>
            <div class="field">
                <label for="edit-buy">Buy Price ($ / unit)</label>
                <input id="edit-buy" type="number" step="0.1" min="0" value="${item.buy}"/>
            </div>
            <div class="field">
                <label for="edit-sell">Sell Price ($ / unit)</label>
                <input id="edit-sell" type="number" step="0.1" min="0" value="${item.sell}"/>
            </div>
            <div class="modal-actions">
                <button class="icon-btn" id="modal-cancel" type="button">Cancel</button>
                <button class="icon-btn" id="modal-save" type="button" style="background:var(--accent);color:#052e16;border-color:var(--accent);font-weight:600;">Save Prices</button>
            </div>
        </div>`;

        const close = () => {
            overlay.classList.add("closing");
            setTimeout(() => overlay.remove(), 200);
        };

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay || e.target.id === "modal-cancel") close();
        });

        const saveBtn = overlay.querySelector("#modal-save");
        saveBtn.addEventListener("click", async () => {
            const buyVal = parseFloat(overlay.querySelector("#edit-buy").value);
            const sellVal = parseFloat(overlay.querySelector("#edit-sell").value);

            if (!Number.isFinite(buyVal) || buyVal < 0) {
                toast("Invalid buy price", "error");
                return;
            }
            if (!Number.isFinite(sellVal) || sellVal < 0) {
                toast("Invalid sell price", "error");
                return;
            }

            saveBtn.disabled = true;
            try {
                const res = await fetch(`/ui/api/shop/${encodeURIComponent(item.id)}`, {
                    method: "PATCH",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify({buy: buyVal, sell: sellVal}),
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    toast(`Updated ${item.id} (Buy: $${buyVal}, Sell: $${sellVal})`);
                    item.buy = buyVal;
                    item.sell = sellVal;
                    // Update DOM card in place
                    const card = document.querySelector(`[data-shop-id="${esc(item.id)}"]`);
                    if (card) {
                        card.querySelector(".price-val-buy").textContent = buyVal > 0 ? '$' + fmt.format(buyVal) : '—';
                        card.querySelector(".price-val-sell").textContent = sellVal > 0 ? '$' + fmt.format(sellVal) : '—';
                    }
                    close();
                } else {
                    toast(data.message || "Failed to update price", "error");
                    saveBtn.disabled = false;
                }
            } catch {
                toast("Network error while updating price", "error");
                saveBtn.disabled = false;
            }
        });

        document.body.appendChild(overlay);
        overlay.querySelector("#edit-buy").focus();
    };

    const appendCards = (newItems) => {
        if (!items.length && !newItems.length) {
            grid.innerHTML = `<div class="empty-state">No shop items match your search.</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        newItems.forEach((item, idx) => {
            const card = document.createElement("div");
            card.className = "shop-card";
            card.dataset.shopId = item.id;
            card.style.setProperty("--i", String((items.length - newItems.length + idx) % 30));
            card.innerHTML = `
                <div class="shop-card-header">
                    <span class="shop-item-id">${esc(item.id)}</span>
                    <span class="badge category-badge">${esc(item.category)}</span>
                </div>
                <div class="shop-item-material">${esc(item.material)}</div>
                <div class="shop-prices">
                    <div class="price-box buy">
                        <span class="price-label">BUY</span>
                        <span class="price-val price-val-buy">${item.buy > 0 ? '$' + fmt.format(item.buy) : '<span class="dim">—</span>'}</span>
                    </div>
                    <div class="price-box sell">
                        <span class="price-label">SELL</span>
                        <span class="price-val price-val-sell">${item.sell > 0 ? '$' + fmt.format(item.sell) : '<span class="dim">—</span>'}</span>
                    </div>
                </div>
                <button class="icon-btn edit-price-btn" type="button" aria-label="Edit price for ${esc(item.id)}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    <span>Edit Price</span>
                </button>
            `;
            card.querySelector(".edit-price-btn").addEventListener("click", () => editPriceModal(item));
            fragment.appendChild(card);
        });

        if (page === 0) {
            grid.innerHTML = "";
        }
        grid.appendChild(fragment);
    };

    const fetchPage = async () => {
        if (loading || !hasMore) return;
        loading = true;
        anchorSpinner.style.display = "inline-block";
        anchorText.textContent = "Loading more items…";

        const qs = new URLSearchParams({
            page: String(page),
            pageSize: String(pageSize),
        });
        if (activeCategory) qs.set("category", activeCategory);
        if (searchTerm) qs.set("search", searchTerm);

        try {
            const res = await fetch(`/ui/api/shop?${qs}`);
            if (res.status === 401 || res.status === 403) {
                location.href = "/ui/login";
                return;
            }
            const data = await res.json();
            const fetched = data.items || [];
            totalItems = data.total || 0;
            hasMore = data.hasMore;

            if (page === 0) {
                items = fetched;
                if (data.categories && !categories.length) {
                    categories = data.categories;
                    catSelect.innerHTML = `<option value="">All Categories</option>` +
                        categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
                }
            } else {
                items = items.concat(fetched);
            }

            countEl.textContent = `${fmt.format(items.length)} of ${fmt.format(totalItems)} items`;
            appendCards(fetched);
            page++;

            if (!hasMore) {
                anchorSpinner.style.display = "none";
                anchorText.textContent = totalItems > 0 ? "You've reached the end of the catalog." : "";
            } else {
                anchorSpinner.style.display = "none";
                anchorText.textContent = "";
            }
        } catch {
            anchorSpinner.style.display = "none";
            anchorText.textContent = "Failed to load more items.";
            toast("Failed to load catalog items", "error");
        } finally {
            loading = false;
        }
    };

    const resetAndReload = () => {
        page = 0;
        hasMore = true;
        items = [];
        grid.innerHTML = "";
        fetchPage();
    };

    const initObserver = () => {
        if (!("IntersectionObserver" in window)) {
            // Fallback: load all
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && hasMore && !loading) {
                fetchPage();
            }
        }, {rootMargin: "250px"});
        observer.observe(anchor);
    };

    const load = async () => {
        const me = await guard();
        if (!me) return;
        buildTopbar(me);

        initObserver();
        fetchPage();
    };

    let searchTimeout;
    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchTerm = searchInput.value.trim();
            resetAndReload();
        }, 250);
    });

    catSelect.addEventListener("change", (e) => {
        activeCategory = e.target.value;
        resetAndReload();
    });

    load();
})();
