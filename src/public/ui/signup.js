(() => {
    const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
    const form = document.getElementById("signup-form");
    const alertBox = document.getElementById("alert");
    const btn = document.getElementById("submit");
    const label = btn.querySelector(".btn-label");

    const showAlert = (msg, type) => {
        alertBox.textContent = msg;
        alertBox.className = `alert show ${type}`;
    };
    const hideAlert = () => { alertBox.className = "alert"; };

    const setFieldError = (input, hintEl, hasError) => {
        input.classList.toggle("invalid", hasError);
        if (hintEl) hintEl.classList.toggle("error", hasError);
    };

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

        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const confirmInput = document.getElementById("confirm");
        const usernameHint = document.getElementById("username-hint");
        const passwordHint = document.getElementById("password-hint");

        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const confirm = confirmInput.value;

        const badUsername = !USERNAME_RE.test(username);
        const badPassword = password.length < 8 || password.length > 64;
        const badConfirm = confirm !== password;

        setFieldError(usernameInput, usernameHint, badUsername);
        setFieldError(passwordInput, passwordHint, badPassword);
        setFieldError(confirmInput, null, badConfirm);

        if (badUsername || badPassword || badConfirm) {
            showAlert(
                badUsername ? "Username must be 3–16 characters (letters, numbers, underscore)."
                : badPassword ? "Password must be 8–64 characters."
                : "Passwords do not match.",
                "error"
            );
            return;
        }

        btn.disabled = true;
        btn.classList.add("loading");
        label.textContent = "Creating account…";
        try {
            const res = await fetch("/ui/api/signup", {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({username, password, confirmPassword: confirm}),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                showAlert("Account created! Redirecting you to sign in…", "success");
                setTimeout(() => {
                    location.href = `/ui/login?created=${encodeURIComponent(username)}`;
                }, 1200);
                return;
            }
            showAlert(data.message || "Signup failed. Please try again.", "error");
        } catch {
            showAlert("Network error — is the server running?", "error");
        } finally {
            btn.disabled = false;
            btn.classList.remove("loading");
            label.textContent = "Create account";
        }
    });
})();