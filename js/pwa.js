"use strict";
/* Home screen install. Android and desktop Chrome can show the real install prompt.
   iPhone and iPad have no such API, so those people get the Add to Home Screen steps. */
(function (App) {
  const { $, $$, esc, icon, store } = App;
  let deferred = null;

  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isInApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|TikTok|; wv\)/i.test(ua);
  const isIOSChrome = /CriOS/.test(ua);
  const isIOSOther = /FxiOS|EdgiOS|OPiOS/.test(ua);

  function standalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }
  function canOffer() {
    if (standalone()) return false;
    if (store.get("coc.installed") === "1" && !deferred) return false;
    return true;
  }
  function refresh() {
    const show = canOffer();
    $$("[data-install]").forEach((el) => { el.hidden = !show; });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    store.del("coc.installed");
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    store.set("coc.installed", "1");
    refresh();
    App.sheet.close();
    App.toast("COC Igbogbo is now on your home screen.");
  });
  if (window.matchMedia) {
    const mq = window.matchMedia("(display-mode: standalone)");
    if (mq.addEventListener) mq.addEventListener("change", refresh);
  }

  function steps(list) { return '<ol class="steps">' + list.map((s) => "<li>" + s + "</li>").join("") + "</ol>"; }

  function showHelp() {
    let body;
    if (isIOS && isInApp) {
      body = "<p>This link is open inside another app, and iPhones can't add to the home screen from there.</p>" +
        steps(["Tap the three dots or the compass icon in the corner and choose <strong>Open in Safari</strong>.", "Then come back to this page and tap <strong>Download app</strong> again."]);
    } else if (isIOS && isIOSOther) {
      body = "<p>On iPhone and iPad, only Safari can add the app to your home screen.</p>" +
        steps(["Open this same link in <strong>Safari</strong>.", "Tap the <strong>Share</strong> button.", "Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>."]);
    } else if (isIOS) {
      body = "<p>Apple doesn't let websites install themselves, so it takes three taps:</p>" +
        steps([isIOSChrome ? "Tap the <strong>Share</strong> button next to the address bar." : "Tap the <strong>Share</strong> button (the square with an arrow) at the bottom of Safari.",
          "Scroll down and tap <strong>Add to Home Screen</strong>.",
          "Check that the name says <strong>COC Igbogbo</strong>, then tap <strong>Add</strong>."]);
    } else if (isAndroid && isInApp) {
      body = "<p>This link is open inside another app.</p>" + steps(["Tap the menu and choose <strong>Open in Chrome</strong>.", "Then tap <strong>Download app</strong> again."]);
    } else if (isAndroid) {
      body = "<p>Your browser didn't offer the install box yet. You can still do it by hand:</p>" +
        steps(["Tap the browser menu (the three dots).", "Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.", "Confirm, and COC Igbogbo appears with the other apps on your phone."]);
    } else {
      body = "<p>Use the install option in your browser:</p>" +
        steps(["In Chrome or Edge, click the install icon at the right end of the address bar, or open the menu and choose <strong>Install COC Igbogbo</strong>.", "In Safari on a Mac, use <strong>File, Add to Dock</strong>."]);
    }
    App.sheet.show(App.sheetHead("Add COC Igbogbo to your home screen") +
      '<div class="sheet-pad prose">' + body +
      '<button type="button" class="btn btn-line block" data-act="copy-link">Copy page link</button></div>');
  }

  async function install() {
    if (deferred) {
      const ev = deferred;
      deferred = null;
      try {
        ev.prompt();
        const choice = await ev.userChoice;
        if (choice && choice.outcome === "accepted") App.toast("Installing COC Igbogbo...");
      } catch (e) { showHelp(); }
      refresh();
      return;
    }
    showHelp();
  }

  App.actions.install = install;
  App.actions["copy-link"] = async () => {
    const url = location.origin + location.pathname;
    try { await navigator.clipboard.writeText(url); App.toast("Link copied."); }
    catch (e) { App.toast(url, { duration: 8000 }); }
  };

  App.installButton = (cls) =>
    '<button type="button" class="btn ' + (cls || "") + '" data-act="install" data-install>' + icon("download", 20) + "<span>Download app</span></button>";
  App.pwa = { refresh: refresh, standalone: standalone };

  /* ---------- service worker ---------- */
  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded || !hadController) return;   // first visit: nothing to refresh
      reloaded = true;
      // A new version just took over. Reload now, unless someone is in the middle of a form.
      if (App.sheet.isOpen()) App.toast("The app was updated.", { actionLabel: "Reload", duration: 20000, onAction: () => location.reload() });
      else location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" }).then((reg) => {
        const check = () => reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });   // every time the app is opened or switched back to
        window.addEventListener("online", check);
        setInterval(check, 30 * 60 * 1000);
      }).catch(() => {});
    });
  }
})(window.App);
