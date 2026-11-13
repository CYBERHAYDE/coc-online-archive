"use strict";
/* Screens everyone can see: Home, History, Bulletin, Connect, Nearby, plus the account sheet and pop-ups. */
(function (App) {
  const { $, $$, esc, icon, store, state, fmtDate, paragraphs, safeUrl } = App;
  const V = App.views;

  /* ================= blog feed ================= */
  const blog = { posts: store.getJSON("coc.blog", []), loadedAt: 0 };

  function parseFeed(json) {
    const entries = (json && json.feed && json.feed.entry) || [];
    const doc = (html) => new DOMParser().parseFromString(String(html || ""), "text/html");
    return entries.map((e) => {
      const link = ((e.link || []).find((l) => l.rel === "alternate") || {}).href || "";
      const raw = (e.content && e.content.$t) || (e.summary && e.summary.$t) || "";
      const text = doc(raw).body.textContent.replace(/\s+/g, " ").trim();
      const thumb = (e["media$thumbnail"] && e["media$thumbnail"].url) || "";
      return {
        title: (e.title && e.title.$t) || "Untitled post",
        link: safeUrl(link),
        date: (e.published && e.published.$t) || "",
        snippet: text.length > 190 ? text.slice(0, 187).trimEnd() + "..." : text,
        thumb: safeUrl(thumb).replace(/\/s\d+-c\//, "/s400-c/")
      };
    }).filter((p) => p.link);
  }

  function fetchBlog() {
    return new Promise((resolve, reject) => {
      const cb = "__blog" + Date.now() + Math.floor(Math.random() * 1e4);
      const s = document.createElement("script");
      let done = false;
      const end = () => { delete window[cb]; s.remove(); };
      window[cb] = (json) => { if (done) return; done = true; end(); resolve(parseFeed(json)); };
      s.onerror = () => { if (done) return; done = true; end(); reject(new Error("blog")); };
      setTimeout(() => { if (!done) { done = true; end(); reject(new Error("timeout")); } }, 9000);
      s.src = App.CONFIG.BLOG_URL + "feeds/posts/default?alt=json-in-script&max-results=12&callback=" + cb;
      document.head.appendChild(s);
    });
  }

  App.blog = {
    posts: () => blog.posts,
    async load(force) {
      if (!state.online) return blog.posts;
      if (!force && Date.now() - blog.loadedAt < 5 * 60 * 1000 && blog.posts.length) return blog.posts;
      try {
        blog.posts = await fetchBlog();
        blog.loadedAt = Date.now();
        store.setJSON("coc.blog", blog.posts);
      } catch (e) { /* keep what we had */ }
      return blog.posts;
    }
  };

  function postCard(p) {
    return '<a class="row post" href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">' +
      (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="" loading="lazy" data-hide-on-error>' : "") +
      '<span class="post-text"><strong>' + esc(p.title) + "</strong>" +
      '<span class="muted small">' + esc(fmtDate(p.date)) + "</span>" +
      (p.snippet ? '<span class="post-snip">' + esc(p.snippet) + "</span>" : "") + "</span></a>";
  }

  /* ================= birthdays ================= */
  const isActiveMember = (m) => !m.Status || /^active$/i.test(m.Status);
  App.isActiveMember = isActiveMember;
  App.upcomingBirthdays = (days) => {
    const today = App.parseISO(App.localISO());
    const out = [];
    state.data.Members.forEach((m) => {
      if (!isActiveMember(m)) return;
      const b = App.parseISO(m.Birthdate);
      if (!b) return;
      let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
      const diff = Math.round((next - today) / 86400000);
      if (diff <= days) out.push({ m: m, diff: diff, date: next });
    });
    return out.sort((a, b) => a.diff - b.diff);
  };
  const whenLabel = (d) => (d === 0 ? "Today" : d === 1 ? "Tomorrow" : "In " + d + " days");

  /* ================= home ================= */
  V.home = {
    title: "Home",
    render(el) {
      const first = state.user.name.split(" ")[0];
      el.innerHTML =
        '<section class="hello"><h2 class="greet">' + esc(App.greeting()) + ", " + esc(first) + '</h2><p class="motto">' + esc(App.CONFIG.MOTTO) + "</p></section>" +
        '<section class="card install-card" data-install hidden><div><strong>Keep COC Igbogbo on your phone</strong><p class="muted">Open it from your home screen like any other app.</p></div>' + App.installButton() + "</section>" +
        (App.isAdmin() ? '<section id="homeStats" class="stats"></section><section class="quick"><button type="button" class="btn" data-act="go" data-to="attendance">Take attendance</button><button type="button" class="btn btn-line" data-act="record-new" data-sheet="Visitors">Add a visitor</button></section>' : "") +
        '<section><h3 class="sec">Notices</h3><div id="homeNotices" class="list"></div></section>' +
        '<section><div class="sec-head"><h3 class="sec">From the blog</h3><button type="button" class="link-btn" data-act="go" data-to="bulletin">All posts</button></div><div id="homePosts" class="list"></div></section>' +
        (App.isAdmin() ? '<section><h3 class="sec">Birthdays in the next two weeks</h3><div id="homeBdays" class="list"></div></section>' : "");
      this.fill();
      App.pwa.refresh();
      const show = () => { const box = $("#homePosts"); if (box) box.innerHTML = blog.posts.length ? blog.posts.slice(0, 3).map(postCard).join("") : '<p class="empty">No posts to show yet.</p>'; };
      show();
      App.blog.load().then(show);
    },
    fill() {
      const notices = $("#homeNotices");
      if (!notices) return;
      const list = state.data.Announcements.filter((a) => a.Active !== "No");
      notices.innerHTML = list.length
        ? list.map((a) => '<article class="card notice"><h4>' + esc(a.Title) + "</h4>" + (a.Message ? '<div class="prose">' + paragraphs(a.Message) + "</div>" : "") + "</article>").join("")
        : '<p class="empty">No notices right now.</p>';
      if (!App.isAdmin()) return;
      const att = state.data.Attendance;
      const lastDate = att.reduce((mx, a) => (a.Date > mx ? a.Date : mx), "");
      const there = new Set(att.filter((a) => a.Date === lastDate).map((a) => a.MemberID));
      $("#homeStats").innerHTML =
        stat(state.data.Members.filter(isActiveMember).length, "active members") +
        stat(lastDate ? there.size : "-", lastDate ? "present on " + fmtDate(lastDate) : "no attendance yet") +
        stat(state.data.Visitors.length, "visitors") + stat(state.data.Prospects.length, "prospects");
      const b = App.upcomingBirthdays(14);
      $("#homeBdays").innerHTML = b.length
        ? b.map((x) => '<button type="button" class="row" data-act="record-open" data-sheet="Members" data-id="' + esc(x.m.ID) + '"><span class="row-main"><strong>' + esc(App.displayName(x.m)) + '</strong><span class="muted small">' + esc(x.date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })) + '</span></span><span class="tag' + (x.diff === 0 ? " tag-red" : "") + '">' + whenLabel(x.diff) + "</span></button>").join("")
        : '<p class="empty">No birthdays coming up.</p>';
    }
  };
  const stat = (n, label) => '<div class="stat"><strong>' + esc(n) + "</strong><span>" + esc(label) + "</span></div>";

  App.actions.go = (el) => App.go(el.dataset.to);

  /* ================= bulletin ================= */
  V.bulletin = {
    title: "Bulletin",
    render(el) {
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Bulletin</h2><p class="muted">The latest from the church blog.</p></div>' +
        '<button type="button" class="btn btn-line" data-act="blog-refresh">' + icon("refresh", 18) + "<span>Refresh</span></button></div>" +
        '<div id="posts" class="list"></div>' +
        '<p class="foot-link"><a href="' + esc(App.CONFIG.BLOG_URL) + '" target="_blank" rel="noopener noreferrer">Open the full blog</a></p>';
      const show = (loading) => {
        const box = $("#posts");
        if (!box) return;
        box.innerHTML = blog.posts.length ? blog.posts.map(postCard).join("") : '<p class="empty">' + (loading ? "Loading posts..." : "Couldn't load the blog. Check your connection and try again.") + "</p>";
      };
      show(true);
      App.blog.load(true).then(() => show(false));
    }
  };
  App.actions["blog-refresh"] = async () => { App.toast("Checking for new posts..."); await App.blog.load(true); if (state.route === "bulletin") V.bulletin.render($("#view")); };

  /* ================= history ================= */
  const sortedHistory = () => state.data.History.slice().sort((a, b) => (Number(a.Sort) || 0) - (Number(b.Sort) || 0));

  V.history = {
    title: "Our History",
    render(el) {
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Our history</h2><p class="muted">How the church at Igbogbo came to be, and where it has been.</p></div>' +
        (App.isAdmin() ? '<button type="button" class="btn" data-act="history-edit">' + icon("plus", 18) + "<span>Add a section</span></button>" : "") + "</div>" +
        '<div id="timeline"></div>';
      this.fill();
    },
    fill() {
      const box = $("#timeline");
      if (!box) return;
      const items = sortedHistory();
      if (!items.length) {
        box.innerHTML = '<p class="empty">' + (App.isAdmin() ? "Nothing here yet. Add the first part of the church's story." : "The church history has not been added yet. Please check back soon.") + "</p>";
        return;
      }
      const admin = App.isAdmin();
      box.innerHTML = '<ol class="timeline">' + items.map((h, i) =>
        "<li><article>" +
        (h.Period ? '<p class="period">' + esc(h.Period) + "</p>" : "") +
        "<h3>" + esc(h.Title) + "</h3>" +
        (h.ImageID ? '<img class="hist-img" src="' + esc(App.driveImg(h.ImageID)) + '" alt="' + esc(h.Title) + '" loading="lazy" data-hide-on-error>' : "") +
        '<div class="prose">' + paragraphs(h.Body) + "</div>" +
        (admin ? '<div class="item-tools"><button type="button" class="btn btn-small btn-line" data-act="history-edit" data-id="' + esc(h.ID) + '">' + icon("edit", 16) + "<span>Edit</span></button>" +
          '<button type="button" class="icon-btn" data-act="sort-move" data-sheet="History" data-id="' + esc(h.ID) + '" data-dir="up" aria-label="Move up"' + (i === 0 ? " disabled" : "") + ">" + icon("up", 18) + "</button>" +
          '<button type="button" class="icon-btn" data-act="sort-move" data-sheet="History" data-id="' + esc(h.ID) + '" data-dir="down" aria-label="Move down"' + (i === items.length - 1 ? " disabled" : "") + ">" + icon("down", 18) + "</button></div>" : "") +
        "</article></li>").join("") + "</ol>";
    }
  };

  /* photo prep: shrink on the phone before sending, so uploads stay fast on mobile data */
  async function prepImage(file) {
    if (!/^image\//.test(file.type)) throw new Error("Pick a photo (JPEG, PNG or WebP).");
    if (file.size > 25 * 1024 * 1024) throw new Error("That photo is too big. Pick one under 25 MB.");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That photo couldn't be opened.")); i.src = url; });
      let dim = 1400, quality = 0.82;
      for (let attempt = 0; attempt < 5; attempt++) {
        const scale = Math.min(1, dim / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/jpeg", quality);
        const b64 = data.split(",")[1];
        if (b64.length < 2500000) return { b64: b64, preview: data };
        dim = Math.round(dim * 0.75); quality = Math.max(0.6, quality - 0.08);
      }
      throw new Error("That photo is still too large after shrinking. Try another.");
    } finally { URL.revokeObjectURL(url); }
  }

  let hform = null;
  App.actions["history-edit"] = (el) => {
    const id = el.dataset.id || "";
    const h = id ? App.byId("History", id) : null;
    if (id && !h) return;
    if (id && App.isPending(id)) return App.toast("This section is still syncing. Try again in a moment.");
    hform = { id: id, imageId: h ? h.ImageID || "" : "", fresh: null };
    App.sheet.show(App.sheetHead(h ? "Edit section" : "Add a section") +
      '<form data-form="history" class="sheet-pad form" novalidate>' +
      '<label class="field"><span>Period <em>(optional)</em></span><input name="Period" maxlength="150" placeholder="e.g. 1962, or Early years" value="' + esc(h ? h.Period : "") + '"></label>' +
      '<label class="field"><span>Title</span><input name="Title" maxlength="150" required value="' + esc(h ? h.Title : "") + '"></label>' +
      '<label class="field"><span>Story</span><textarea name="Body" rows="10" maxlength="12000" placeholder="Write or paste the text here. Leave a blank line between paragraphs.">' + esc(h ? h.Body : "") + "</textarea></label>" +
      '<div class="field"><span>Photo <em>(optional)</em></span><div id="histPhoto" class="photo-box"></div>' +
      '<input type="file" id="histFile" accept="image/jpeg,image/png,image/webp" data-change="history-photo" hidden></div>' +
      '<p class="form-error" id="formError" role="alert"></p>' +
      '<div class="actions">' + (h ? '<button type="button" class="btn btn-danger-line" data-act="history-delete" data-id="' + esc(h.ID) + '">Delete</button>' : "") +
      '<button type="submit" class="btn">Save section</button></div></form>');
    drawPhoto();
  };

  function drawPhoto() {
    const box = $("#histPhoto");
    if (!box || !hform) return;
    const src = hform.fresh ? hform.fresh.preview : hform.imageId ? App.driveImg(hform.imageId, 600) : "";
    box.innerHTML = (src ? '<img src="' + esc(src) + '" alt="Selected photo" data-hide-on-error>' : "") +
      '<div class="photo-actions"><button type="button" class="btn btn-small btn-line" data-act="history-pick">' + icon("image", 16) + "<span>" + (src ? "Change photo" : "Add a photo") + "</span></button>" +
      (src ? '<button type="button" class="btn btn-small btn-quiet" data-act="history-unphoto">Remove</button>' : "") + "</div>";
  }
  App.actions["history-pick"] = () => $("#histFile").click();
  App.actions["history-unphoto"] = () => { hform.fresh = null; hform.imageId = ""; drawPhoto(); };
  App.changes["history-photo"] = async (input) => {
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    try { hform.fresh = await prepImage(f); drawPhoto(); }
    catch (e) { const er = $("#formError"); if (er) er.textContent = e.message; }
  };

  App.forms.history = async (form) => {
    const err = $("#formError");
    const data = { Title: form.elements["Title"].value.trim(), Period: form.elements["Period"].value.trim(), Body: form.elements["Body"].value.trim() };
    if (!data.Title) { err.textContent = "Give this section a title."; return; }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      let imageId = hform.imageId;
      if (hform.fresh) {
        if (!state.online) throw new Error("Photos need a connection. Save the text now and add the photo later.");
        btn.textContent = "Uploading photo...";
        const up = await App.api("uploadImage", { mime: "image/jpeg", data: hform.fresh.b64 }, { timeout: 90000 });
        imageId = up.fileId;
      }
      data.ImageID = imageId;
      if (!hform.id) {
        const max = state.data.History.reduce((m, r) => Math.max(m, Number(r.Sort) || 0), 0);
        data.Sort = String(max + 1);
      }
      const ok = await App.saveRecord("History", hform.id || null, data);
      if (ok) { App.sheet.close(); App.toast("Saved."); }
      else { btn.disabled = false; btn.textContent = "Save section"; }
    } catch (e) {
      err.textContent = e.network ? "Couldn't reach the server. Check your connection." : e.message;
      btn.disabled = false; btn.textContent = "Save section";
    }
  };
  App.actions["history-delete"] = async (el) => {
    const h = App.byId("History", el.dataset.id);
    if (!h) return;
    const ok = await App.confirm({ title: "Delete this section?", message: "\"" + h.Title + "\" and its photo will be removed for everyone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    App.sheet.close();
    await App.deleteRecord("History", h.ID);
  };

  /* shared by History and Connect */
  App.actions["sort-move"] = async (el) => {
    const sheetName = el.dataset.sheet, id = el.dataset.id, dir = el.dataset.dir;
    if (App.isPending(id)) return App.toast("Still syncing. Try again in a moment.");
    const list = state.data[sheetName].slice().sort((a, b) => (Number(a.Sort) || 0) - (Number(b.Sort) || 0));
    const at = list.findIndex((r) => r.ID === id);
    const to = at + (dir === "up" ? -1 : 1);
    if (at < 0 || to < 0 || to >= list.length) return;
    try {
      await App.write("reorder", { sheet: sheetName, id: id, direction: dir }, () => {
        const t = list[at]; list[at] = list[to]; list[to] = t;
        list.forEach((r, i) => { r.Sort = String(i + 1); });
      });
      App.persist(); App.refreshView();
      await App.sync();
    } catch (e) { App.toast(e.message, { error: true }); App.sync(); }
  };

  /* ================= connect (social pages) ================= */
  const PLATFORM = {
    Facebook: { c: "#1877F2", m: "f" }, Instagram: { c: "#C13584", m: "ig" }, YouTube: { c: "#D92D20", m: "yt" },
    WhatsApp: { c: "#1E9E52", m: "wa" }, X: { c: "#111111", m: "x" }, TikTok: { c: "#111111", m: "tt" },
    Telegram: { c: "#229ED9", m: "tg" }, Website: { c: "#12294A", m: "www" }, Other: { c: "#5C6B7D", m: "link" }
  };
  const tile = (p) => { const s = PLATFORM[p] || PLATFORM.Other; return '<span class="tile" style="background:' + s.c + '" aria-hidden="true">' + esc(s.m) + "</span>"; };
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch (e) { return ""; } };

  V.connect = {
    title: "Connect",
    render(el) {
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Connect with us</h2><p class="muted">Follow the church and stay in touch.</p></div>' +
        (App.isAdmin() ? '<button type="button" class="btn" data-act="social-edit">' + icon("plus", 18) + "<span>Add a page</span></button>" : "") + "</div>" +
        '<div id="links" class="list"></div>' +
        '<section class="card share-card"><div><strong>Know someone who should have this app?</strong><p class="muted">Send them the link so they can create an account.</p></div>' +
        '<button type="button" class="btn btn-line" data-act="share-app">' + icon("share", 18) + "<span>Share the app</span></button></section>";
      this.fill();
    },
    fill() {
      const box = $("#links");
      if (!box) return;
      const items = state.data.SocialLinks.slice().sort((a, b) => (Number(a.Sort) || 0) - (Number(b.Sort) || 0));
      const admin = App.isAdmin();
      let html = '<a class="row link-row" href="' + esc(App.CONFIG.BLOG_URL) + '" target="_blank" rel="noopener noreferrer">' + tile("Website") +
        '<span class="row-main"><strong>Church blog</strong><span class="muted small">' + esc(hostOf(App.CONFIG.BLOG_URL)) + "</span></span>" + icon("external", 18) + "</a>";
      items.forEach((s, i) => {
        const url = safeUrl(s.URL);
        html += '<div class="link-wrap">' +
          (url ? '<a class="row link-row" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' : '<div class="row link-row">') +
          tile(s.Platform) + '<span class="row-main"><strong>' + esc(s.Label || s.Platform) + '</strong><span class="muted small">' + esc(s.Platform) + (hostOf(url) ? ", " + esc(hostOf(url)) : "") + "</span></span>" + icon("external", 18) + (url ? "</a>" : "</div>") +
          (admin ? '<div class="item-tools tight"><button type="button" class="icon-btn" data-act="social-edit" data-id="' + esc(s.ID) + '" aria-label="Edit">' + icon("edit", 18) + "</button>" +
            '<button type="button" class="icon-btn" data-act="sort-move" data-sheet="SocialLinks" data-id="' + esc(s.ID) + '" data-dir="up" aria-label="Move up"' + (i === 0 ? " disabled" : "") + ">" + icon("up", 18) + "</button>" +
            '<button type="button" class="icon-btn" data-act="sort-move" data-sheet="SocialLinks" data-id="' + esc(s.ID) + '" data-dir="down" aria-label="Move down"' + (i === items.length - 1 ? " disabled" : "") + ">" + icon("down", 18) + "</button></div>" : "") + "</div>";
      });
      if (!items.length && admin) html += '<p class="empty">Add the church\'s Facebook, YouTube, WhatsApp and other pages here.</p>';
      box.innerHTML = html;
    }
  };

  App.actions["share-app"] = async () => {
    const url = location.origin + location.pathname;
    if (navigator.share) { try { await navigator.share({ title: "COC Igbogbo", text: "Church of Christ Igbogbo app", url: url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    App.actions["copy-link"]();
  };

  const PLACEHOLDER = { Facebook: "facebook.com/yourpage", Instagram: "@yourhandle or instagram.com/yourhandle", YouTube: "youtube.com/@yourchannel", WhatsApp: "0803 123 4567, or a group invite link", X: "@yourhandle", TikTok: "@yourhandle", Telegram: "t.me/yourchannel", Website: "yourwebsite.org", Other: "https://..." };
  App.actions["social-edit"] = (el) => {
    const id = el.dataset.id || "";
    const s = id ? App.byId("SocialLinks", id) : null;
    if (id && App.isPending(id)) return App.toast("This link is still syncing. Try again in a moment.");
    const plat = s ? s.Platform : "Facebook";
    App.sheet.show(App.sheetHead(s ? "Edit page" : "Add a page") +
      '<form data-form="social" class="sheet-pad form" data-id="' + esc(id) + '" novalidate>' +
      '<label class="field"><span>Platform</span><select name="Platform" data-change="social-platform">' + Object.keys(PLATFORM).map((p) => '<option' + (p === plat ? " selected" : "") + ">" + p + "</option>").join("") + "</select></label>" +
      '<label class="field"><span>Name shown in the app</span><input name="Label" maxlength="60" required placeholder="e.g. COC Igbogbo on Facebook" value="' + esc(s ? s.Label : "") + '"></label>' +
      '<label class="field"><span>Link</span><input name="URL" maxlength="500" required autocapitalize="none" spellcheck="false" placeholder="' + esc(PLACEHOLDER[plat]) + '" value="' + esc(s ? s.URL : "") + '"></label>' +
      '<p class="hint">You can paste the page address, an @handle, or for WhatsApp just the phone number.</p>' +
      '<p class="form-error" id="formError" role="alert"></p>' +
      '<div class="actions">' + (s ? '<button type="button" class="btn btn-danger-line" data-act="social-delete" data-id="' + esc(s.ID) + '">Delete</button>' : "") + '<button type="submit" class="btn">Save</button></div></form>');
  };
  App.changes["social-platform"] = (sel) => {
    const f = sel.form;
    f.elements["URL"].placeholder = PLACEHOLDER[sel.value] || "";
    if (!f.elements["Label"].value.trim() || Object.keys(PLATFORM).some((p) => f.elements["Label"].value.trim() === "COC Igbogbo on " + p)) f.elements["Label"].value = sel.value === "Website" || sel.value === "Other" ? "" : "COC Igbogbo on " + sel.value;
  };
  function normalizeLink(platform, raw) {
    let v = String(raw || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (platform === "WhatsApp" && /^[\d\s+()\-]+$/.test(v)) return App.waHref(v);
    const handle = v.replace(/^@/, "");
    if (/^@?[A-Za-z0-9_.]+$/.test(v)) {
      if (platform === "Instagram") return "https://instagram.com/" + handle;
      if (platform === "X") return "https://x.com/" + handle;
      if (platform === "TikTok") return "https://tiktok.com/@" + handle;
      if (platform === "YouTube") return "https://youtube.com/@" + handle;
      if (platform === "Telegram") return "https://t.me/" + handle;
    }
    if (/^[^\s]+\.[^\s]{2,}/.test(v)) return "https://" + v.replace(/^\/+/, "");
    return v;
  }
  App.forms.social = async (form) => {
    const err = $("#formError");
    const data = { Platform: form.elements["Platform"].value, Label: form.elements["Label"].value.trim(), URL: normalizeLink(form.elements["Platform"].value, form.elements["URL"].value) };
    if (!data.Label) { err.textContent = "Give the page a name."; return; }
    if (!safeUrl(data.URL)) { err.textContent = "That doesn't look like a link. Paste the page address."; return; }
    if (!form.dataset.id) data.Sort = String(state.data.SocialLinks.reduce((m, r) => Math.max(m, Number(r.Sort) || 0), 0) + 1);
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const ok = await App.saveRecord("SocialLinks", form.dataset.id || null, data);
    if (ok) { App.sheet.close(); App.toast("Saved."); } else btn.disabled = false;
  };
  App.actions["social-delete"] = async (el) => {
    const s = App.byId("SocialLinks", el.dataset.id);
    if (!s) return;
    const ok = await App.confirm({ title: "Remove this page?", message: "\"" + s.Label + "\" will disappear from the Connect tab.", confirmLabel: "Remove", danger: true });
    if (!ok) return;
    App.sheet.close();
    await App.deleteRecord("SocialLinks", s.ID);
  };

  /* ================= nearby congregations ================= */
  let nearbyQuery = "";
  V.nearby = {
    title: "Nearby churches",
    render(el) {
      nearbyQuery = "";
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Nearby churches</h2><p class="muted">Other congregations you can visit or call.</p></div>' +
        (App.isAdmin() ? '<button type="button" class="btn" data-act="record-new" data-sheet="Congregations">' + icon("plus", 18) + "<span>Add</span></button>" : "") + "</div>" +
        '<div class="toolbar"><input type="search" class="search" data-search="nearby" placeholder="Search by name or place" aria-label="Search churches"></div><div id="nearbyList" class="list"></div>';
      this.fill();
    },
    fill() {
      const box = $("#nearbyList");
      if (!box) return;
      const q = nearbyQuery.toLowerCase();
      const rows = state.data.Congregations.filter((c) => !q || (c.Name + " " + c.Address).toLowerCase().includes(q))
        .sort((a, b) => a.Name.localeCompare(b.Name));
      box.innerHTML = rows.length ? rows.map((c) => '<button type="button" class="row" data-act="record-open" data-sheet="Congregations" data-id="' + esc(c.ID) + '"><span class="row-main"><strong>' + esc(c.Name) + '</strong><span class="muted small">' + esc(c.Address || "No address yet") + "</span></span>" + icon("chevron", 18) + "</button>").join("")
        : '<p class="empty">' + (q ? "Nothing matches that search." : "No congregations have been added yet.") + "</p>";
    }
  };
  App.searches.nearby = App.debounce((v) => { nearbyQuery = v; V.nearby.fill(); }, 120);

  /* ================= account sheet ================= */
  const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" };
  App.roleLabel = (r) => ROLE_LABEL[r] || "Member";
  App.actions.account = () => {
    const u = state.user;
    App.sheet.show(App.sheetHead("Your account") +
      '<div class="sheet-pad"><div class="me"><span class="avatar big">' + esc(App.initials(u.name)) + '</span><div><strong>' + esc(u.name) + '</strong><span class="tag">' + esc(App.roleLabel(u.role)) + "</span></div></div>" +
      '<div class="stack">' + App.installButton("btn-line block") +
      '<button type="button" class="btn btn-line block" data-act="sync-now">' + icon("refresh", 18) + "<span>Update now</span></button>" +
      '<button type="button" class="btn btn-line block" data-act="passcode-open">Change my passcode</button>' +
      '<button type="button" class="btn btn-danger-line block" data-act="logout">' + icon("logout", 18) + "<span>Log out</span></button></div>" +
      '<p class="muted small center">' + (state.lastSync ? "Last updated " + esc(App.fmtDateTime(state.lastSync)) : "") + "</p></div>");
    App.pwa.refresh();
  };
  App.actions["sync-now"] = async () => { App.sheet.close(); await App.flushQueue(); await App.sync(true); if (state.online) App.toast("Up to date."); };

  App.actions["passcode-open"] = () => {
    App.sheet.show(App.sheetHead("Change passcode") +
      '<form data-form="passcode" class="sheet-pad form" novalidate>' +
      '<label class="field"><span>Current passcode</span><input name="current" type="password" autocomplete="current-password" required></label>' +
      '<label class="field"><span>New passcode</span><input name="next" type="password" autocomplete="new-password" minlength="6" maxlength="64" required></label>' +
      '<label class="field"><span>New passcode again</span><input name="again" type="password" autocomplete="new-password" required></label>' +
      '<p class="hint">Changing it logs you out on any other phone or computer.</p>' +
      '<p class="form-error" id="formError" role="alert"></p>' +
      '<div class="actions"><button type="submit" class="btn">Change passcode</button></div></form>');
  };
  App.forms.passcode = async (form) => {
    const err = $("#formError");
    if (form.elements["next"].value.length < 6) { err.textContent = "The new passcode needs at least 6 characters."; return; }
    if (form.elements["next"].value !== form.elements["again"].value) { err.textContent = "The new passcodes don't match."; return; }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await App.api("changePasscode", { current: form.elements["current"].value, next: form.elements["next"].value });
      App.sheet.close();
      App.toast("Passcode changed.");
    } catch (e) { err.textContent = e.network ? "Couldn't reach the server." : e.message; btn.disabled = false; }
  };

  /* ================= pop-ups on opening ================= */
  let queue = [];
  function showNextPopup() {
    const p = queue.shift();
    if (!p) return;
    App.sheet.show(App.sheetHead(p.title) + '<div class="sheet-pad">' + p.html + '<div class="actions"><button type="button" class="btn" data-act="popup-next">' + esc(p.button || "Got it") + "</button></div></div>");
    if (p.seen) p.seen();
  }
  App.actions["popup-next"] = () => App.sheet.close(() => showNextPopup());

  App.runPopups = async () => {
    queue = [];
    const seen = store.getJSON("coc.seenNotices", {});
    state.data.Announcements.filter((a) => a.Active !== "No" && seen[a.ID] !== a.Rev).forEach((a) => {
      queue.push({ title: a.Title, html: '<div class="prose">' + paragraphs(a.Message) + "</div>", seen: () => { seen[a.ID] = a.Rev; store.setJSON("coc.seenNotices", seen); } });
    });
    if (App.isAdmin()) {
      const today = App.localISO();
      if (store.get("coc.bdayDay") !== today) {
        const b = App.upcomingBirthdays(7);
        if (b.length) {
          queue.push({ title: "Birthdays this week", html: '<ul class="plain">' + b.map((x) => "<li><strong>" + esc(App.displayName(x.m)) + "</strong> <span class=\"muted\">" + whenLabel(x.diff) + "</span></li>").join("") + "</ul>", seen: () => store.set("coc.bdayDay", today) });
        } else store.set("coc.bdayDay", today);
      }
    }
    const posts = await App.blog.load();
    const last = store.get("coc.blogLast");
    if (posts.length) {
      if (last && last !== posts[0].link) {
        const p = posts[0];
        queue.push({ title: "New on the church blog", html: "<p><strong>" + esc(p.title) + "</strong></p>" + (p.snippet ? "<p class=\"muted\">" + esc(p.snippet) + "</p>" : "") + '<p><a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">Read the post</a></p>', button: "Close" });
      }
      store.set("coc.blogLast", posts[0].link);
    }
    if (queue.length && !App.sheet.isOpen()) showNextPopup();
  };
})(window.App);
