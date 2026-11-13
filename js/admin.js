"use strict";
/* Admin screens. Every one of these is also enforced on the server, so a hidden button is never the only lock. */
(function (App) {
  const { $, $$, esc, icon, state, fmtDate } = App;
  const V = App.views;

  /* ================= saving and deleting with instant feedback ================= */
  App.saveRecord = async (sheet, id, data) => {
    const optimistic = () => {
      if (id) { const r = App.byId(sheet, id); if (r) Object.assign(r, data); }
      else state.data[sheet].push(Object.assign({ ID: "pending-" + Date.now() + Math.random().toString(36).slice(2, 6) }, data));
    };
    try {
      const res = await App.write(id ? "update" : "add", id ? { sheet: sheet, id: id, data: data } : { sheet: sheet, data: data }, optimistic);
      App.persist(); App.refreshView();
      if (res.queued) App.toast("No signal. Saved on this phone and will send when you're back online.");
      else await App.sync();
      return true;
    } catch (e) {
      App.toast(e.message, { error: true });
      await App.sync();
      return false;
    }
  };
  App.deleteRecord = async (sheet, id) => {
    try {
      const res = await App.write("delete", { sheet: sheet, id: id }, () => {
        state.data[sheet] = state.data[sheet].filter((r) => r.ID !== id);
        if (sheet === "Members") state.data.Attendance = state.data.Attendance.filter((a) => a.MemberID !== id);
      });
      App.persist(); App.refreshView();
      App.toast(res.queued ? "Deleted here. Will send when you're back online." : "Deleted.");
      if (!res.queued) await App.sync();
    } catch (e) { App.toast(e.message, { error: true }); await App.sync(); }
  };
  let syncTimer = null;
  const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => App.sync(), 2500); };

  /* ================= field definitions ================= */
  const MARITAL = ["Single", "Married", "Widowed", "Divorced"];
  const FIELDS = {
    Members: [
      { k: "FirstName", l: "First name", req: 1 }, { k: "Surname", l: "Surname" },
      { k: "Gender", l: "Gender", sel: ["Male", "Female"] }, { k: "Phone", l: "Phone", t: "tel" },
      { k: "Address", l: "Address", wide: 1 }, { k: "Birthdate", l: "Birthday", t: "date" },
      { k: "Department", l: "Department", list: "deptList" }, { k: "JoinDate", l: "Date joined", t: "date" },
      { k: "Status", l: "Status", sel: ["Active", "Inactive", "Transferred"], noblank: 1 },
      { k: "Occupation", l: "Occupation" }, { k: "MaritalStatus", l: "Marital status", sel: MARITAL },
      { k: "EmergencyContactName", l: "Emergency contact" }, { k: "EmergencyContactPhone", l: "Emergency phone", t: "tel" },
      { k: "EmergencyContactRelationship", l: "Relationship to them" }
    ],
    Visitors: [
      { k: "FirstName", l: "First name", req: 1 }, { k: "Surname", l: "Surname" },
      { k: "Gender", l: "Gender", sel: ["Male", "Female"] }, { k: "Phone", l: "Phone", t: "tel" },
      { k: "Address", l: "Address", wide: 1 }, { k: "DateVisited", l: "Date visited", t: "date" },
      { k: "InvitedBy", l: "Invited by" }, { k: "FollowUpStatus", l: "Follow-up", sel: ["Not contacted", "Contacted", "Visited home", "Attending", "Not interested"], noblank: 1 },
      { k: "Notes", l: "Notes", area: 1, wide: 1 }
    ],
    Prospects: [
      { k: "FirstName", l: "First name", req: 1 }, { k: "Surname", l: "Surname" },
      { k: "Gender", l: "Gender", sel: ["Male", "Female"] }, { k: "Phone", l: "Phone", t: "tel" },
      { k: "Location", l: "Location", wide: 1 }, { k: "DateContacted", l: "Date contacted", t: "date" },
      { k: "ContactedBy", l: "Contacted by" }, { k: "InterestStatus", l: "Interest", sel: ["New", "Interested", "Following up", "Not interested"], noblank: 1 },
      { k: "Notes", l: "Notes", area: 1, wide: 1 }
    ],
    Congregations: [
      { k: "Name", l: "Name of church", req: 1, wide: 1 }, { k: "Address", l: "Address", wide: 1 },
      { k: "ContactPerson", l: "Contact person" }, { k: "ContactPhone", l: "Contact phone", t: "tel" },
      { k: "Notes", l: "Notes", area: 1, wide: 1 }
    ],
    Announcements: [
      { k: "Title", l: "Title", req: 1, wide: 1 }, { k: "Message", l: "Message", area: 1, wide: 1, rows: 7 },
      { k: "Active", l: "Show as a pop-up", sel: ["Yes", "No"], noblank: 1 }
    ]
  };
  const NOUN = { Members: "member", Visitors: "visitor", Prospects: "prospect", Congregations: "congregation", Announcements: "pop-up" };
  const DEFAULTS = {
    Members: () => ({ Status: "Active", JoinDate: App.localISO() }),
    Visitors: () => ({ DateVisited: App.localISO(), FollowUpStatus: "Not contacted" }),
    Prospects: () => ({ DateContacted: App.localISO(), InterestStatus: "New" }),
    Congregations: () => ({}), Announcements: () => ({ Active: "Yes" })
  };
  const recordTitle = (sheet, r) => (sheet === "Congregations" ? r.Name : sheet === "Announcements" ? r.Title : App.displayName(r));

  function fieldHTML(f, value) {
    const v = value || "";
    const common = ' name="' + f.k + '"' + (f.req ? " required" : "");
    let control;
    if (f.sel) {
      const opts = f.sel.slice();
      if (v && opts.indexOf(v) === -1) opts.push(v);
      control = "<select" + common + ">" + (f.noblank ? "" : '<option value="">Not set</option>') + opts.map((o) => "<option" + (o === v ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
    } else if (f.area) {
      control = "<textarea" + common + ' rows="' + (f.rows || 3) + '" maxlength="' + (f.k === "Message" ? 2000 : 1000) + '">' + esc(v) + "</textarea>";
    } else {
      control = "<input" + common + ' type="' + (f.t || "text") + '"' + (f.t === "date" ? ' max="2100-12-31"' : "") + ' maxlength="150"' + (f.t === "tel" ? ' inputmode="tel" autocomplete="off"' : "") + (f.list ? ' list="' + f.list + '"' : "") + ' value="' + esc(v) + '">';
    }
    return '<label class="field' + (f.wide ? " wide" : "") + '"><span>' + esc(f.l) + "</span>" + control + "</label>";
  }

  /* ================= generic detail and form sheets ================= */
  function infoRows(sheet, r) {
    return FIELDS[sheet].filter((f) => r[f.k] && f.k !== "Title" && f.k !== "Name" && f.k !== "FirstName" && f.k !== "Surname").map((f) => {
      let val = esc(r[f.k]);
      if (f.t === "date") val = esc(fmtDate(r[f.k]));
      else if (f.t === "tel" && App.telHref(r[f.k])) val = '<a href="' + esc(App.telHref(r[f.k])) + '">' + esc(r[f.k]) + "</a>";
      else if (f.area) val = '<span class="prose">' + App.paragraphs(r[f.k]) + "</span>";
      return "<dt>" + esc(f.l) + "</dt><dd>" + val + "</dd>";
    }).join("");
  }

  function memberStats(id) {
    const att = state.data.Attendance;
    const sundays = Array.from(new Set(att.filter((a) => a.ServiceType === "Sunday Service").map((a) => a.Date))).sort().reverse().slice(0, 8);
    const mine = att.filter((a) => a.MemberID === id);
    const mineDates = new Set(mine.map((a) => a.Date));
    const last = mine.reduce((m, a) => (a.Date > m ? a.Date : m), "");
    return { total: sundays.length, present: sundays.filter((d) => mineDates.has(d)).length, last: last };
  }

  const contactButtons = (phone) => {
    const tel = App.telHref(phone), wa = App.waHref(phone);
    return (tel ? '<a class="btn btn-line" href="' + esc(tel) + '">Call</a>' : "") + (wa ? '<a class="btn btn-line" href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>' : "");
  };

  App.actions["record-open"] = (el) => {
    const sheet = el.dataset.sheet, r = App.byId(sheet, el.dataset.id);
    if (!r) return;
    const admin = App.isAdmin();
    const pending = App.isPending(r.ID);
    let extra = "", actions = "";
    if (sheet === "Members" && admin) {
      const s = memberStats(r.ID);
      extra = '<p class="callout">' + (s.total ? "Present at <strong>" + s.present + " of the last " + s.total + "</strong> Sunday services." : "No Sunday attendance recorded yet.") + (s.last ? " Last seen " + esc(fmtDate(s.last)) + "." : "") + "</p>" +
        (pending ? "" : '<div class="inline-form"><select id="markService" aria-label="Service">' + App.CONFIG.SERVICES.map((x) => "<option>" + esc(x) + "</option>").join("") + '</select><button type="button" class="btn" data-act="mark-today" data-id="' + esc(r.ID) + '">Mark present today</button></div>');
    }
    if (sheet === "Congregations" && r.Address) {
      extra = '<p><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.Address) + '" target="_blank" rel="noopener noreferrer">Open the address in Maps</a></p>';
    }
    const phone = r.Phone || r.ContactPhone;
    const contact = contactButtons(phone);
    if (sheet === "Visitors" && admin && !pending) actions += '<button type="button" class="btn" data-act="record-move" data-from="Visitors" data-to="Members" data-id="' + esc(r.ID) + '">Make a member</button>';
    if (sheet === "Prospects" && admin && !pending) actions += '<button type="button" class="btn" data-act="record-move" data-from="Prospects" data-to="Visitors" data-id="' + esc(r.ID) + '">Move to visitors</button>';
    if (admin && !pending) actions += '<button type="button" class="btn btn-line" data-act="record-edit" data-sheet="' + sheet + '" data-id="' + esc(r.ID) + '">' + icon("edit", 16) + "<span>Edit</span></button>" +
      '<button type="button" class="btn btn-danger-line" data-act="record-delete" data-sheet="' + sheet + '" data-id="' + esc(r.ID) + '">Delete</button>';
    App.sheet.show(App.sheetHead(recordTitle(sheet, r)) +
      '<div class="sheet-pad">' + (pending ? '<p class="callout">This is still syncing. You can edit it once it has reached the server.</p>' : "") +
      '<dl class="info">' + infoRows(sheet, r) + "</dl>" + extra +
      (contact || actions ? '<div class="actions wrap">' + contact + actions + "</div>" : "") + "</div>");
  };

  function openForm(sheet, r) {
    const fields = FIELDS[sheet];
    const base = r || DEFAULTS[sheet]();
    const depts = Array.from(new Set(state.data.Members.map((m) => m.Department).filter(Boolean))).sort();
    App.sheet.show(App.sheetHead((r ? "Edit " : "Add a ") + NOUN[sheet]) +
      '<form data-form="record" class="sheet-pad form" data-sheet="' + sheet + '" data-id="' + esc(r ? r.ID : "") + '" novalidate>' +
      '<div class="form-grid">' + fields.map((f) => fieldHTML(f, base[f.k])).join("") + "</div>" +
      (sheet === "Members" ? '<datalist id="deptList">' + depts.map((d) => '<option value="' + esc(d) + '">').join("") + "</datalist>" : "") +
      '<p class="form-error" id="formError" role="alert"></p>' +
      '<div class="actions"><button type="submit" class="btn">' + (r ? "Save changes" : "Save") + "</button></div></form>");
  }
  App.actions["record-new"] = (el) => { if (App.isAdmin() && FIELDS[el.dataset.sheet]) openForm(el.dataset.sheet, null); };
  App.actions["record-edit"] = (el) => {
    const r = App.byId(el.dataset.sheet, el.dataset.id);
    if (!r || !App.isAdmin()) return;
    if (App.isPending(r.ID)) return App.toast("Still syncing. Try again in a moment.");
    openForm(el.dataset.sheet, r);
  };

  App.forms.record = async (form) => {
    const sheet = form.dataset.sheet, id = form.dataset.id || null;
    const err = $("#formError");
    const data = {};
    FIELDS[sheet].forEach((f) => { data[f.k] = form.elements[f.k].value.trim(); });
    if (sheet === "Congregations" && !data.Name) { err.textContent = "Enter the name of the church."; return; }
    if (sheet === "Announcements" && !data.Title) { err.textContent = "Give the pop-up a title."; return; }
    if (sheet !== "Congregations" && sheet !== "Announcements" && !data.FirstName && !data.Surname) { err.textContent = "Enter at least a first name or surname."; return; }
    if (data.Gender === undefined) delete data.Gender;
    if (sheet === "Announcements") data.Rev = String(Date.now());   // a new revision shows the pop-up again
    if (!id && (sheet === "Members" || sheet === "Visitors")) {
      const name = (data.FirstName + " " + data.Surname).trim().toLowerCase();
      if (state.data[sheet].some((r) => App.fullName(r).toLowerCase() === name)) {
        const go = await App.confirm({ title: "Possible duplicate", message: "Someone called " + data.FirstName + " " + data.Surname + " is already on this list. Add another anyway?", confirmLabel: "Add anyway" });
        if (!go) return;
      }
    }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const ok = await App.saveRecord(sheet, id, data);
    if (ok) { App.sheet.close(); App.toast("Saved."); } else btn.disabled = false;
  };

  App.actions["record-delete"] = async (el) => {
    const sheet = el.dataset.sheet, r = App.byId(sheet, el.dataset.id);
    if (!r) return;
    const extra = sheet === "Members" ? " Their attendance records will be removed too." : "";
    const ok = await App.confirm({ title: "Delete " + recordTitle(sheet, r) + "?", message: "This can't be undone." + extra, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    App.sheet.close();
    await App.deleteRecord(sheet, r.ID);
  };

  App.actions["record-move"] = async (el) => {
    const from = el.dataset.from, to = el.dataset.to, r = App.byId(from, el.dataset.id);
    if (!r) return;
    const ok = await App.confirm({ title: "Move " + App.fullName(r) + " to " + to.toLowerCase() + "?", message: "They will be taken off the " + from.toLowerCase() + " list.", confirmLabel: "Move" });
    if (!ok) return;
    App.sheet.close();
    try {
      const res = await App.write("move", { fromSheet: from, toSheet: to, id: r.ID }, () => {
        state.data[from] = state.data[from].filter((x) => x.ID !== r.ID);
        const copy = { ID: "pending-" + Date.now(), FirstName: r.FirstName, Surname: r.Surname, Gender: r.Gender, Phone: r.Phone, Address: r.Address || r.Location || "" };
        if (to === "Members") Object.assign(copy, { JoinDate: App.localISO(), Status: "Active" });
        else Object.assign(copy, { DateVisited: App.localISO(), FollowUpStatus: "Not contacted", Notes: r.Notes || "" });
        state.data[to].push(copy);
      });
      App.persist(); App.refreshView();
      App.toast(App.fullName(r) + " moved.");
      if (!res.queued) await App.sync();
    } catch (e) { App.toast(e.message, { error: true }); App.sync(); }
  };

  /* ================= attendance writes ================= */
  async function setPresent(memberId, date, service, present) {
    await App.write("setAttendance", { memberId: memberId, date: date, serviceType: service, present: present }, () => {
      const att = state.data.Attendance;
      const i = att.findIndex((a) => a.MemberID === memberId && a.Date === date && a.ServiceType === service);
      if (present && i < 0) att.push({ ID: "pending-" + Date.now() + Math.random().toString(36).slice(2, 5), MemberID: memberId, Date: date, ServiceType: service, MarkedBy: state.user.name });
      if (!present && i >= 0) att.splice(i, 1);
    });
    App.persist();
  }
  App.actions["mark-today"] = async (el) => {
    const service = $("#markService").value, id = el.dataset.id, m = App.byId("Members", id);
    el.disabled = true;
    try {
      await setPresent(id, App.localISO(), service, true);
      App.toast((m ? App.displayName(m) : "Member") + " marked present.", { actionLabel: "Undo", onAction: () => setPresent(id, App.localISO(), service, false).then(() => { App.refreshView(); syncSoon(); }) });
      App.sheet.close(); App.refreshView(); syncSoon();
    } catch (e) { App.toast(e.message, { error: true }); el.disabled = false; App.sync(); }
  };

  /* ================= member lists ================= */
  const L = { Members: { q: "", status: "Active", dept: "" }, Visitors: { q: "", status: "" }, Prospects: { q: "", status: "" } };
  const matches = (r, q) => !q || (App.fullName(r) + " " + (r.Phone || "") + " " + (r.Department || "")).toLowerCase().includes(q);

  function listFrame(sheet, title, sub, extraFilters) {
    return '<div class="page-head"><div><h2 class="page-title">' + title + '</h2><p class="muted" id="' + sheet + 'Count">' + sub + "</p></div>" +
      '<div class="head-actions">' + (sheet === "Members" ? '<button type="button" class="icon-btn lined" data-act="print" aria-label="Print list">' + icon("print", 20) + "</button>" : "") +
      '<button type="button" class="btn" data-act="record-new" data-sheet="' + sheet + '">' + icon("plus", 18) + "<span>Add</span></button></div></div>" +
      '<div class="toolbar"><input type="search" class="search" data-search="list-' + sheet + '" placeholder="Search by name or phone" aria-label="Search" value="' + esc(L[sheet].q) + '">' + (extraFilters || "") + '</div><div id="' + sheet + 'List" class="list"></div>';
  }
  const emptyMsg = (q, none, what) => '<p class="empty">' + (q ? "Nothing matches that search." : none) + "</p>";

  V.members = {
    title: "Members",
    render(el) {
      const depts = Array.from(new Set(state.data.Members.map((m) => m.Department).filter(Boolean))).sort();
      el.innerHTML = listFrame("Members", "Members", "",
        '<select class="filter" data-change="members-status" aria-label="Show"><option value="Active">Active</option><option value="">Everyone</option><option>Inactive</option><option>Transferred</option></select>' +
        '<select class="filter" data-change="members-dept" aria-label="Department"><option value="">All departments</option>' + depts.map((d) => "<option>" + esc(d) + "</option>").join("") + "</select>");
      el.querySelector('[data-change="members-status"]').value = L.Members.status;
      el.querySelector('[data-change="members-dept"]').value = L.Members.dept;
      this.fill();
    },
    fill() {
      const box = $("#MembersList");
      if (!box) return;
      const f = L.Members, q = f.q.toLowerCase();
      const rows = state.data.Members.filter((m) => {
        if (f.status === "Active" ? !App.isActiveMember(m) : f.status && m.Status !== f.status) return false;
        if (f.dept && m.Department !== f.dept) return false;
        return matches(m, q);
      }).sort((a, b) => App.fullName(a).localeCompare(App.fullName(b)));
      $("#MembersCount").textContent = rows.length + " of " + state.data.Members.length + " members";
      box.innerHTML = rows.length ? rows.map((m) => '<button type="button" class="row" data-act="record-open" data-sheet="Members" data-id="' + esc(m.ID) + '"><span class="row-main"><strong>' + esc(App.displayName(m)) + '</strong><span class="muted small">' + esc([m.Phone, m.Department].filter(Boolean).join("  |  ") || "No phone yet") + "</span></span>" +
        (App.isActiveMember(m) ? "" : '<span class="tag">' + esc(m.Status) + "</span>") + "</button>").join("") : emptyMsg(q, "No members yet. Tap Add to start the list.");
    }
  };
  App.searches["list-Members"] = App.debounce((v) => { L.Members.q = v; V.members.fill(); }, 120);
  App.changes["members-status"] = (el) => { L.Members.status = el.value; V.members.fill(); };
  App.changes["members-dept"] = (el) => { L.Members.dept = el.value; V.members.fill(); };

  function simpleList(sheet, title, sub, statusKey, statuses, dateKey, dateLabel) {
    return {
      title: title,
      render(el) {
        el.innerHTML = listFrame(sheet, title, sub, '<select class="filter" data-change="' + sheet + '-status" aria-label="Status"><option value="">All statuses</option>' + statuses.map((s) => "<option>" + esc(s) + "</option>").join("") + "</select>");
        el.querySelector("select.filter").value = L[sheet].status;
        this.fill();
      },
      fill() {
        const box = $("#" + sheet + "List");
        if (!box) return;
        const f = L[sheet], q = f.q.toLowerCase();
        const rows = state.data[sheet].filter((r) => (!f.status || r[statusKey] === f.status) && matches(r, q))
          .sort((a, b) => String(b[dateKey]).localeCompare(String(a[dateKey])));
        $("#" + sheet + "Count").textContent = rows.length + " of " + state.data[sheet].length + " " + title.toLowerCase();
        box.innerHTML = rows.length ? rows.map((r) => '<button type="button" class="row" data-act="record-open" data-sheet="' + sheet + '" data-id="' + esc(r.ID) + '"><span class="row-main"><strong>' + esc(App.displayName(r)) + '</strong><span class="muted small">' + esc([r[dateKey] ? dateLabel + " " + fmtDate(r[dateKey]) : "", r.Phone].filter(Boolean).join("  |  ")) + '</span></span><span class="tag">' + esc(r[statusKey] || "No status") + "</span></button>").join("")
          : emptyMsg(q, "Nobody here yet. Tap Add to record someone.");
      }
    };
  }
  V.visitors = simpleList("Visitors", "Visitors", "", "FollowUpStatus", ["Not contacted", "Contacted", "Visited home", "Attending", "Not interested"], "DateVisited", "Visited");
  V.prospects = simpleList("Prospects", "Prospects", "", "InterestStatus", ["New", "Interested", "Following up", "Not interested"], "DateContacted", "Contacted");
  App.searches["list-Visitors"] = App.debounce((v) => { L.Visitors.q = v; V.visitors.fill(); }, 120);
  App.searches["list-Prospects"] = App.debounce((v) => { L.Prospects.q = v; V.prospects.fill(); }, 120);
  App.changes["Visitors-status"] = (el) => { L.Visitors.status = el.value; V.visitors.fill(); };
  App.changes["Prospects-status"] = (el) => { L.Prospects.status = el.value; V.prospects.fill(); };
  App.actions.print = () => window.print();

  /* ================= attendance ================= */
  const A = { tab: "take", date: "", service: "Sunday Service", q: "", weeks: 2, missService: "Sunday Service", viewDate: "" };
  const serviceSelect = (id, val, change) => '<select id="' + id + '" class="filter" data-change="' + change + '" aria-label="Service">' + App.CONFIG.SERVICES.map((s) => "<option" + (s === val ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select>";

  V.attendance = {
    title: "Attendance",
    render(el) {
      A.date = A.date || App.localISO();
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Attendance</h2></div></div>' +
        '<div class="seg" role="tablist" aria-label="Attendance">' +
        [["take", "Take attendance"], ["missed", "Missed lately"], ["past", "Past services"]].map((t) => '<button type="button" role="tab" aria-selected="' + (A.tab === t[0]) + '" data-act="att-tab" data-tab="' + t[0] + '">' + t[1] + "</button>").join("") + "</div>" +
        '<div id="attBody"></div>';
      this.fill();
    },
    fill() {
      const body = $("#attBody");
      if (!body) return;
      if (A.tab === "take") takeTab(body);
      else if (A.tab === "missed") missedTab(body);
      else pastTab(body);
    }
  };
  App.actions["att-tab"] = (el) => { A.tab = el.dataset.tab; V.attendance.render($("#view")); };

  const presentIds = (date, service) => new Set(state.data.Attendance.filter((a) => a.Date === date && a.ServiceType === service).map((a) => a.MemberID));

  function takeTab(body) {
    if (!$("#takeList")) {
      body.innerHTML = '<div class="toolbar"><input type="date" class="filter" id="attDate" data-change="att-date" max="' + App.localISO() + '" value="' + esc(A.date) + '" aria-label="Date">' + serviceSelect("attService", A.service, "att-service") +
        '</div><div class="toolbar"><input type="search" class="search" data-search="att-search" placeholder="Find a member" aria-label="Find a member" value="' + esc(A.q) + '"></div>' +
        '<p class="tally" id="tally"></p><div id="takeList" class="list"></div>';
    }
    const here = presentIds(A.date, A.service), q = A.q.toLowerCase();
    const members = state.data.Members.filter(App.isActiveMember).sort((a, b) => App.fullName(a).localeCompare(App.fullName(b)));
    const shown = members.filter((m) => matches(m, q));
    $("#tally").innerHTML = "<strong>" + here.size + "</strong> present of " + members.length + " active members";
    $("#takeList").innerHTML = shown.length ? shown.map((m) => '<label class="row switch-row"><span class="row-main"><strong>' + esc(App.displayName(m)) + '</strong><span class="muted small">' + esc(m.Department || "") + '</span></span><input type="checkbox" class="switch" data-change="att-toggle" data-id="' + esc(m.ID) + '"' + (here.has(m.ID) ? " checked" : "") + (App.isPending(m.ID) ? " disabled" : "") + ' aria-label="Present"></label>').join("")
      : emptyMsg(q, "Add members first, then you can mark who is present.");
  }
  App.changes["att-date"] = (el) => { if (el.value) { A.date = el.value; takeTab($("#attBody")); } };
  App.changes["att-service"] = (el) => { A.service = el.value; takeTab($("#attBody")); };
  App.searches["att-search"] = App.debounce((v) => { A.q = v; takeTab($("#attBody")); }, 120);
  App.changes["att-toggle"] = async (el) => {
    const want = el.checked;
    el.disabled = true;
    try { await setPresent(el.dataset.id, A.date, A.service, want); syncSoon(); }
    catch (e) { el.checked = !want; App.toast(e.message, { error: true }); App.sync(); }
    el.disabled = false;
    const here = presentIds(A.date, A.service);
    const t = $("#tally");
    if (t) t.innerHTML = "<strong>" + here.size + "</strong> present of " + state.data.Members.filter(App.isActiveMember).length + " active members";
  };

  function missedTab(body) {
    if (!$("#missList")) {
      body.innerHTML = '<div class="toolbar"><label class="inline-label">Missed the last <select class="filter" data-change="miss-weeks">' + [1, 2, 3, 4, 6, 8].map((n) => "<option" + (n === A.weeks ? " selected" : "") + ">" + n + "</option>").join("") + "</select> services</label>" + serviceSelect("missService", A.missService, "miss-service") +
        '</div><p class="tally" id="missNote"></p><div id="missList" class="list"></div>';
    }
    const att = state.data.Attendance.filter((a) => a.ServiceType === A.missService);
    const dates = Array.from(new Set(att.map((a) => a.Date))).sort().reverse().slice(0, A.weeks);
    const note = $("#missNote"), box = $("#missList");
    if (!dates.length) { note.textContent = ""; box.innerHTML = '<p class="empty">No ' + esc(A.missService.toLowerCase()) + " attendance has been recorded yet.</p>"; return; }
    const seen = new Set(att.filter((a) => dates.indexOf(a.Date) > -1).map((a) => a.MemberID));
    const lastSeen = {};
    att.forEach((a) => { if (!lastSeen[a.MemberID] || a.Date > lastSeen[a.MemberID]) lastSeen[a.MemberID] = a.Date; });
    const missing = state.data.Members.filter((m) => App.isActiveMember(m) && !seen.has(m.ID)).sort((a, b) => App.fullName(a).localeCompare(App.fullName(b)));
    note.textContent = dates.length < A.weeks ? "Only " + dates.length + " service" + (dates.length > 1 ? "s have" : " has") + " been recorded so far. " + missing.length + " member" + (missing.length === 1 ? "" : "s") + " missed " + (dates.length > 1 ? "all of them." : "it.") : missing.length + " member" + (missing.length === 1 ? "" : "s") + " missed all of the last " + dates.length + ".";
    box.innerHTML = missing.length ? missing.map((m) => '<div class="row split"><button type="button" class="row-main plain" data-act="record-open" data-sheet="Members" data-id="' + esc(m.ID) + '"><strong>' + esc(App.displayName(m)) + '</strong><span class="muted small">' + (lastSeen[m.ID] ? "Last seen " + esc(fmtDate(lastSeen[m.ID])) : "Not seen in the records") + '</span></button><span class="mini-actions">' + contactButtons(m.Phone).replace(/class="btn btn-line"/g, 'class="btn btn-small btn-line"') + "</span></div>").join("")
      : '<p class="empty">Everyone has been present recently.</p>';
  }
  App.changes["miss-weeks"] = (el) => { A.weeks = +el.value; missedTab($("#attBody")); };
  App.changes["miss-service"] = (el) => { A.missService = el.value; missedTab($("#attBody")); };

  function pastTab(body) {
    const dates = Array.from(new Set(state.data.Attendance.filter((a) => a.ServiceType === A.service).map((a) => a.Date))).sort().reverse();
    if (!dates.includes(A.viewDate)) A.viewDate = dates[0] || "";
    body.innerHTML = '<div class="toolbar">' + serviceSelect("pastService", A.service, "past-service") +
      (dates.length ? '<select class="filter" data-change="past-date" aria-label="Date">' + dates.slice(0, 80).map((d) => "<option value=\"" + esc(d) + '"' + (d === A.viewDate ? " selected" : "") + ">" + esc(fmtDate(d, true)) + "</option>").join("") + "</select>" : "") + "</div>" +
      (dates.length ? "" : '<p class="empty">Nothing recorded for ' + esc(A.service.toLowerCase()) + " yet.</p>");
    if (!dates.length) return;
    const ids = presentIds(A.viewDate, A.service);
    const people = state.data.Members.filter((m) => ids.has(m.ID)).sort((a, b) => App.fullName(a).localeCompare(App.fullName(b)));
    const men = people.filter((p) => p.Gender === "Male").length, women = people.filter((p) => p.Gender === "Female").length;
    body.insertAdjacentHTML("beforeend", '<p class="tally"><strong>' + ids.size + "</strong> present" + (people.length ? " (" + men + " men, " + women + " women" + (people.length - men - women ? ", " + (people.length - men - women) + " not set" : "") + ")" : "") + '</p><div class="list">' +
      people.map((m) => '<button type="button" class="row" data-act="record-open" data-sheet="Members" data-id="' + esc(m.ID) + '"><span class="row-main"><strong>' + esc(App.displayName(m)) + '</strong><span class="muted small">' + esc(m.Department || "") + "</span></span></button>").join("") + "</div>");
  }
  App.changes["past-service"] = (el) => { A.service = el.value; A.viewDate = ""; pastTab($("#attBody")); };
  App.changes["past-date"] = (el) => { A.viewDate = el.value; pastTab($("#attBody")); };

  /* ================= pop-ups ================= */
  V.popups = {
    title: "Pop-ups",
    render(el) {
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Pop-ups</h2><p class="muted">Notices that appear for everyone when they open the app, and stay on the Home screen.</p></div>' +
        '<button type="button" class="btn" data-act="record-new" data-sheet="Announcements">' + icon("plus", 18) + "<span>New pop-up</span></button></div><div id=\"popList\" class=\"list\"></div>";
      this.fill();
    },
    fill() {
      const box = $("#popList");
      if (!box) return;
      const rows = state.data.Announcements;
      box.innerHTML = rows.length ? rows.map((a) => '<button type="button" class="row" data-act="record-edit" data-sheet="Announcements" data-id="' + esc(a.ID) + '"><span class="row-main"><strong>' + esc(a.Title) + '</strong><span class="muted small">' + esc((a.Message || "").slice(0, 90)) + '</span></span><span class="tag' + (a.Active === "No" ? "" : " tag-blue") + '">' + (a.Active === "No" ? "Hidden" : "Showing") + "</span></button>").join("")
        : '<p class="empty">No pop-ups yet.</p>';
    }
  };

  /* ================= reports ================= */
  const bars = (items, empty) => {
    if (!items.length) return '<p class="empty">' + empty + "</p>";
    const max = Math.max.apply(null, items.map((i) => i.v)) || 1;
    return '<div class="bars">' + items.map((i) => '<div class="bar-row"><span class="bar-label">' + esc(i.l) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + Math.max(2, Math.round(i.v / max * 100)) + '%"></span></span><span class="bar-val">' + i.v + "</span></div>").join("") + "</div>";
  };
  V.reports = {
    title: "Reports",
    render(el) {
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Reports</h2></div><div class="head-actions"><button type="button" class="btn btn-line" data-act="print">' + icon("print", 18) + '<span>Print</span></button><button type="button" class="btn" data-act="export-csv">' + icon("download", 18) + "<span>Export</span></button></div></div>" +
        '<div id="repBody"></div><section class="card"><div class="sec-head"><h3 class="sec">Recent activity</h3><button type="button" class="link-btn" data-act="audit-load">Show</button></div><div id="auditBox" class="audit"></div></section>';
      this.fill();
    },
    fill() {
      const box = $("#repBody");
      if (!box) return;
      const members = state.data.Members, active = members.filter(App.isActiveMember);
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
      const trend = [];
      for (let i = 0; i < 8; i++) {
        const iso = App.localISO(d);
        trend.unshift({ l: App.fmtDate(iso).replace(/ \d{4}$/, ""), v: new Set(state.data.Attendance.filter((a) => a.Date === iso && a.ServiceType === "Sunday Service").map((a) => a.MemberID)).size });
        d.setDate(d.getDate() - 7);
      }
      const count = (list, key, blank) => { const m = {}; list.forEach((r) => { const k = r[key] || blank; m[k] = (m[k] || 0) + 1; }); return Object.keys(m).map((k) => ({ l: k, v: m[k] })).sort((a, b) => b.v - a.v); };
      box.innerHTML = '<div class="stats">' + [[active.length, "active members"], [members.length - active.length, "inactive or moved"], [state.data.Visitors.length, "visitors"], [state.data.Prospects.length, "prospects"]].map((s) => '<div class="stat"><strong>' + s[0] + "</strong><span>" + s[1] + "</span></div>").join("") + "</div>" +
        '<section class="card"><h3 class="sec">Sunday attendance, last 8 weeks</h3>' + bars(trend, "No attendance yet.") + "</section>" +
        '<div class="two-col"><section class="card"><h3 class="sec">Men and women</h3>' + bars(count(active, "Gender", "Not set"), "No members yet.") + "</section>" +
        '<section class="card"><h3 class="sec">Departments</h3>' + bars(count(active, "Department", "None").slice(0, 8), "No members yet.") + "</section></div>" +
        '<div class="two-col"><section class="card"><h3 class="sec">Visitor follow-up</h3>' + bars(count(state.data.Visitors, "FollowUpStatus", "No status"), "No visitors yet.") + "</section>" +
        '<section class="card"><h3 class="sec">Prospect interest</h3>' + bars(count(state.data.Prospects, "InterestStatus", "No status"), "No prospects yet.") + "</section></div>";
    }
  };
  App.actions["audit-load"] = async (el) => {
    const box = $("#auditBox");
    box.innerHTML = '<p class="muted">Loading...</p>';
    try {
      const res = await App.api("getAudit");
      box.innerHTML = res.data.length ? '<ul class="plain log">' + res.data.map((r) => "<li><span><strong>" + esc(r.AdminName) + "</strong> " + esc(String(r.Action).toLowerCase()) + " " + esc(r.Details) + '</span><span class="muted small">' + esc(App.fmtDateTime(r.Timestamp)) + "</span></li>").join("") + "</ul>" : '<p class="empty">Nothing logged yet.</p>';
      el.hidden = true;
    } catch (e) { box.innerHTML = '<p class="form-error">' + esc(e.network ? "You need a connection to read the activity log." : e.message) + "</p>"; }
  };

  /* ---- CSV export: guards against spreadsheet formula tricks ---- */
  const csvCell = (v) => {
    let s = String(v === null || v === undefined ? "" : v);
    if (/^[=@\t\r]/.test(s) || /^[+\-]\D/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function download(name, rows, cols) {
    const text = "\uFEFF" + [cols.join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name + "-" + App.localISO() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  App.actions["export-csv"] = async () => {
    const byName = {};
    state.data.Members.forEach((m) => { byName[m.ID] = App.fullName(m); });
    const sets = [
      ["members", state.data.Members, ["FirstName", "Surname", "Gender", "Phone", "Address", "Birthdate", "Department", "JoinDate", "Status", "Occupation", "MaritalStatus", "EmergencyContactName", "EmergencyContactPhone", "EmergencyContactRelationship"]],
      ["visitors", state.data.Visitors, ["FirstName", "Surname", "Gender", "Phone", "Address", "DateVisited", "InvitedBy", "FollowUpStatus", "Notes"]],
      ["prospects", state.data.Prospects, ["FirstName", "Surname", "Gender", "Phone", "Location", "DateContacted", "ContactedBy", "InterestStatus", "Notes"]],
      ["attendance", state.data.Attendance.map((a) => Object.assign({ Member: byName[a.MemberID] || "(removed)" }, a)), ["Date", "ServiceType", "Member", "MarkedBy"]]
    ];
    for (const s of sets) { download(s[0], s[1], s[2]); await new Promise((r) => setTimeout(r, 400)); }
    App.toast("Four files are downloading. Allow multiple downloads if your browser asks.");
  };

  /* ================= accounts (owner only) ================= */
  let users = [], userQuery = "";
  V.accounts = {
    title: "Accounts",
    render(el) {
      el.innerHTML = '<div class="page-head"><div><h2 class="page-title">Accounts</h2><p class="muted" id="acctCount"></p></div><button type="button" class="btn btn-line" data-act="accounts-reload">' + icon("refresh", 18) + "<span>Refresh</span></button></div>" +
        '<p class="callout">Anyone can create an account and read the history, notices and blog. Only accounts you make admin can see or change member records.</p>' +
        '<div class="toolbar"><input type="search" class="search" data-search="accounts" placeholder="Search by name" aria-label="Search accounts"></div><div id="acctList" class="list"></div>';
      userQuery = "";
      this.load();
    },
    async load() {
      const box = $("#acctList");
      if (box) box.innerHTML = '<p class="empty">Loading accounts...</p>';
      try { users = (await App.api("listUsers")).data; this.fill(); }
      catch (e) { if (box) box.innerHTML = '<p class="empty">' + esc(e.network ? "You need a connection to manage accounts." : e.message) + "</p>"; }
    },
    fill() {
      const box = $("#acctList");
      if (!box) return;
      const q = userQuery.toLowerCase();
      const rows = users.filter((u) => !q || u.name.toLowerCase().includes(q)).sort((a, b) => (b.role === "owner") - (a.role === "owner") || (b.role === "admin") - (a.role === "admin") || a.name.localeCompare(b.name));
      $("#acctCount").textContent = users.length + " account" + (users.length === 1 ? "" : "s") + ", " + users.filter((u) => u.role === "admin" || u.role === "owner").length + " with admin access";
      box.innerHTML = rows.length ? rows.map((u) => '<button type="button" class="row" data-act="account-open" data-id="' + esc(u.id) + '"><span class="avatar">' + esc(App.initials(u.name)) + '</span><span class="row-main"><strong>' + esc(u.name) + '</strong><span class="muted small">' + (u.lastLogin ? "Last login " + esc(App.fmtDateTime(u.lastLogin)) : "Never logged in") + '</span></span>' +
        (u.status === "Disabled" ? '<span class="tag tag-red">Turned off</span>' : "") + '<span class="tag' + (u.role === "member" ? "" : " tag-blue") + '">' + esc(App.roleLabel(u.role)) + "</span></button>").join("") : '<p class="empty">No accounts match.</p>';
    }
  };
  App.searches.accounts = App.debounce((v) => { userQuery = v; V.accounts.fill(); }, 120);
  App.actions["accounts-reload"] = () => V.accounts.load();

  const userById = (id) => users.find((u) => u.id === id);
  function accountSheet(u) {
    const locked = u.role === "owner" || u.id === state.user.id;
    App.sheet.show(App.sheetHead(u.name) +
      '<div class="sheet-pad"><dl class="info"><dt>Role</dt><dd>' + esc(App.roleLabel(u.role)) + "</dd><dt>Status</dt><dd>" + (u.status === "Disabled" ? "Turned off" : "Active") + "</dd><dt>Joined</dt><dd>" + esc(App.fmtDateTime(u.created)) + "</dd><dt>Last login</dt><dd>" + esc(u.lastLogin ? App.fmtDateTime(u.lastLogin) : "Never") + "</dd></dl>" +
      (locked ? '<p class="callout">' + (u.role === "owner" ? "This is the owner account. It can't be changed from here." : "This is your own account. Change your passcode from your account menu.") + "</p>" :
        '<div class="stack"><button type="button" class="btn ' + (u.role === "admin" ? "btn-line" : "") + ' block" data-act="account-role" data-id="' + esc(u.id) + '" data-role="' + (u.role === "admin" ? "member" : "admin") + '">' + (u.role === "admin" ? "Remove admin access" : "Make an admin") + "</button>" +
        '<button type="button" class="btn btn-line block" data-act="account-reset" data-id="' + esc(u.id) + '">Set a new passcode</button>' +
        '<button type="button" class="btn btn-line block" data-act="account-status" data-id="' + esc(u.id) + '" data-status="' + (u.status === "Disabled" ? "Active" : "Disabled") + '">' + (u.status === "Disabled" ? "Turn this account back on" : "Turn this account off") + "</button>" +
        '<button type="button" class="btn btn-danger-line block" data-act="account-delete" data-id="' + esc(u.id) + '">Delete account</button></div>') + "</div>");
  }
  App.actions["account-open"] = (el) => { const u = userById(el.dataset.id); if (u) accountSheet(u); };

  async function ownerCall(action, payload, done) {
    try { await App.api(action, payload); await V.accounts.load(); if (done) done(); }
    catch (e) { App.toast(e.network ? "You need a connection for that." : e.message, { error: true }); }
  }
  App.actions["account-role"] = async (el) => {
    const u = userById(el.dataset.id), role = el.dataset.role;
    const ok = await App.confirm({ title: (role === "admin" ? "Make " : "Remove admin from ") + u.name + "?", message: role === "admin" ? "They will be able to see and change all member, visitor and attendance records." : "They will go back to reading history, notices and the blog only.", confirmLabel: role === "admin" ? "Make admin" : "Remove admin" });
    if (!ok) return;
    ownerCall("setRole", { userId: u.id, role: role }, () => { App.sheet.close(); App.toast(u.name + (role === "admin" ? " is now an admin." : " is no longer an admin.")); });
  };
  App.actions["account-status"] = async (el) => {
    const u = userById(el.dataset.id), status = el.dataset.status;
    const ok = await App.confirm({ title: (status === "Disabled" ? "Turn off " : "Turn on ") + u.name + "?", message: status === "Disabled" ? "They will be logged out everywhere and can't log in until you turn it back on." : "They will be able to log in again.", confirmLabel: status === "Disabled" ? "Turn off" : "Turn on", danger: status === "Disabled" });
    if (!ok) return;
    ownerCall("setStatus", { userId: u.id, status: status }, () => { App.sheet.close(); App.toast("Done."); });
  };
  App.actions["account-delete"] = async (el) => {
    const u = userById(el.dataset.id);
    const ok = await App.confirm({ title: "Delete " + u.name + "?", message: "The account is removed for good. They can create a new one if they need to.", confirmLabel: "Delete account", danger: true });
    if (!ok) return;
    ownerCall("deleteUser", { userId: u.id }, () => { App.sheet.close(); App.toast("Account deleted."); });
  };
  App.actions["account-reset"] = (el) => {
    const u = userById(el.dataset.id);
    App.sheet.show(App.sheetHead("New passcode for " + u.name) +
      '<form data-form="reset" class="sheet-pad form" data-id="' + esc(u.id) + '" novalidate>' +
      '<label class="field"><span>New passcode</span><input name="passcode" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="6" maxlength="64" required></label>' +
      '<p class="hint">Tell them this passcode in person or by call, and ask them to change it after they log in. It logs them out everywhere else.</p>' +
      '<p class="form-error" id="formError" role="alert"></p><div class="actions"><button type="submit" class="btn">Set passcode</button></div></form>');
  };
  App.forms.reset = async (form) => {
    const err = $("#formError"), pass = form.elements["passcode"].value;
    if (pass.length < 6) { err.textContent = "The passcode needs at least 6 characters."; return; }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try { await App.api("resetPasscode", { userId: form.dataset.id, passcode: pass }); App.sheet.close(); App.toast("Passcode set."); }
    catch (e) { err.textContent = e.network ? "You need a connection for that." : e.message; btn.disabled = false; }
  };
})(window.App);
