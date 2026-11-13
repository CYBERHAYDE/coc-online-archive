"use strict";
/* Name and passcode accounts. The server does the real checking; this only helps people fix typos early. */
(function (App) {
  const { $, esc, icon, store, state } = App;
  let mode = "login";
  let busy = false;

  const NAME_RE = /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\-]*$/;

  function render(note) {
    const reg = mode === "register";
    $("#boot").hidden = true;
    $("#appRoot").hidden = true;
    const root = $("#authRoot");
    root.hidden = false;
    root.innerHTML =
      '<div class="auth"><div class="rule" aria-hidden="true"></div><div class="auth-inner">' +
      '<img class="auth-logo" src="logo.png" alt="Church of Christ Igbogbo" width="220">' +
      '<p class="motto">' + esc(App.CONFIG.MOTTO) + "</p>" +
      '<div class="seg" role="tablist" aria-label="Account">' +
      '<button type="button" role="tab" aria-selected="' + !reg + '" data-act="auth-mode" data-mode="login">Log in</button>' +
      '<button type="button" role="tab" aria-selected="' + reg + '" data-act="auth-mode" data-mode="register">Create account</button></div>' +
      '<form data-form="auth" class="auth-form" novalidate>' +
      '<label class="field"><span>Your name</span><input name="name" type="text" autocomplete="username" autocapitalize="words" spellcheck="false" maxlength="40" required' + (reg ? ' placeholder="e.g. Chinedu Okafor"' : "") + "></label>" +
      '<label class="field"><span>Passcode</span><span class="pass"><input name="passcode" type="password" autocomplete="' + (reg ? "new-password" : "current-password") + '" maxlength="64" required' + (reg ? ' placeholder="At least 6 characters"' : "") + '>' +
      '<button type="button" class="icon-btn" data-act="toggle-pass" aria-label="Show passcode">' + icon("eye", 20) + "</button></span></label>" +
      (reg ? '<label class="field"><span>Type the passcode again</span><input name="confirm" type="password" autocomplete="new-password" maxlength="64" required></label>' +
        '<p class="hint">Use the name people know you by, and keep it the same every time you log in. If two people share a name, add a middle name or an initial.</p>' : "") +
      '<p class="form-error" id="authError" role="alert">' + esc(note || "") + "</p>" +
      '<button type="submit" class="btn block" id="authSubmit">' + (reg ? "Create my account" : "Log in") + "</button></form>" +
      '<div class="auth-install" data-install hidden><p>Want it on your phone?</p>' + App.installButton("btn-line block") + "</div>" +
      "</div></div>";
    App.pwa.refresh();
  }

  function setError(msg) { const el = $("#authError"); if (el) el.textContent = msg || ""; }

  App.actions["auth-mode"] = (el) => { mode = el.dataset.mode; render(); };
  App.actions["toggle-pass"] = (el) => {
    const input = el.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    el.innerHTML = icon(show ? "eyeoff" : "eye", 20);
    el.setAttribute("aria-label", show ? "Hide passcode" : "Show passcode");
  };

  App.forms.auth = async (form) => {
    if (busy) return;
    const name = form.elements["name"].value.replace(/\s+/g, " ").trim();
    const pass = form.elements["passcode"].value;
    const reg = mode === "register";
    if (!name) return setError("Enter your name.");
    if (reg) {
      if (name.length < 2 || !NAME_RE.test(name)) return setError("Use letters, spaces, apostrophes and hyphens in your name.");
      if (pass.length < 6) return setError("Your passcode needs at least 6 characters.");
      if (pass !== form.elements["confirm"].value) return setError("The two passcodes don't match.");
    } else if (!pass) return setError("Enter your passcode.");
    setError("");
    busy = true;
    const btn = $("#authSubmit");
    btn.disabled = true;
    btn.textContent = reg ? "Creating account..." : "Logging in...";
    try {
      const res = await App.api(reg ? "register" : "login", { name: name, passcode: pass }, { keepSession: true });
      state.token = res.token;
      state.user = res.user;
      store.setJSON("coc.session", { token: res.token, user: res.user });
      form.reset();
      busy = false;
      App.enterApp(true);
    } catch (e) {
      busy = false;
      btn.disabled = false;
      btn.textContent = reg ? "Create my account" : "Log in";
      setError(e.network ? "Can't reach the church server. Check your data connection and try again." : e.message);
    }
  };

  function wipeLocal() {
    store.del("coc.session"); store.del("coc.cache"); store.del("coc.queue");
    state.token = ""; state.user = null;
    state.data = { Members: [], Attendance: [], Visitors: [], Prospects: [], Congregations: [], Announcements: [], History: [], SocialLinks: [] };
    state.lastSync = null;
    history.replaceState(null, "", location.pathname);
  }

  App.auth = {
    show(note) { mode = "login"; render(note); },
    expired() {
      if (!state.token) return;
      wipeLocal();
      App.sheet.close();
      mode = "login";
      render("Your session ended. Please log in again.");
    },
    async logout() {
      const pending = App.queueSize();
      if (pending) {
        const ok = await App.confirm({ title: "Log out with unsent changes?", message: pending + " change" + (pending > 1 ? "s have" : " has") + " not reached the server yet and will be lost.", confirmLabel: "Log out anyway", danger: true });
        if (!ok) return;
      }
      App.api("logout", {}, { keepSession: true, timeout: 8000 }).catch(() => {});
      App.sheet.close();
      wipeLocal();
      mode = "login";
      render();
    }
  };
  App.actions.logout = () => App.auth.logout();
})(window.App);
