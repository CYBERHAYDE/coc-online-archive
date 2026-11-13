const { makeEnv } = require("./gas-mock");
const assert = require("assert");
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const env = makeEnv();
const call = env.call;

console.log("accounts");
t("doGet exposes no data", () => {
  const out = JSON.parse(env.run("doGet()").content);
  assert.deepStrictEqual(Object.keys(out).sort(), ["ok", "service"]);
});
t("rejects unknown action and prototype tricks", () => {
  assert.strictEqual(call("nope").success, false);
  assert.strictEqual(call("constructor").success, false);
  assert.strictEqual(call("__proto__").success, false);
});
t("rejects weak passcodes", () => {
  for (const p of ["123456", "111111", "abcde", "234567", "987654", "password"]) {
    const r = call("register", { name: "Weak Person", passcode: p });
    assert.strictEqual(r.success, false, p);
  }
});
t("rejects formula and odd names", () => {
  for (const n of ["=HYPERLINK(1)", "+234", "<script>", "A", "x".repeat(60)]) {
    assert.strictEqual(call("register", { name: n, passcode: "Gr8ce-2024" }).success, false, n);
  }
});
let umoh, ada;
t("registers a member and returns a token", () => {
  umoh = call("register", { name: "  Umoh   Elijah ", passcode: "Gr8ce-2024" });
  assert.ok(umoh.success && umoh.token.length > 60);
  assert.strictEqual(umoh.user.role, "member");
  assert.strictEqual(umoh.user.name, "Umoh Elijah");
});
t("name uniqueness ignores case and spacing", () => {
  assert.strictEqual(call("register", { name: "umoh elijah", passcode: "Gr8ce-2024" }).success, false);
});
t("passcode is not stored in plain text", () => {
  const rows = JSON.stringify(env.sheets.Users.rows);
  assert.ok(!rows.includes("Gr8ce-2024"));
});
t("login works, wrong passcode fails, same message for unknown name", () => {
  assert.ok(call("login", { name: "Umoh Elijah", passcode: "Gr8ce-2024" }).success);
  const bad = call("login", { name: "Umoh Elijah", passcode: "wrong-pass" });
  const unknown = call("login", { name: "Nobody Here", passcode: "wrong-pass" });
  assert.strictEqual(bad.error, unknown.error);
});
t("locks after 5 wrong attempts, even for the right passcode", () => {
  for (let i = 0; i < 5; i++) call("login", { name: "Lock Test", passcode: "nope-nope" });
  call("register", { name: "Lock Test", passcode: "Right-Pass-1" });
  for (let i = 0; i < 5; i++) call("login", { name: "Lock Test", passcode: "bad-bad-bad" });
  const r = call("login", { name: "Lock Test", passcode: "Right-Pass-1" });
  assert.strictEqual(r.code, "RATE");
});

console.log("permissions");
ada = call("register", { name: "Ada Obi", passcode: "Ada-Pass-77" });
t("member bootstrap has church content but no member records", () => {
  const b = call("bootstrap", { token: umoh.token });
  assert.ok(b.success);
  assert.ok(b.data.History && b.data.SocialLinks && b.data.Announcements && b.data.Congregations);
  for (const k of ["Members", "Attendance", "Visitors", "Prospects"]) assert.ok(!(k in b.data), k + " leaked");
});
t("bad or missing tokens are rejected", () => {
  assert.strictEqual(call("bootstrap", {}).code, "AUTH");
  assert.strictEqual(call("bootstrap", { token: "x".repeat(80) }).code, "AUTH");
});
t("member is blocked from every admin and owner action", () => {
  const calls = [
    ["add", { sheet: "Members", data: { FirstName: "A" } }], ["update", { sheet: "Members", id: "1", data: {} }],
    ["delete", { sheet: "Members", id: "1" }], ["move", { fromSheet: "Visitors", toSheet: "Members", id: "1" }],
    ["setAttendance", { memberId: "1", date: "2026-01-01", serviceType: "Sunday Service" }],
    ["reorder", { sheet: "History", id: "1" }], ["getAudit", {}], ["uploadImage", { mime: "image/png", data: "AA" }],
    ["listUsers", {}], ["setRole", { userId: "1", role: "admin" }], ["setStatus", { userId: "1", status: "Disabled" }],
    ["resetPasscode", { userId: "1", passcode: "Abcdef1!" }], ["deleteUser", { userId: "1" }]
  ];
  for (const [a, p] of calls) {
    const r = call(a, Object.assign({ token: umoh.token }, p));
    assert.strictEqual(r.code, "FORBIDDEN", a + " -> " + JSON.stringify(r));
  }
});
t("users and sessions sheets cannot be touched through generic routes", () => {
  env.run("1"); // sanity
  const r = call("delete", { token: umoh.token, sheet: "Users", id: "x" });
  assert.ok(!r.success);
});

