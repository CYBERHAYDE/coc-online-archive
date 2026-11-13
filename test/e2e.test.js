const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeEnv } = require("./gas-mock");

const ROOT = path.join(__dirname, "..");
const env = makeEnv();
let passed = 0, failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 4).join("\n       ")); }
}

function boot(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<script src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://example.org/coc/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  if (opts.storage) for (const k in opts.storage) w.localStorage.setItem(k, opts.storage[k]);
  w.fetch = (url, o) => {
    const body = JSON.parse(o.body);
    if (w.__offline) return Promise.reject(new TypeError("Failed to fetch"));
    const out = env.call(body.action, body);
    return Promise.resolve({ json: async () => out });
  };
  for (const f of ["core", "pwa", "auth", "views", "admin", "main"]) {
    w.eval(fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8"));
  }
  return w;
}
const q = (w, s) => w.document.querySelector(s);
const qa = (w, s) => Array.from(w.document.querySelectorAll(s));
function type(w, form, name, value) { form.elements[name].value = value; }
function submit(w, form) { form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); }
function click(w, el) { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); }
async function signup(w, name, pass) {
  click(w, q(w, '[data-mode="register"]'));
  const f = q(w, "form.auth-form");
  type(w, f, "name", name); type(w, f, "passcode", pass); type(w, f, "confirm", pass);
  submit(w, f);
  await sleep(250);
}
async function login(w, name, pass) {
  const f = q(w, "form.auth-form");
  type(w, f, "name", name); type(w, f, "passcode", pass);
  submit(w, f);
  await sleep(250);
}
async function confirmYes(w) { await sleep(20); click(w, q(w, "#dialogRoot [data-yes]")); await sleep(250); }
async function goto(w, route) { w.location.hash = "#/" + route; await sleep(60); }

