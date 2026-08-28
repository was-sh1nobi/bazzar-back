(() => {
    const form = document.getElementById("login-form");
    const alertBox = document.getElementById("alert");
    const btn = document.getElementById("submit");
    const label = btn.querySelector(".btn-label");

    const showAlert = (msg, type) => {
        alertBox.textContent = msg;
        alertBox.className = `alert show ${type}`;
    };
    const hideAlert = () => { alertBox.className = "alert"; };

    // Prefill + success banner when arriving from a successful signup
    const params = new URLSearchParams(location.search);
    const created = params.get("created");
    if (created) {
        document.getElementById("username").value = created;
        showAlert("Account created — sign in to continue.", "success");
    }

    // Password visibility toggles
    document.querySelectorAll(".toggle-pass").forEach((b) => {
        b.addEventListener("click", () => {
            const input = document.getElementById(b.dataset.target);
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            b.setAttribute("aria-label", show ? "Hide password" : "Show password");
        });
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideAlert();
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        if (!username || !password) {
            showAlert("Enter your username and password.", "error");
            return;
        }

        btn.disabled = true;
        btn.classList.add("loading");
        label.textContent = "Signing in…";
        try {
            const res = await fetch("/ui/api/login", {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({username, password}),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                label.textContent = "Success!";
                location.href = "/ui/dashboard";
                return;
            }
            showAlert(data.message || "Sign in failed. Please try again.", "error");
        } catch {
            showAlert("Network error — is the server running?", "error");
        } finally {
            btn.disabled = false;
            btn.classList.remove("loading");
            label.textContent = "Sign in";
        }
    });
})();