console.log("owner and admin");
t("makeOwner needs an existing account and sets the role", () => {
  env.run('CONFIG.OWNER_NAME = "Nobody Yet"');
  assert.throws(() => env.run("makeOwner()"));
  env.run('CONFIG.OWNER_NAME = "umoh elijah"');
  env.run("makeOwner()");
  const lg = call("login", { name: "Umoh Elijah", passcode: "Gr8ce-2024" });
  umoh = lg;
  assert.strictEqual(lg.user.role, "owner");
});
t("owner can list accounts without any secrets", () => {
  const r = call("listUsers", { token: umoh.token });
  assert.ok(r.success && r.data.length >= 3);
  const text = JSON.stringify(r);
  assert.ok(!/Salt|Hash|passcode/i.test(text.replace(/resetPasscode/g, "")));
});
let adaId;
t("owner makes Ada an admin, and it takes effect on her existing session", () => {
  adaId = call("listUsers", { token: umoh.token }).data.find(u => u.name === "Ada Obi").id;
  assert.strictEqual(call("add", { token: ada.token, sheet: "Members", data: { FirstName: "X" } }).code, "FORBIDDEN");
  assert.ok(call("setRole", { token: umoh.token, userId: adaId, role: "admin" }).success);
  assert.ok(call("add", { token: ada.token, sheet: "Members", data: { FirstName: "Ngozi", Surname: "Eze", Gender: "Female", Phone: "08012345678" } }).success);
});
t("owner cannot change self or another owner, and role values are checked", () => {
  const me = call("listUsers", { token: umoh.token }).data.find(u => u.name === "Umoh Elijah").id;
  assert.ok(!call("setRole", { token: umoh.token, userId: me, role: "member" }).success);
  assert.ok(!call("setRole", { token: umoh.token, userId: adaId, role: "owner" }).success);
  assert.ok(!call("deleteUser", { token: umoh.token, userId: me }).success);
});
t("admin cannot manage accounts", () => {
  assert.strictEqual(call("listUsers", { token: ada.token }).code, "FORBIDDEN");
  assert.strictEqual(call("setRole", { token: ada.token, userId: adaId, role: "member" }).code, "FORBIDDEN");
});
t("removing admin takes effect immediately", () => {
  call("setRole", { token: umoh.token, userId: adaId, role: "member" });
  assert.strictEqual(call("add", { token: ada.token, sheet: "Members", data: { FirstName: "Y" } }).code, "FORBIDDEN");
  call("setRole", { token: umoh.token, userId: adaId, role: "admin" });
});

