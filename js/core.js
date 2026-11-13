"use strict";
/* Shared helpers: state, storage, server calls, offline queue, sheets and toasts. */
window.App = (function () {
  const CONFIG = {
    // Web app URL of the deployed Apps Script (Deploy > Manage deployments).
    API_URL: "https://script.google.com/macros/s/AKfycbz4gBgh_qKofWUqIH-EPUoO1uQ97FPvV-QaqbuDniZWIPnn1aisdOZHTfIC6SdQqQTx1A/exec",
    BLOG_URL: "https://cocigbogbo.blogspot.com/",
    APP_NAME: "COC Igbogbo",
    MOTTO: "Speak where the Bible speaks, and be silent where the Bible is silent.",
    SERVICES: ["Sunday Service", "Midweek Service", "Special Program"]
  };

  const state = {
    token: "",
    user: null,
    data: { Members: [], Attendance: [], Visitors: [], Prospects: [], Congregations: [], Announcements: [], History: [], SocialLinks: [] },
    online: navigator.onLine,
    inflight: 0,
    lastSync: null,
    route: "home"
  };

  const App = { CONFIG, state, actions: {}, forms: {}, searches: {}, changes: {}, views: {} };

  /* ---------- storage that never throws ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    getJSON(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    setJSON(k, v) { return store.set(k, JSON.stringify(v)); }
  };
  App.store = store;

  /* ---------- small helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  App.$ = $; App.$$ = $$;

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  App.esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"'`]/g, (c) => ESC[c]);

  App.localISO = (d) => {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  };
  App.parseISO = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };
  App.fmtDate = (s, long) => {
    const d = App.parseISO(s);
    if (!d) return "";
    return d.toLocaleDateString("en-GB", long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" });
  };
  App.fmtDateTime = (s) => {
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  App.fullName = (r) => ((r.FirstName || "") + " " + (r.Surname || "")).trim();
  App.displayName = (r) => {
    const n = App.fullName(r);
    if (!n) return "(no name)";
    return r.Gender === "Male" ? "Bro. " + n : r.Gender === "Female" ? "Sis. " + n : n;
  };
  App.initials = (name) => {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  };
  App.debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
  App.safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  App.digits = (p) => String(p || "").replace(/[^\d+]/g, "");
  App.telHref = (p) => { const d = App.digits(p); return d.replace(/\D/g, "").length >= 7 ? "tel:" + d : ""; };
  App.waHref = (p) => {
    let d = String(p || "").replace(/\D/g, "");
    if (d.length < 7) return "";
    if (d.charAt(0) === "0") d = "234" + d.slice(1);
    return "https://wa.me/" + d;
  };
  App.paragraphs = (text) => String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => "<p>" + App.esc(p).replace(/\n/g, "<br>") + "</p>").join("");
  App.greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
  App.isAdmin = () => !!state.user && (state.user.role === "admin" || state.user.role === "owner");
  App.isOwner = () => !!state.user && state.user.role === "owner";
  App.driveImg = (id, w) => "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w" + (w || 1200);
  App.byId = (sheet, id) => (state.data[sheet] || []).find((r) => String(r.ID) === String(id));
  App.isPending = (id) => String(id).indexOf("pending-") === 0;

  /* ---------- icons ---------- */
  const ICONS = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    history: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    bulletin: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    connect: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    members: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    attendance: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    visitors: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/>',
    prospects: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    popups: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    reports: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
    accounts: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    nearby: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
    chevron: '<path d="M9 18l6-6-6-6"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98"/><path d="M15.41 6.51l-6.82 3.98"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>'
  };
  App.icon = (name, size) => '<svg class="ico" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";

  /* ---------- toasts and confirm ---------- */
  App.toast = (message, opts) => {
    opts = opts || {};
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast" + (opts.error ? " toast-error" : "");
    const span = document.createElement("span");
    span.textContent = message;
    el.appendChild(span);
    if (opts.actionLabel) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = opts.actionLabel;
      b.addEventListener("click", () => { el.remove(); if (opts.onAction) opts.onAction(); });
      el.appendChild(b);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), opts.duration || (opts.error ? 6000 : 3500));
    return el;
  };

  App.confirm = (o) => new Promise((resolve) => {
    const root = $("#dialogRoot");
    const box = $(".dialog", root);
    box.innerHTML = '<h2 id="dialogTitle">' + App.esc(o.title) + "</h2>" +
      (o.message ? "<p>" + App.esc(o.message) + "</p>" : "") +
      '<div class="actions"><button type="button" class="btn btn-line" data-no>' + App.esc(o.cancelLabel || "Cancel") + "</button>" +
      '<button type="button" class="btn ' + (o.danger ? "btn-danger" : "") + '" data-yes>' + App.esc(o.confirmLabel || "Confirm") + "</button></div>";
    root.hidden = false;
    const prev = document.activeElement;
    const done = (v) => { root.hidden = true; document.removeEventListener("keydown", onKey, true); if (prev && prev.focus) prev.focus(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", onKey, true);
    $("[data-no]", box).addEventListener("click", () => done(false));
    $("[data-yes]", box).addEventListener("click", () => done(true));
    $(".sheet-backdrop", root).onclick = () => done(false);
    $(o.danger ? "[data-no]" : "[data-yes]", box).focus();
  });

  /* ---------- bottom sheet with back button support ---------- */
  const sheet = { open: false, pushed: false, expectPop: false, after: null, returnTo: null };
  App.sheet = {
    isOpen: () => sheet.open,
    show(html) {
      const root = $("#sheetRoot");
      $("#sheetBody").innerHTML = html;
      if (!sheet.open) {
        sheet.returnTo = document.activeElement;
        root.hidden = false;
        document.body.classList.add("no-scroll");
        try { history.pushState({ sheet: true }, ""); sheet.pushed = true; } catch (e) { sheet.pushed = false; }
        sheet.open = true;
      }
      const box = $(".sheet", root);
      box.scrollTop = 0;
      const first = $("[autofocus], input:not([type=hidden]):not([type=file]), select, textarea", box);
      (first || box).focus({ preventScroll: true });
    },
    close(after) {
      if (!sheet.open) { if (after) after(); return; }
      sheet.open = false;
      $("#sheetRoot").hidden = true;
      document.body.classList.remove("no-scroll");
      if (sheet.returnTo && sheet.returnTo.focus && document.contains(sheet.returnTo)) sheet.returnTo.focus({ preventScroll: true });
      if (sheet.pushed) {
        sheet.pushed = false;
        sheet.expectPop = true;
        sheet.after = after || null;
        history.back();
      } else if (after) after();
    },
    // Called from the popstate listener. Returns true when the event belonged to the sheet.
    handlePop() {
      if (sheet.expectPop) {
        sheet.expectPop = false;
        const fn = sheet.after; sheet.after = null;
        if (fn) fn();
        return true;
      }
      if (sheet.open) {
        sheet.open = false; sheet.pushed = false;
        $("#sheetRoot").hidden = true;
        document.body.classList.remove("no-scroll");
        return true;
      }
      return false;
    }
  };
  App.actions["sheet-close"] = () => App.sheet.close();
  App.sheetHead = (title) => '<div class="sheet-head"><h2 id="sheetTitle">' + App.esc(title) + '</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">' + App.icon("x") + "</button></div>";

  /* ---------- server calls ---------- */
  function netError(msg) { const e = new Error(msg || "offline"); e.network = true; return e; }

  App.api = async (action, payload, opts) => {
    opts = opts || {};
    const body = JSON.stringify(Object.assign({ action: action, token: state.token }, payload || {}));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
    let res;
    try {
      res = await fetch(CONFIG.API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: body, signal: ctrl.signal, redirect: "follow" });
    } catch (e) { clearTimeout(timer); throw netError(); }
    clearTimeout(timer);
    let json;
    try { json = await res.json(); } catch (e) { throw netError("The church server sent an unreadable reply."); }
    if (!json || json.success === false) {
      const err = new Error((json && json.error) || "That didn't work. Try again.");
      err.code = json && json.code;
      err.server = true;
      if (err.code === "AUTH" && state.token && !opts.keepSession && App.auth) App.auth.expired();
      throw err;
    }
    return json;
  };

  /* ---------- offline queue (admin edits made without signal) ---------- */
  const QUEUE_KEY = "coc.queue";
  const getQueue = () => store.getJSON(QUEUE_KEY, []);
  const saveQueue = (q) => store.setJSON(QUEUE_KEY, q);
  App.queueSize = () => getQueue().length;
  function enqueue(action, payload) { const q = getQueue(); q.push({ action: action, payload: payload, at: Date.now() }); saveQueue(q); App.updateSyncLabel(); }

  App.write = async (action, payload, optimistic) => {
    if (optimistic) optimistic();
    if (!state.online) { enqueue(action, payload); return { queued: true }; }
    state.inflight++;
    try { return await App.api(action, payload); }
    catch (e) { if (e.network) { enqueue(action, payload); return { queued: true }; } throw e; }
    finally { state.inflight--; }
  };

  let flushing = false;
  App.flushQueue = async () => {
    if (flushing || !state.token || !state.online) return;
    let q = getQueue();
    if (!q.length) return;
    flushing = true;
    App.setSync("Sending " + q.length + " saved change" + (q.length > 1 ? "s" : "") + "...");
    let rejected = 0;
    try {
      while (q.length) {
        const item = q[0];
        try { await App.api(item.action, item.payload); q.shift(); }
        catch (e) {
          if (e.network || e.code === "AUTH") break;
          rejected++; q.shift();   // the server refused it, retrying would never help
        }
        saveQueue(q);
      }
    } finally { flushing = false; saveQueue(q); }
    if (rejected) App.toast(rejected + " offline change" + (rejected > 1 ? "s were" : " was") + " refused by the server. Check the lists and redo them.", { error: true });
    if (!q.length) { await App.sync(); }
    else App.updateSyncLabel();
  };

  /* ---------- sync status ---------- */
  App.setSync = (msg) => { const el = $("#syncStatus"); if (el) el.textContent = msg; };
  App.updateSyncLabel = () => {
    const n = App.queueSize();
    if (n) App.setSync(n + " change" + (n > 1 ? "s" : "") + " waiting for signal");
    else if (!state.online) App.setSync("Offline");
    else if (state.lastSync) App.setSync("Updated " + new Date(state.lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    else App.setSync("");
  };

  /* ---------- cached copy of the last sync, so the app opens offline ---------- */
  App.persist = () => store.setJSON("coc.cache", { user: state.user, data: state.data, lastSync: state.lastSync });
  App.restore = () => {
    const c = store.getJSON("coc.cache", null);
    if (!c || !c.data) return false;
    Object.assign(state.data, c.data);
    state.lastSync = c.lastSync || null;
    return true;
  };

  let syncing = false;
  App.sync = async (manual) => {
    if (syncing || !state.token || !state.online) return;
    if (state.inflight > 0 || App.queueSize() > 0) { if (manual) App.flushQueue(); return; }
    syncing = true;
    if (manual) App.setSync("Updating...");
    try {
      const res = await App.api("bootstrap");
      if (state.inflight > 0) return;   // an edit started while we waited, keep the local copy
      const roleChanged = !state.user || state.user.role !== res.user.role;
      state.user = res.user;
      const fresh = { Members: [], Attendance: [], Visitors: [], Prospects: [], Congregations: [], Announcements: [], History: [], SocialLinks: [] };
      state.data = Object.assign(fresh, res.data);
      state.lastSync = Date.now();
      store.setJSON("coc.session", { token: state.token, user: state.user });
      App.persist();
      App.updateSyncLabel();
      if (App.onSynced) App.onSynced(roleChanged);
    } catch (e) {
      if (e.network) App.setSync("Offline, showing the last saved copy");
      else if (manual) App.toast(e.message, { error: true });
    } finally { syncing = false; }
  };

  window.addEventListener("online", () => { state.online = true; App.flushQueue().then(() => App.sync()); App.updateSyncLabel(); });
  window.addEventListener("offline", () => { state.online = false; App.updateSyncLabel(); });

  /* ---------- delegated events ---------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = App.actions[el.dataset.act];
    if (fn) { if (el.tagName !== "A") e.preventDefault(); fn(el, e); }
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("form[data-form]");
    if (!f) return;
    e.preventDefault();
    const fn = App.forms[f.dataset.form];
    if (fn) fn(f, e);
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.search && App.searches[t.dataset.search]) App.searches[t.dataset.search](t.value, t);
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.change && App.changes[t.dataset.change]) App.changes[t.dataset.change](t, e);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet.open && $("#dialogRoot").hidden) App.sheet.close();
  });
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.dataset.hideOnError !== undefined) t.hidden = true;
  }, true);

  return App;
})();