(async () => {
  console.log("first visit and signing up");
  let w = boot();
  await t("new visitors land on the login screen with a download button", async () => {
    assert.ok(!q(w, "#authRoot").hidden);
    assert.ok(q(w, "#appRoot").hidden);
    assert.ok(q(w, ".auth-install [data-act=install]"), "install button missing");
    assert.ok(!q(w, ".auth-install").hidden, "install button hidden");
  });
  await t("bad sign-up input is caught before it reaches the server", async () => {
    click(w, q(w, '[data-mode="register"]'));
    const f = q(w, "form.auth-form");
    type(w, f, "name", "Ada"); type(w, f, "passcode", "abc"); type(w, f, "confirm", "abc"); submit(w, f);
    assert.match(q(w, "#authError").textContent, /6 characters/);
    type(w, f, "passcode", "Secret-77"); type(w, f, "confirm", "Secret-78"); submit(w, f);
    assert.match(q(w, "#authError").textContent, /don't match/);
  });
  await t("creating an account signs the member in on Home", async () => {
    await signup(w, "Ngozi Eze", "Secret-77");
    assert.ok(q(w, "#authRoot").hidden && !q(w, "#appRoot").hidden);
    assert.strictEqual(w.location.hash, "#/home");
    assert.match(q(w, ".greet").textContent, /Ngozi/);
    assert.ok(JSON.parse(w.localStorage.getItem("coc.session")).token);
  });
  await t("members get 4 tabs plus More, and no admin screens", async () => {
    const tabs = qa(w, ".tabbar .tab").map((e) => e.textContent.trim());
    assert.deepStrictEqual(tabs, ["Home", "Our history", "Bulletin", "Connect", "More"]);
    assert.strictEqual(qa(w, ".rail-link").map((e) => e.textContent.trim()).filter((x) => /Members|Attendance|Accounts|Reports/.test(x)).length, 0);
  });
  await t("typing an admin address does nothing for a member", async () => {
    for (const r of ["members", "accounts", "attendance", "reports"]) {
      await goto(w, r);
      assert.strictEqual(w.App.state.route, "home", r);
    }
  });
  await t("member bootstrap holds no member records in memory or storage", async () => {
    assert.strictEqual(w.App.state.data.Members.length, 0);
    assert.ok(!/Phone/.test(w.localStorage.getItem("coc.cache")));
  });
  await t("history and connect show empty states without edit buttons", async () => {
    await goto(w, "history");
    assert.match(q(w, "#timeline").textContent, /not been added/);
    assert.ok(!q(w, "[data-act=history-edit]"));
    await goto(w, "connect");
    assert.ok(!q(w, "[data-act=social-edit]"));
    assert.ok(q(w, ".link-row"), "built-in blog link missing");
  });
  await t("logging out clears the stored session and cache", async () => {
    click(w, q(w, "#avatarBtn")); await sleep(30);
    click(w, q(w, "[data-act=logout]")); await sleep(100);
    assert.ok(!q(w, "#authRoot").hidden);
    assert.strictEqual(w.localStorage.getItem("coc.session"), null);
    assert.strictEqual(w.localStorage.getItem("coc.cache"), null);
  });
  await t("wrong passcode shows a plain message; right one logs in", async () => {
    await login(w, "ngozi eze", "nope-nope");
    assert.match(q(w, "#authError").textContent, /don't match/);
    await login(w, "ngozi eze", "Secret-77");
    assert.ok(!q(w, "#appRoot").hidden);
  });

  console.log("owner and admin");
  env.call("register", { name: "Umoh Elijah", passcode: "Gr8ce-2024" });
  env.run('CONFIG.OWNER_NAME = "Umoh Elijah"; makeOwner()');
  w = boot();
  await login(w, "Umoh Elijah", "Gr8ce-2024");
  await t("owner sees Accounts and admin screens", async () => {
    assert.ok(qa(w, ".rail-link").some((e) => /Accounts/.test(e.textContent)));
    assert.deepStrictEqual(qa(w, ".tabbar .tab").map((e) => e.textContent.trim()), ["Home", "Members", "Attendance", "Our history", "More"]);
  });
  await t("owner promotes Ngozi to admin from the Accounts screen", async () => {
    await goto(w, "accounts"); await sleep(300);
    const row = qa(w, "#acctList .row").find((r) => /Ngozi Eze/.test(r.textContent));
    assert.ok(row, "Ngozi not listed");
    click(w, row); await sleep(30);
    click(w, q(w, "[data-act=account-role]"));
    await confirmYes(w);
    const users = env.call("listUsers", { token: w.App.state.token }).data;
    assert.strictEqual(users.find((u) => u.name === "Ngozi Eze").role, "admin");
  });

  w = boot();
  await login(w, "Ngozi Eze", "Secret-77");
  await t("the promoted admin now has the admin screens, but not Accounts", async () => {
    assert.ok(qa(w, ".rail-link").some((e) => /Members/.test(e.textContent)));
    assert.ok(!qa(w, ".rail-link").some((e) => /Accounts/.test(e.textContent)));
    await goto(w, "accounts");
    assert.strictEqual(w.App.state.route, "home");
  });
  await t("admin adds a member through the form, and hostile text stays text", async () => {
    await goto(w, "members");
    click(w, q(w, '[data-act=record-new]')); await sleep(30);
    const f = q(w, "form[data-form=record]");
    type(w, f, "FirstName", '<img src=x onerror="window.__pwned=1">'); type(w, f, "Surname", "O'Brien"); type(w, f, "Gender", "Male"); type(w, f, "Phone", "08031234567");
    submit(w, f); await sleep(400);
    assert.ok(!q(w, "#MembersList img"), "HTML was injected into the list");
    assert.ok(!w.__pwned);
    assert.match(q(w, "#MembersList").textContent, /<img src=x/);
    const rec = env.call("bootstrap", { token: w.App.state.token }).data.Members;
    assert.strictEqual(rec.length, 1);
    assert.strictEqual(rec[0].Surname, "O'Brien");
  });
  await t("opening a member with an apostrophe in the name works", async () => {
    click(w, q(w, "#MembersList .row")); await sleep(30);
    assert.match(q(w, "#sheetBody").textContent, /O'Brien/);
    assert.ok(q(w, 'a[href^="tel:"]') && q(w, 'a[href^="https://wa.me/234803"]'));
    click(w, q(w, '[data-act=sheet-close]')); await sleep(60);
  });
  await t("attendance toggle saves to the server once, and unsaves", async () => {
    await goto(w, "attendance"); await sleep(50);
    const box = q(w, "#takeList input.switch");
    box.checked = true; box.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(300);
    let att = env.call("bootstrap", { token: w.App.state.token }).data.Attendance;
    assert.strictEqual(att.length, 1);
    assert.strictEqual(att[0].Date, w.App.localISO());
    assert.match(q(w, "#tally").textContent, /1\s*present of 1/);
    q(w, "#takeList input.switch").checked = false;
    q(w, "#takeList input.switch").dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(300);
    att = env.call("bootstrap", { token: w.App.state.token }).data.Attendance;
    assert.strictEqual(att.length, 0);
  });
  await t("offline toggles are queued, then sent when the connection returns", async () => {
    w.__offline = true; w.App.state.online = false;
    const box = q(w, "#takeList input.switch");
    box.checked = true; box.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(100);
    assert.strictEqual(w.App.queueSize(), 1);
    assert.strictEqual(env.call("bootstrap", { token: w.App.state.token }).data.Attendance.length, 0);
    w.__offline = false; w.App.state.online = true;
    await w.App.flushQueue(); await sleep(200);
    assert.strictEqual(w.App.queueSize(), 0);
    assert.strictEqual(env.call("bootstrap", { token: w.App.state.token }).data.Attendance.length, 1);
  });
  await t("history section is added, shown, and reordered", async () => {
    await goto(w, "history");
    for (const [title, period] of [["Beginnings", "1962"], ["Growth", "1985"]]) {
      click(w, q(w, "[data-act=history-edit]")); await sleep(30);
      const f = q(w, "form[data-form=history]");
      type(w, f, "Title", title); type(w, f, "Period", period); type(w, f, "Body", "First paragraph.\n\nSecond paragraph."); submit(w, f); await sleep(400);
    }
    assert.deepStrictEqual(qa(w, ".timeline h3").map((e) => e.textContent), ["Beginnings", "Growth"]);
    assert.strictEqual(qa(w, ".timeline .prose p").length, 4);
    click(w, qa(w, "[data-act=sort-move][data-dir=up]")[1]); await sleep(400);
    assert.deepStrictEqual(qa(w, ".timeline h3").map((e) => e.textContent), ["Growth", "Beginnings"]);
  });
  await t("social link: a bare Instagram handle becomes a proper link", async () => {
    await goto(w, "connect");
    click(w, q(w, "[data-act=social-edit]")); await sleep(30);
    const f = q(w, "form[data-form=social]");
    type(w, f, "Platform", "Instagram"); type(w, f, "Label", "Our Instagram"); type(w, f, "URL", "@cocigbogbo"); submit(w, f); await sleep(400);
    const a = qa(w, "a.link-row").find((x) => /Our Instagram/.test(x.textContent));
    assert.strictEqual(a.getAttribute("href"), "https://instagram.com/cocigbogbo");
    assert.strictEqual(a.getAttribute("rel"), "noopener noreferrer");
  });
  await t("social link: javascript: links are refused", async () => {
    click(w, q(w, "[data-act=social-edit]")); await sleep(30);
    const f = q(w, "form[data-form=social]");
    type(w, f, "Platform", "Other"); type(w, f, "Label", "Bad"); type(w, f, "URL", "javascript:alert(1)"); submit(w, f); await sleep(100);
    assert.match(q(w, "#formError").textContent, /doesn't look like a link/);
    click(w, q(w, "[data-act=sheet-close]")); await sleep(60);
  });

  console.log("a plain member sees what the admin published");
  w = boot();
  await login(w, "Ngozi Eze", "Secret-77");
  const memberW = boot();
  await signup(memberW, "Plain Member", "Plain-Pass-9");
  await t("history and links reach members, member records do not", async () => {
    await goto(memberW, "history");
    assert.deepStrictEqual(qa(memberW, ".timeline h3").map((e) => e.textContent), ["Growth", "Beginnings"]);
    await goto(memberW, "connect");
    assert.ok(qa(memberW, "a.link-row").some((x) => /Our Instagram/.test(x.textContent)));
    assert.strictEqual(memberW.App.state.data.Members.length, 0);
    const direct = env.call("bootstrap", { token: memberW.App.state.token });
    assert.ok(!("Members" in direct.data));
  });
  await t("a disabled account is thrown out on its next request", async () => {
    const owner = env.call("login", { name: "Umoh Elijah", passcode: "Gr8ce-2024" });
    const id = env.call("listUsers", { token: owner.token }).data.find((u) => u.name === "Plain Member").id;
    env.call("setStatus", { token: owner.token, userId: id, status: "Disabled" });
    await memberW.App.sync(true); await sleep(100);
    assert.ok(!q(memberW, "#authRoot").hidden, "still logged in");
    assert.match(q(memberW, "#authError").textContent, /session ended/);
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