console.log("records");
let memberId;
t("formula text is stored as plain text, not a formula", () => {
  const r = call("add", { token: ada.token, sheet: "Members", data: { FirstName: "=HYPERLINK(\"http://evil\",\"x\")", Surname: "Test" } });
  assert.ok(r.success);
  const sh = env.sheets.Members;
  const w = sh.written.filter(x => x.r > 1);
  assert.ok(w.length > 0 && w.every(x => x.fmt === "@"), "cells were not set to text before writing");
  call("delete", { token: ada.token, sheet: "Members", id: r.id });
});
t("validates input", () => {
  const bad = [
    { sheet: "Members", data: { FirstName: "A", Gender: "Other" } },
    { sheet: "Members", data: { FirstName: "A", Phone: "call me" } },
    { sheet: "Members", data: { FirstName: "A", Birthdate: "yesterday" } },
    { sheet: "Members", data: {} },
    { sheet: "SocialLinks", data: { Platform: "Facebook", Label: "FB", URL: "javascript:alert(1)" } },
    { sheet: "SocialLinks", data: { Platform: "Hacker", Label: "FB", URL: "https://x.com" } },
    { sheet: "History", data: { Title: "", Body: "x" } },
    { sheet: "History", data: { Title: "t", ImageID: "../../etc/passwd" } },
    { sheet: "Users", data: { Name: "x" } },
    { sheet: "Members", data: { FirstName: "x".repeat(500) } }
  ];
  bad.forEach(b => assert.strictEqual(call("add", Object.assign({ token: ada.token }, b)).success, false, JSON.stringify(b).slice(0, 60)));
});
t("add, list, update, attendance without duplicates, cascade delete", () => {
  memberId = call("add", { token: ada.token, sheet: "Members", data: { FirstName: "Chika", Surname: "Nwosu", Gender: "Female", Phone: "08098765432", Status: "Active" } }).id;
  const d = "2026-11-08";
  assert.ok(call("setAttendance", { token: ada.token, memberId, date: d, serviceType: "Sunday Service", present: true }).changed);
  assert.ok(!call("setAttendance", { token: ada.token, memberId, date: d, serviceType: "Sunday Service", present: true }).changed);
  let b = call("bootstrap", { token: ada.token });
  assert.strictEqual(b.data.Attendance.filter(a => a.MemberID === memberId).length, 1);
  assert.strictEqual(b.data.Attendance[0].MarkedBy, "Ada Obi");
  assert.ok(call("update", { token: ada.token, sheet: "Members", id: memberId, data: { Phone: "0803 000 1111" } }).success);
  assert.ok(call("setAttendance", { token: ada.token, memberId, date: d, serviceType: "Sunday Service", present: false }).changed);
  call("setAttendance", { token: ada.token, memberId, date: d, serviceType: "Midweek Service", present: true });
  assert.ok(call("delete", { token: ada.token, sheet: "Members", id: memberId }).success);
  b = call("bootstrap", { token: ada.token });
  assert.strictEqual(b.data.Attendance.length, 0, "orphan attendance left behind");
});
t("attendance rejects future dates, bad services, unknown members", () => {
  const m = call("add", { token: ada.token, sheet: "Members", data: { FirstName: "Temp" } }).id;
  assert.ok(!call("setAttendance", { token: ada.token, memberId: m, date: "2099-01-01", serviceType: "Sunday Service" }).success);
  assert.ok(!call("setAttendance", { token: ada.token, memberId: m, date: "2026-01-04", serviceType: "Party" }).success);
  assert.ok(!call("setAttendance", { token: ada.token, memberId: "nope", date: "2026-01-04", serviceType: "Sunday Service" }).success);
  call("delete", { token: ada.token, sheet: "Members", id: m });
});
t("moving a visitor keeps gender, phone and address", () => {
  const v = call("add", { token: ada.token, sheet: "Visitors", data: { FirstName: "Tunde", Surname: "Bello", Gender: "Male", Phone: "08011112222", Address: "12 Church Rd", Notes: "met at gate" } }).id;
  assert.ok(call("move", { token: ada.token, fromSheet: "Visitors", toSheet: "Members", id: v }).success);
  const b = call("bootstrap", { token: ada.token });
  const m = b.data.Members.find(x => x.FirstName === "Tunde");
  assert.ok(m && m.Gender === "Male" && m.Phone === "08011112222" && m.Address === "12 Church Rd" && m.Status === "Active" && m.JoinDate);
  assert.ok(!b.data.Visitors.find(x => x.FirstName === "Tunde"));
  assert.ok(!call("move", { token: ada.token, fromSheet: "Members", toSheet: "Visitors", id: m.ID }).success);
  const kept = env.sheets.Visitors.rows.some(r => r.includes("Tunde") && r.includes("Moved"));
  assert.ok(kept, "original visitor row should stay in the sheet marked Moved");
});
t("dates and phones from hand-edited sheet cells come back clean", () => {
  const sh = env.sheets.Members;
  const hdr = sh.rows[0];
  const row = [];
  row[hdr.indexOf("FirstName")] = "Hand"; row[hdr.indexOf("Surname")] = "Typed";
  row[hdr.indexOf("Phone")] = 8023456789;
  row[hdr.indexOf("Birthdate")] = new Date("2000-05-31T23:00:00Z");   // local midnight in Lagos on 1 June
  sh.rows.push(row);
  const b = call("bootstrap", { token: ada.token });
  const m = b.data.Members.find(x => x.FirstName === "Hand");
  assert.strictEqual(m.Phone, "08023456789");
  assert.strictEqual(m.Birthdate, "2000-06-01");
  assert.ok(m.ID && m.ID.length === 12, "row without ID was not given one");
});
t("only active pop-ups reach members; admins see all", () => {
  call("add", { token: ada.token, sheet: "Announcements", data: { Title: "Visible", Message: "m", Active: "Yes", Rev: "1" } });
  call("add", { token: ada.token, sheet: "Announcements", data: { Title: "Hidden", Message: "m", Active: "No", Rev: "1" } });
  assert.deepStrictEqual(call("bootstrap", { token: lg() }).data.Announcements.map(a => a.Title), ["Visible"]);
  assert.strictEqual(call("bootstrap", { token: ada.token }).data.Announcements.length, 2);
});
function lg() { return call("register", { name: "Plain Member " + Math.random().toString(36).slice(2, 7).replace(/\d/g, "x"), passcode: "Plain-Pass-9" }).token; }

