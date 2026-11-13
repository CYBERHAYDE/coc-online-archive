"use strict";
/* Routing, navigation and start-up. */
(function (App) {
  const { $, $$, esc, icon, store, state } = App;

  const ROUTES = {
    home: { title: "Home", icon: "home", group: "Church" },
    history: { title: "Our history", icon: "history", group: "Church" },
    bulletin: { title: "Bulletin", icon: "bulletin", group: "Church" },
    connect: { title: "Connect", icon: "connect", group: "Church" },
    nearby: { title: "Nearby churches", icon: "nearby", group: "Church" },
    members: { title: "Members", icon: "members", group: "Admin", role: "admin" },
    attendance: { title: "Attendance", icon: "attendance", group: "Admin", role: "admin" },
    visitors: { title: "Visitors", icon: "visitors", group: "Admin", role: "admin" },
    prospects: { title: "Prospects", icon: "prospects", group: "Admin", role: "admin" },
    popups: { title: "Pop-ups", icon: "popups", group: "Admin", role: "admin" },
    reports: { title: "Reports", icon: "reports", group: "Admin", role: "admin" },
    accounts: { title: "Accounts", icon: "accounts", group: "Owner", role: "owner" }
  };
  const allowed = (name) => {
    const r = ROUTES[name];
    if (!r) return false;
    if (r.role === "owner") return App.isOwner();
    if (r.role === "admin") return App.isAdmin();
    return true;
  };
  const visibleRoutes = () => Object.keys(ROUTES).filter(allowed);
  const BAR_MEMBER = ["home", "history", "bulletin", "connect"];
  const BAR_ADMIN = ["home", "members", "attendance", "history"];
  const barItems = () => (App.isAdmin() ? BAR_ADMIN : BAR_MEMBER);

  const link = (name, cls) => '<a href="#/' + name + '" class="' + cls + '" data-route="' + name + '">' + icon(ROUTES[name].icon, cls === "tab" ? 24 : 20) + "<span>" + esc(ROUTES[name].title) + "</span></a>";

  function buildChrome() {
    const u = state.user;
    $("#avatarBtn").textContent = App.initials(u.name);
    const groups = {};
    visibleRoutes().forEach((n) => { (groups[ROUTES[n].group] = groups[ROUTES[n].group] || []).push(n); });
    $("#rail").innerHTML = '<div class="rail-brand"><img src="logo.png" alt="Church of Christ Igbogbo" width="168"></div><nav aria-label="Sections">' +
      Object.keys(groups).map((g) => '<p class="rail-group">' + esc(g) + "</p>" + groups[g].map((n) => link(n, "rail-link")).join("")).join("") + "</nav>" +
      '<div class="rail-foot"><div data-install hidden>' + App.installButton("btn-line block") + '</div><button type="button" class="rail-me" data-act="account"><span class="avatar">' + esc(App.initials(u.name)) + '</span><span class="rail-me-text"><strong>' + esc(u.name) + "</strong><span>" + esc(App.roleLabel(u.role)) + "</span></span></button></div>";
    $("#tabbar").innerHTML = barItems().map((n) => link(n, "tab")).join("") +
      '<button type="button" class="tab" data-act="more" data-route="more">' + icon("more", 24) + "<span>More</span></button>";
    App.pwa.refresh();
    markActive();
  }

  function markActive() {
    const bar = barItems();
    $$("[data-route]").forEach((el) => {
      const n = el.dataset.route;
      const on = n === state.route || (n === "more" && bar.indexOf(state.route) === -1);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
  }

  App.actions.more = () => {
    const bar = barItems();
    const rows = visibleRoutes().filter((n) => bar.indexOf(n) === -1);
    App.sheet.show(App.sheetHead("More") + '<div class="sheet-pad"><div class="list">' +
      rows.map((n) => '<button type="button" class="row" data-act="more-go" data-to="' + n + '"><span class="more-ico">' + icon(ROUTES[n].icon, 22) + '</span><span class="row-main"><strong>' + esc(ROUTES[n].title) + "</strong></span>" + icon("chevron", 18) + "</button>").join("") +
      '<button type="button" class="row" data-act="more-account"><span class="avatar">' + esc(App.initials(state.user.name)) + '</span><span class="row-main"><strong>My account</strong><span class="muted small">' + esc(state.user.name) + "</span></span>" + icon("chevron", 18) + "</button></div>" +
      '<div data-install hidden class="stack top-gap">' + App.installButton("block") + "</div></div>");
    App.pwa.refresh();
  };
  App.actions["more-go"] = (el) => { const to = el.dataset.to; App.sheet.close(() => App.go(to)); };
  App.actions["more-account"] = () => App.sheet.close(() => App.actions.account());

  /* ---------- routing ---------- */
  const routeFromHash = () => {
    const h = location.hash.replace(/^#\/?/, "");
    return allowed(h) ? h : "home";
  };
  function renderRoute(name) {
    state.route = name;
    const view = App.views[name];
    const el = $("#view");
    $("#topTitle").textContent = ROUTES[name].title;
    document.title = ROUTES[name].title + " | COC Igbogbo";
    el.innerHTML = "";
    view.render(el);
    markActive();
    window.scrollTo(0, 0);
    el.focus({ preventScroll: true });
  }
  App.go = (name) => {
    if (!allowed(name)) name = "home";
    if (location.hash === "#/" + name) renderRoute(name);
    else location.hash = "#/" + name;
  };
  App.refreshView = () => {
    const v = App.views[state.route];
    if (v && v.fill && !$("#appRoot").hidden) v.fill();
  };
  function onNav() {
    if (App.sheet.handlePop()) return;
    if (!state.user || $("#appRoot").hidden) return;
    const name = routeFromHash();
    if (name !== state.route) renderRoute(name);
  }
  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);

  App.onSynced = (roleChanged) => {
    if (roleChanged) {
      buildChrome();
      if (!allowed(state.route)) { App.go("home"); return; }
      renderRoute(state.route);
      return;
    }
    App.refreshView();
  };

  /* ---------- entering the app ---------- */
  let timers = false;
  App.enterApp = (fresh) => {
    $("#boot").hidden = true;
    $("#authRoot").hidden = true;
    $("#authRoot").innerHTML = "";
    $("#appRoot").hidden = false;
    buildChrome();
    const start = fresh ? "home" : routeFromHash();
    if (fresh) history.replaceState(null, "", location.pathname + "#/home");
    renderRoute(start);
    App.updateSyncLabel();
    const first = fresh ? App.sync() : App.flushQueue().then(() => App.sync());
    Promise.resolve(first).then(() => App.runPopups()).catch(() => {});
    if (!timers) {
      timers = true;
      setInterval(() => { if (!document.hidden && state.token) App.sync(); }, 90000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden && state.token) { App.flushQueue().then(() => App.sync()); } });
    }
  };

  /* ---------- start ---------- */
  function boot() {
    const sess = store.getJSON("coc.session", null);
    if (sess && sess.token && sess.user) {
      state.token = sess.token;
      state.user = sess.user;
      App.restore();
      App.enterApp(false);
    } else {
      App.auth.show();
    }
  }
  boot();
})(window.App);