console.log("history, links, photos");
t("history sections get sort numbers and can be reordered", () => {
  const a = call("add", { token: ada.token, sheet: "History", data: { Title: "Beginnings", Period: "1960", Body: "p1\n\np2" } }).id;
  const b = call("add", { token: ada.token, sheet: "History", data: { Title: "Growth", Period: "1985", Body: "x" } }).id;
  const c = call("add", { token: ada.token, sheet: "History", data: { Title: "Today", Period: "2026", Body: "y" } }).id;
  const order = () => call("bootstrap", { token: ada.token }).data.History.sort((x, y) => x.Sort - y.Sort).map(h => h.Title);
  assert.deepStrictEqual(order(), ["Beginnings", "Growth", "Today"]);
  call("reorder", { token: ada.token, sheet: "History", id: c, direction: "up" });
  assert.deepStrictEqual(order(), ["Beginnings", "Today", "Growth"]);
  call("reorder", { token: ada.token, sheet: "History", id: a, direction: "up" });   // already first, no change
  assert.deepStrictEqual(order(), ["Beginnings", "Today", "Growth"]);
  assert.strictEqual(call("bootstrap", { token: ada.token }).data.History.find(h => h.Title === "Beginnings").Body, "p1\n\np2");
});
t("social links accept https and reject everything else", () => {
  assert.ok(call("add", { token: ada.token, sheet: "SocialLinks", data: { Platform: "Facebook", Label: "Our page", URL: "https://facebook.com/cocigbogbo" } }).success);
  assert.ok(!call("add", { token: ada.token, sheet: "SocialLinks", data: { Platform: "Facebook", Label: "x", URL: "data:text/html,hi" } }).success);
});
t("photo upload checks type and content, and history can only use uploaded photos", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString("base64");
  const up = call("uploadImage", { token: ada.token, mime: "image/png", data: png });
  assert.ok(up.success && up.fileId);
  assert.ok(!call("uploadImage", { token: ada.token, mime: "image/png", data: Buffer.from("<html>not an image</html>").toString("base64") }).success);
  assert.ok(!call("uploadImage", { token: ada.token, mime: "text/html", data: png }).success);
  assert.ok(!call("add", { token: ada.token, sheet: "History", data: { Title: "Fake", ImageID: "someoneElsesFile123" } }).success);
  const h = call("add", { token: ada.token, sheet: "History", data: { Title: "With photo", ImageID: up.fileId } });
  assert.ok(h.success);
  call("delete", { token: ada.token, sheet: "History", id: h.id });
  assert.strictEqual(env.drive.files[up.fileId].trashed, true);
});

console.log("sessions");
t("changing a passcode logs out other devices but not this one", () => {
  const u = call("register", { name: "Sess Person", passcode: "First-Pass-1" });
  const other = call("login", { name: "Sess Person", passcode: "First-Pass-1" });
  assert.ok(!call("changePasscode", { token: u.token, current: "wrong", next: "Second-Pass-2" }).success);
  assert.ok(call("changePasscode", { token: u.token, current: "First-Pass-1", next: "Second-Pass-2" }).success);
  assert.ok(call("bootstrap", { token: u.token }).success);
  env.cacheStore.clear();   // force the sheet lookup instead of the cache
  assert.strictEqual(call("bootstrap", { token: other.token }).code, "AUTH");
  assert.ok(!call("login", { name: "Sess Person", passcode: "First-Pass-1" }).success);
  assert.ok(call("login", { name: "Sess Person", passcode: "Second-Pass-2" }).success);
});
t("logout kills the token", () => {
  const u = call("register", { name: "Leaver Person", passcode: "Leave-Pass-3" });
  assert.ok(call("logout", { token: u.token }).success);
  env.cacheStore.clear();
  assert.strictEqual(call("bootstrap", { token: u.token }).code, "AUTH");
});
t("disabling an account ends its sessions and blocks login; enabling restores it", () => {
  const u = call("register", { name: "Pausable Person", passcode: "Pause-Pass-4" });
  const id = call("listUsers", { token: umoh.token }).data.find(x => x.name === "Pausable Person").id;
  assert.ok(call("setStatus", { token: umoh.token, userId: id, status: "Disabled" }).success);
  assert.strictEqual(call("bootstrap", { token: u.token }).code, "AUTH");
  assert.strictEqual(call("login", { name: "Pausable Person", passcode: "Pause-Pass-4" }).code, "DISABLED");
  assert.ok(call("setStatus", { token: umoh.token, userId: id, status: "Active" }).success);
  assert.ok(call("login", { name: "Pausable Person", passcode: "Pause-Pass-4" }).success);
});
t("owner can reset a passcode and delete an account", () => {
  call("register", { name: "Forgetful Person", passcode: "Old-Pass-5" });
  const id = call("listUsers", { token: umoh.token }).data.find(x => x.name === "Forgetful Person").id;
  assert.ok(!call("resetPasscode", { token: umoh.token, userId: id, passcode: "111111" }).success);
  assert.ok(call("resetPasscode", { token: umoh.token, userId: id, passcode: "Fresh-Pass-6" }).success);
  assert.ok(call("login", { name: "Forgetful Person", passcode: "Fresh-Pass-6" }).success);
  assert.ok(call("deleteUser", { token: umoh.token, userId: id }).success);
  assert.ok(!call("login", { name: "Forgetful Person", passcode: "Fresh-Pass-6" }).success);
});
t("audit log records who did what, and members cannot read it", () => {
  const r = call("getAudit", { token: ada.token });
  assert.ok(r.success && r.data.length > 5);
  assert.ok(r.data.every(x => x.ID), "audit rows need an ID");
  assert.ok(r.data.some(x => x.AdminName === "Ada Obi" && x.Action === "Added"));
  assert.strictEqual(call("getAudit", { token: lg() }).code, "FORBIDDEN");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
