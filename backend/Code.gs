/**
 * COC Igbogbo API
 *
 * Paste this whole file into the Apps Script project behind your Google Sheet,
 * replacing the old code, then deploy it as a new version of your web app.
 * Every request is checked here. Hiding a button in the app does not protect
 * anything, so each action below verifies the session and the role itself.
 */

const CONFIG = {
  // Leave empty when this script was created from inside the spreadsheet
  // (Extensions > Apps Script). If it is a standalone script, paste the
  // spreadsheet ID here (the long code in the sheet's address bar).
  SHEET_ID: "",

  // The exact name you registered in the app. Used once by makeOwner().
  OWNER_NAME: "",

  TIME_ZONE: "Africa/Lagos",
  SESSION_DAYS: 30,
  MAX_FAILED_LOGINS: 5,
  LOCKOUT_MINUTES: 15,
  HASH_ROUNDS: 300,
  MAX_SIGNUPS_PER_HOUR: 40,
  ATTENDANCE_DAYS: 800,
  UPLOAD_FOLDER_NAME: "COC Igbogbo uploads"
};

/* ------------------------------------------------------------------ */
/* Sheet layout. Missing sheets and columns are created automatically. */
/* ------------------------------------------------------------------ */

const SCHEMA = {
  Members: ["ID", "FirstName", "Surname", "Gender", "Phone", "Address", "Birthdate", "Department", "JoinDate", "Status", "Occupation", "MaritalStatus", "EmergencyContactName", "EmergencyContactPhone", "EmergencyContactRelationship"],
  Attendance: ["ID", "MemberID", "Date", "ServiceType", "MarkedBy"],
  Visitors: ["ID", "FirstName", "Surname", "Gender", "Phone", "Address", "DateVisited", "InvitedBy", "FollowUpStatus", "Notes"],
  Prospects: ["ID", "FirstName", "Surname", "Gender", "Phone", "Location", "DateContacted", "ContactedBy", "InterestStatus", "Notes"],
  Congregations: ["ID", "Name", "Address", "ContactPerson", "ContactPhone", "Notes"],
  Announcements: ["ID", "Title", "Message", "Active", "Rev"],
  History: ["ID", "Title", "Period", "Body", "ImageID", "Sort"],
  SocialLinks: ["ID", "Platform", "Label", "URL", "Sort"],
  AuditLog: ["Timestamp", "AdminName", "Action", "Sheet", "Details"],
  Users: ["ID", "Name", "NameKey", "Salt", "Hash", "Role", "Status", "Created", "LastLogin"],
  Sessions: ["TokenHash", "UserID", "Expires", "Created"]
};

const DATE_FIELDS = ["Birthdate", "JoinDate", "DateVisited", "DateContacted", "Date"];
const READ_FOR_ALL = ["Congregations", "Announcements", "History", "SocialLinks"];
const READ_FOR_ADMIN = ["Members", "Attendance", "Visitors", "Prospects"];
const EDITABLE = ["Members", "Visitors", "Prospects", "Congregations", "Announcements", "History", "SocialLinks"];
const SORTED_SHEETS = ["History", "SocialLinks"];
const SERVICES = ["Sunday Service", "Midweek Service", "Special Program"];
const PLATFORMS = ["Facebook", "Instagram", "YouTube", "WhatsApp", "X", "TikTok", "Telegram", "Website", "Other"];
const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

const MAX_LEN = {
  Body: 12000, Message: 2000, Notes: 1000, URL: 500, Address: 300, Title: 150, Phone: 40,
  EmergencyContactPhone: 40, ContactPhone: 40
};
const DEFAULT_MAX_LEN = 150;

/* ------------------------------ plumbing ------------------------------ */

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || "VALIDATION";
  }
}

let _book = null;
function book() {
  if (!_book) _book = CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return _book;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail(message, code) {
  return { success: false, error: message, code: code || "VALIDATION" };
}

function doGet() {
  // Nothing readable here on purpose. All data goes through authenticated POST requests.
  return json({ ok: true, service: "COC Igbogbo API" });
}

function doPost(e) {
  let req;
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 3000000) {
      return json(fail("That request was empty or too large."));
    }
    req = JSON.parse(e.postData.contents);
    if (!req || typeof req !== "object") throw new Error("bad");
  } catch (err) {
    return json(fail("That request could not be read."));
  }
  try {
    const handler = ROUTES[req.action];
    if (!handler || !Object.prototype.hasOwnProperty.call(ROUTES, req.action)) return json(fail("Unknown action."));
    const out = handler(req) || {};
    return json(Object.assign({ success: true }, out));
  } catch (err) {
    if (err instanceof ApiError) return json(fail(err.message, err.code));
    console.error(err && err.stack ? err.stack : err);
    return json(fail("Something went wrong on the server. Try again in a moment.", "SERVER"));
  }
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------ table helpers ------------------------------ */

function getTable(name) {
  const want = SCHEMA[name];
  if (!want) throw new Error("Unknown sheet " + name);
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    sh.setFrozenRows(1);
  }
  let headers = [];
  if (sh.getLastColumn() > 0) {
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    while (headers.length && headers[headers.length - 1] === "") headers.pop();
  }
  if (headers.length === 0) {
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    sh.setFrozenRows(1);
    headers = want.slice();
  } else {
    const missing = want.filter(function (h) { return headers.indexOf(h) === -1; });
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
    }
  }
  const col = {};
  headers.forEach(function (h, i) { col[h] = i; });
  return { name: name, sh: sh, headers: headers, col: col };
}

function cellOut(header, v) {
  if (v === null || v === undefined) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    if (DATE_FIELDS.indexOf(header) > -1) return Utilities.formatDate(v, CONFIG.TIME_ZONE, "yyyy-MM-dd");
    return v.toISOString();
  }
  if (typeof v === "number") {
    if (/Phone/.test(header)) {
      // Sheets drops the leading zero on numeric phone cells. Put it back.
      const s = String(Math.round(v));
      return s.length === 10 && /^[789]/.test(s) ? "0" + s : s;
    }
    return String(v);
  }
  return String(v);
}

function readRows(t, skipIdRepair) {
  const last = t.sh.getLastRow();
  if (last < 2) return [];
  const values = t.sh.getRange(2, 1, last - 1, t.headers.length).getValues();
  const out = [];
  const idCol = t.col.ID;
  const needIds = [];
  values.forEach(function (row, i) {
    if (row.every(function (c) { return c === "" || c === null; })) return;
    const obj = {};
    t.headers.forEach(function (h, c) { obj[h] = cellOut(h, row[c]); });
    if (idCol !== undefined && !obj.ID && !skipIdRepair) {
      obj.ID = newId();
      needIds.push({ rowNumber: i + 2, id: obj.ID });
    }
    out.push(obj);
  });
  if (needIds.length) {
    // Rows added by hand in the sheet have no ID yet. Give them one so they can be edited.
    withLock(function () {
      needIds.forEach(function (n) {
        const cell = t.sh.getRange(n.rowNumber, idCol + 1);
        if (!cell.getValue()) cell.setNumberFormat("@").setValue(n.id);
      });
    });
  }
  return out;
}

function appendRow(name, obj) {
  const t = getTable(name);
  const row = t.headers.map(function (h) { return obj[h] === undefined ? "" : obj[h]; });
  const range = t.sh.getRange(t.sh.getLastRow() + 1, 1, 1, t.headers.length);
  range.setNumberFormat("@");   // plain text, so "=..." can never run as a formula
  range.setValues([row]);
}

function findRowNumber(t, id) {
  const last = t.sh.getLastRow();
  if (last < 2 || t.col.ID === undefined) return -1;
  const ids = t.sh.getRange(2, t.col.ID + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function setCells(t, rowNumber, fields) {
  Object.keys(fields).forEach(function (h) {
    if (t.col[h] === undefined) return;
    const cell = t.sh.getRange(rowNumber, t.col[h] + 1);
    cell.setNumberFormat("@");
    cell.setValue(fields[h]);
  });
}

function newId() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}
function isoNow() {
  return new Date().toISOString();
}
function todayStr() {
  return Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "yyyy-MM-dd");
}

function audit(who, action, sheet, details) {
  try {
    appendRow("AuditLog", { Timestamp: isoNow(), AdminName: who, Action: action, Sheet: sheet, Details: String(details || "").slice(0, 200) });
  } catch (err) {
    console.error("audit failed", err);
  }
}

/* ------------------------------ crypto ------------------------------ */

function toHex(bytes) {
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}
function hmacHex(value, key) {
  return toHex(Utilities.computeHmacSha256Signature(value, key));
}
function newToken() {
  return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}
function pepper() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty("PEPPER");
  if (!p) {
    p = newToken();
    props.setProperty("PEPPER", p);
  }
  return p;
}
function hashPasscode(passcode, salt) {
  const key = pepper() + salt;
  let h = passcode + "|" + salt;
  for (let i = 0; i < CONFIG.HASH_ROUNDS; i++) h = hmacHex(h, key);
  return h;
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------ accounts ------------------------------ */

function normName(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}
function nameKey(name) {
  return normName(name).toLowerCase();
}
function validateName(name) {
  if (name.length < 2 || name.length > 40) throw new ApiError("Your name should be between 2 and 40 characters.");
  if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\-]*$/.test(name)) {
    throw new ApiError("Use letters, spaces, apostrophes and hyphens only in your name.");
  }
}
const WEAK_PASSCODES = ["123456", "1234567", "12345678", "123456789", "654321", "000000", "111111", "123123", "121212", "112233", "123321", "password", "passcode", "qwerty", "abcdef", "abc123", "iloveyou", "church", "jesus1"];
function validatePasscode(pass, name) {
  if (pass.length < 6) throw new ApiError("Your passcode needs at least 6 characters.");
  if (pass.length > 64) throw new ApiError("Your passcode is too long. Keep it under 64 characters.");
  if (/^(.)\1+$/.test(pass)) throw new ApiError("That passcode is too easy to guess. Pick something less repetitive.");
  if (/^\d+$/.test(pass)) {
    let up = true, down = true;
    for (let i = 1; i < pass.length; i++) {
      if (+pass[i] !== (+pass[i - 1] + 1) % 10) up = false;
      if (+pass[i] !== (+pass[i - 1] + 9) % 10) down = false;
    }
    if (up || down) throw new ApiError("That passcode is too easy to guess. Pick something less predictable.");
  }
  if (WEAK_PASSCODES.indexOf(pass.toLowerCase()) > -1) throw new ApiError("That passcode is too common. Pick another one.");
  if (name && pass.toLowerCase() === name.toLowerCase()) throw new ApiError("Your passcode can't be the same as your name.");
}

function userFromRow(t, row, rowNumber) {
  const u = { _row: rowNumber };
  t.headers.forEach(function (h, i) { u[h] = cellOut(h, row[i]); });
  return u;
}
function allUsers() {
  const t = getTable("Users");
  const last = t.sh.getLastRow();
  if (last < 2) return { t: t, users: [] };
  const values = t.sh.getRange(2, 1, last - 1, t.headers.length).getValues();
  const users = [];
  values.forEach(function (row, i) {
    if (row[t.col.ID]) users.push(userFromRow(t, row, i + 2));
  });
  return { t: t, users: users };
}
function findUserByKey(key) {
  const all = allUsers();
  for (let i = 0; i < all.users.length; i++) {
    if (all.users[i].NameKey === key) return all.users[i];
  }
  return null;
}
function findUserById(id) {
  const all = allUsers();
  for (let i = 0; i < all.users.length; i++) {
    if (all.users[i].ID === String(id)) return all.users[i];
  }
  return null;
}
function publicUser(u) {
  return { id: u.ID, name: u.Name, role: u.Role || "member" };
}
function dropUserCache(id) {
  CacheService.getScriptCache().remove("u:" + id);
}
function cachedUser(id) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("u:" + id);
  if (hit) return JSON.parse(hit);
  const u = findUserById(id);
  if (!u) return null;
  const slim = { ID: u.ID, Name: u.Name, Role: u.Role || "member", Status: u.Status || "Active" };
  cache.put("u:" + id, JSON.stringify(slim), 300);
  return slim;
}

function patchUser(id, fields) {
  // Call inside withLock. Finds the row again so a delete elsewhere cannot shift it.
  const t = getTable("Users");
  const rowNumber = findRowNumber(t, id);
  if (rowNumber < 0) throw new ApiError("That account no longer exists.");
  setCells(t, rowNumber, fields);
}

function createSession(userId) {
  const token = newToken();
  const th = hmacHex(token, pepper());
  const expires = Date.now() + CONFIG.SESSION_DAYS * 86400000;
  appendRow("Sessions", { TokenHash: th, UserID: userId, Expires: new Date(expires).toISOString(), Created: isoNow() });
  CacheService.getScriptCache().put("s:" + th, userId + "|" + expires, 600);
  return token;
}

function lookupSession(th) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("s:" + th);
  if (hit) {
    const parts = hit.split("|");
    if (Number(parts[1]) > Date.now()) return parts[0];
    cache.remove("s:" + th);
    return null;
  }
  const t = getTable("Sessions");
  const last = t.sh.getLastRow();
  if (last < 2) return null;
  const found = t.sh.getRange(2, 1, last - 1, 1).createTextFinder(th).matchEntireCell(true).findNext();
  if (!found) return null;
  const row = t.sh.getRange(found.getRow(), 1, 1, t.headers.length).getValues()[0];
  const exp = new Date(row[t.col.Expires]).getTime();
  if (!(exp > Date.now())) return null;
  cache.put("s:" + th, row[t.col.UserID] + "|" + exp, 600);
  return String(row[t.col.UserID]);
}

function revokeSessions(userId, exceptHash) {
  const t = getTable("Sessions");
  const last = t.sh.getLastRow();
  if (last < 2) return;
  const values = t.sh.getRange(2, 1, last - 1, t.headers.length).getValues();
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  for (let i = values.length - 1; i >= 0; i--) {
    const th = String(values[i][t.col.TokenHash]);
    const mine = String(values[i][t.col.UserID]) === String(userId) && th !== exceptHash;
    const expired = !(new Date(values[i][t.col.Expires]).getTime() > now);
    if (mine || expired) {
      cache.remove("s:" + th);
      t.sh.deleteRow(i + 2);
    }
  }
}

function auth(req, minRole) {
  const token = String(req.token || "");
  if (token.length < 40) throw new ApiError("Please log in again.", "AUTH");
  const th = hmacHex(token, pepper());
  const userId = lookupSession(th);
  if (!userId) throw new ApiError("Your session has ended. Please log in again.", "AUTH");
  const u = cachedUser(userId);
  if (!u || u.Status === "Disabled") throw new ApiError("This account is not active.", "AUTH");
  if (ROLE_RANK[u.Role] < ROLE_RANK[minRole || "member"]) {
    throw new ApiError("You don't have permission to do that.", "FORBIDDEN");
  }
  return { user: u, th: th };
}

/* ------------------------------ public routes ------------------------------ */

function ping() {
  return { ok: true };
}

function register(req) {
  const name = normName(req.name);
  const pass = String(req.passcode || "");
  validateName(name);
  validatePasscode(pass, name);

  const cache = CacheService.getScriptCache();
  const hourKey = "reg:" + Utilities.formatDate(new Date(), "UTC", "yyyyMMddHH");
  const count = Number(cache.get(hourKey) || 0);
  if (count >= CONFIG.MAX_SIGNUPS_PER_HOUR) {
    throw new ApiError("Lots of sign-ups right now. Wait a little and try again.", "RATE");
  }
  cache.put(hourKey, String(count + 1), 3600);

  const key = nameKey(name);
  const id = newId();
  withLock(function () {
    if (findUserByKey(key)) {
      throw new ApiError("That name is already registered. If it's you, log in. If not, add your middle name or an initial.");
    }
    const salt = newToken().slice(0, 24);
    appendRow("Users", {
      ID: id, Name: name, NameKey: key, Salt: salt, Hash: hashPasscode(pass, salt),
      Role: "member", Status: "Active", Created: isoNow(), LastLogin: isoNow()
    });
  });
  audit(name, "Created account", "Users", "");
  const token = createSession(id);
  return { token: token, user: { id: id, name: name, role: "member" } };
}

function login(req) {
  const name = normName(req.name);
  const pass = String(req.passcode || "");
  if (!name || !pass) throw new ApiError("Enter your name and passcode.");
  const key = nameKey(name);
  const cache = CacheService.getScriptCache();
  const failKey = "f:" + key;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= CONFIG.MAX_FAILED_LOGINS) {
    throw new ApiError("Too many wrong attempts. Wait " + CONFIG.LOCKOUT_MINUTES + " minutes and try again.", "RATE");
  }
  const u = findUserByKey(key);
  let ok = false;
  if (u) ok = safeEqual(hashPasscode(pass, u.Salt), u.Hash);
  else hashPasscode(pass, "decoy-salt-value");   // keep timing similar for unknown names
  if (!ok) {
    cache.put(failKey, String(fails + 1), CONFIG.LOCKOUT_MINUTES * 60);
    throw new ApiError("That name and passcode don't match.", "BAD_LOGIN");
  }
  if (u.Status === "Disabled") {
    throw new ApiError("This account has been turned off. Ask the church admin for help.", "DISABLED");
  }
  cache.remove(failKey);
  withLock(function () {
    patchUser(u.ID, { LastLogin: isoNow() });
    if (getTable("Sessions").sh.getLastRow() > 300) revokeSessions("", "");   // sweep expired sessions
  });
  const token = createSession(u.ID);
  return { token: token, user: publicUser(u) };
}

/* ------------------------------ session routes ------------------------------ */

function logout(req) {
  const a = auth(req, "member");
  withLock(function () {
    const t = getTable("Sessions");
    const last = t.sh.getLastRow();
    if (last < 2) return;
    const found = t.sh.getRange(2, 1, last - 1, 1).createTextFinder(a.th).matchEntireCell(true).findNext();
    if (found) t.sh.deleteRow(found.getRow());
  });
  CacheService.getScriptCache().remove("s:" + a.th);
  return {};
}

function bootstrap(req) {
  const a = auth(req, "member");
  const isAdmin = ROLE_RANK[a.user.Role] >= ROLE_RANK.admin;
  const data = {};
  READ_FOR_ALL.forEach(function (name) {
    let rows = readRows(getTable(name));
    if (name === "Announcements" && !isAdmin) rows = rows.filter(function (r) { return r.Active !== "No"; });
    data[name] = rows;
  });
  if (isAdmin) {
    const cutoff = Utilities.formatDate(new Date(Date.now() - CONFIG.ATTENDANCE_DAYS * 86400000), CONFIG.TIME_ZONE, "yyyy-MM-dd");
    READ_FOR_ADMIN.forEach(function (name) {
      let rows = readRows(getTable(name));
      if (name === "Attendance") rows = rows.filter(function (r) { return String(r.Date) >= cutoff; });
      data[name] = rows;
    });
  }
  return { user: { id: a.user.ID, name: a.user.Name, role: a.user.Role }, data: data, today: todayStr(), serverTime: isoNow() };
}

function changePasscode(req) {
  const a = auth(req, "member");
  const current = String(req.current || "");
  const next = String(req.next || "");
  const u = findUserById(a.user.ID);
  if (!u || !safeEqual(hashPasscode(current, u.Salt), u.Hash)) {
    throw new ApiError("Your current passcode isn't right.", "BAD_LOGIN");
  }
  validatePasscode(next, u.Name);
  withLock(function () {
    const salt = newToken().slice(0, 24);
    patchUser(u.ID, { Salt: salt, Hash: hashPasscode(next, salt) });
    revokeSessions(u.ID, a.th);   // every other device has to log in again
  });
  audit(u.Name, "Changed own passcode", "Users", "");
  return {};
}

/* ------------------------------ validation of records ------------------------------ */

function cleanText(field, value) {
  let s = String(value === null || value === undefined ? "" : value);
  s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  s = field === "Body" || field === "Message" || field === "Notes" ? s.replace(/[ \t]+$/gm, "").trim() : s.replace(/\s+/g, " ").trim();
  const max = MAX_LEN[field] || DEFAULT_MAX_LEN;
  if (s.length > max) throw new ApiError(field + " is too long. The limit is " + max + " characters.");
  return s;
}

function isUploadedFile(id) {
  try {
    const folder = uploadFolder();
    const parents = DriveApp.getFileById(id).getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) return true;
    }
  } catch (err) { /* not ours */ }
  return false;
}

function validateRecord(sheet, data, isNew) {
  const fields = SCHEMA[sheet].filter(function (f) { return f !== "ID"; });
  const out = {};
  fields.forEach(function (f) {
    if (!Object.prototype.hasOwnProperty.call(data, f)) return;
    const v = cleanText(f, data[f]);
    if (DATE_FIELDS.indexOf(f) > -1 && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ApiError(f + " must be a date.");
    if (/Phone$/.test(f) && v && !/^[0-9+()\-\s\/,.]+$/.test(v)) throw new ApiError("Phone numbers can only have digits, spaces, + and dashes.");
    if (f === "Gender" && v && v !== "Male" && v !== "Female") throw new ApiError("Gender must be Male or Female.");
    if (f === "Active" && v !== "Yes" && v !== "No") throw new ApiError("Pop-up status must be Yes or No.");
    if (f === "Platform" && PLATFORMS.indexOf(v) === -1) throw new ApiError("Pick a platform from the list.");
    if (f === "URL") {
      if (!/^https?:\/\/[^\s]+$/i.test(v)) throw new ApiError("Links must start with http:// or https://");
    }
    if (f === "Sort" && v && !/^\d{1,5}$/.test(v)) throw new ApiError("Sort must be a number.");
    if (f === "ImageID" && v && !/^[A-Za-z0-9_\-]{10,80}$/.test(v)) throw new ApiError("That image reference isn't valid.");
    out[f] = v;
  });

  const need = function (f) {
    if (isNew || Object.prototype.hasOwnProperty.call(out, f)) {
      if (!out[f]) throw new ApiError("Please fill in " + f + ".");
    }
  };
  if (sheet === "Members" || sheet === "Visitors" || sheet === "Prospects") {
    if (isNew && !out.FirstName && !out.Surname) throw new ApiError("Enter at least a first name or surname.");
  }
  if (sheet === "Congregations") need("Name");
  if (sheet === "Announcements") { need("Title"); if (isNew && !out.Active) out.Active = "Yes"; }
  if (sheet === "History") need("Title");
  if (sheet === "SocialLinks") { need("Platform"); need("Label"); need("URL"); }
  return out;
}

function recordLabel(sheet, d) {
  if (sheet === "Congregations") return d.Name || "";
  if (sheet === "Announcements" || sheet === "History") return d.Title || "";
  if (sheet === "SocialLinks") return d.Label || d.Platform || "";
  return ((d.FirstName || "") + " " + (d.Surname || "")).trim();
}

function editableSheet(name) {
  if (EDITABLE.indexOf(name) === -1) throw new ApiError("That list can't be changed this way.", "FORBIDDEN");
  return name;
}

function nextSort(sheet) {
  const rows = readRows(getTable(sheet), true);
  let max = 0;
  rows.forEach(function (r) { max = Math.max(max, Number(r.Sort) || 0); });
  return max + 1;
}

/* ------------------------------ admin data routes ------------------------------ */

function add(req) {
  const a = auth(req, "admin");
  const sheet = editableSheet(req.sheet);
  const data = validateRecord(sheet, req.data || {}, true);
  let id = newId();
  withLock(function () {
    if (SORTED_SHEETS.indexOf(sheet) > -1 && !data.Sort) data.Sort = String(nextSort(sheet));
    if (data.ImageID && !isUploadedFile(data.ImageID)) throw new ApiError("Upload the photo through the app first.");
    data.ID = id;
    appendRow(sheet, data);
  });
  audit(a.user.Name, "Added", sheet, recordLabel(sheet, data));
  return { id: id };
}

function update(req) {
  const a = auth(req, "admin");
  const sheet = editableSheet(req.sheet);
  const data = validateRecord(sheet, req.data || {}, false);
  withLock(function () {
    const t = getTable(sheet);
    const rowNumber = findRowNumber(t, req.id);
    if (rowNumber < 0) throw new ApiError("That record no longer exists. Refresh and try again.");
    if (sheet === "History" && Object.prototype.hasOwnProperty.call(data, "ImageID")) {
      const old = String(t.sh.getRange(rowNumber, t.col.ImageID + 1).getValue() || "");
      if (data.ImageID && data.ImageID !== old && !isUploadedFile(data.ImageID)) throw new ApiError("Upload the photo through the app first.");
      if (old && old !== data.ImageID) trashUpload(old);
    }
    setCells(t, rowNumber, data);
  });
  audit(a.user.Name, "Edited", sheet, recordLabel(sheet, data));
  return {};
}

function remove(req) {
  const a = auth(req, "admin");
  const sheet = editableSheet(req.sheet);
  let label = "";
  withLock(function () {
    const t = getTable(sheet);
    const rowNumber = findRowNumber(t, req.id);
    if (rowNumber < 0) return;   // already gone, nothing to do
    const row = t.sh.getRange(rowNumber, 1, 1, t.headers.length).getValues()[0];
    const rec = {};
    t.headers.forEach(function (h, i) { rec[h] = cellOut(h, row[i]); });
    label = recordLabel(sheet, rec);
    if (sheet === "History" && rec.ImageID) trashUpload(rec.ImageID);
    t.sh.deleteRow(rowNumber);
    if (sheet === "Members") removeAttendanceFor(req.id);
  });
  audit(a.user.Name, "Deleted", sheet, label);
  return {};
}

function removeAttendanceFor(memberId) {
  const t = getTable("Attendance");
  const last = t.sh.getLastRow();
  if (last < 2) return;
  const ids = t.sh.getRange(2, t.col.MemberID + 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(memberId)) t.sh.deleteRow(i + 2);
  }
}

function move(req) {
  const a = auth(req, "admin");
  const from = req.fromSheet, to = req.toSheet;
  const allowed = (from === "Visitors" && to === "Members") || (from === "Prospects" && to === "Visitors");
  if (!allowed) throw new ApiError("That move isn't allowed.");
  let label = "";
  withLock(function () {
    const src = getTable(from);
    const rowNumber = findRowNumber(src, req.id);
    if (rowNumber < 0) throw new ApiError("That record no longer exists. Refresh and try again.");
    const row = src.sh.getRange(rowNumber, 1, 1, src.headers.length).getValues()[0];
    const rec = {};
    src.headers.forEach(function (h, i) { rec[h] = cellOut(h, row[i]); });
    const copy = { ID: newId(), FirstName: rec.FirstName, Surname: rec.Surname, Gender: rec.Gender, Phone: rec.Phone };
    if (to === "Members") {
      copy.Address = rec.Address || "";
      copy.JoinDate = todayStr();
      copy.Status = "Active";
    } else {
      copy.Address = rec.Location || "";
      copy.DateVisited = todayStr();
      copy.FollowUpStatus = "Not contacted";
      copy.Notes = rec.Notes || "";
    }
    appendRow(to, copy);
    src.sh.deleteRow(rowNumber);
    label = ((rec.FirstName || "") + " " + (rec.Surname || "")).trim() + " to " + to;
  });
  audit(a.user.Name, "Moved", from, label);
  return {};
}

function setAttendance(req) {
  const a = auth(req, "admin");
  const memberId = String(req.memberId || "");
  const date = String(req.date || "");
  const service = String(req.serviceType || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("Pick a valid date.");
  if (SERVICES.indexOf(service) === -1) throw new ApiError("Pick a service from the list.");
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), CONFIG.TIME_ZONE, "yyyy-MM-dd");
  if (date > tomorrow) throw new ApiError("You can't mark attendance for a future date.");
  const present = req.present !== false;
  let changed = false;
  let id = "";
  withLock(function () {
    if (findRowNumber(getTable("Members"), memberId) < 0) throw new ApiError("That member no longer exists. Refresh and try again.");
    const t = getTable("Attendance");
    const last = t.sh.getLastRow();
    const matches = [];
    if (last >= 2) {
      const values = t.sh.getRange(2, 1, last - 1, t.headers.length).getValues();
      values.forEach(function (row, i) {
        if (String(row[t.col.MemberID]) === memberId &&
            cellOut("Date", row[t.col.Date]) === date &&
            String(row[t.col.ServiceType]) === service) {
          matches.push({ rowNumber: i + 2, id: String(row[t.col.ID]) });
        }
      });
    }
    if (present) {
      if (matches.length === 0) {
        id = newId();
        appendRow("Attendance", { ID: id, MemberID: memberId, Date: date, ServiceType: service, MarkedBy: a.user.Name });
        changed = true;
      } else {
        id = matches[0].id;
      }
    } else {
      for (let i = matches.length - 1; i >= 0; i--) {
        t.sh.deleteRow(matches[i].rowNumber);
        changed = true;
      }
    }
  });
  if (changed) audit(a.user.Name, present ? "Marked present" : "Removed attendance", "Attendance", date + ", " + service);
  return { id: id, changed: changed };
}

function reorder(req) {
  const a = auth(req, "admin");
  const sheet = req.sheet;
  if (SORTED_SHEETS.indexOf(sheet) === -1) throw new ApiError("That list can't be reordered.");
  const dir = req.direction === "up" ? -1 : 1;
  withLock(function () {
    const t = getTable(sheet);
    const last = t.sh.getLastRow();
    if (last < 2) return;
    const values = t.sh.getRange(2, 1, last - 1, t.headers.length).getValues();
    const items = values.map(function (row, i) {
      return { rowNumber: i + 2, id: String(row[t.col.ID]), sort: Number(row[t.col.Sort]) || 0, order: i };
    }).filter(function (x) { return x.id; });
    items.sort(function (x, y) { return x.sort - y.sort || x.order - y.order; });
    const at = items.findIndex(function (x) { return x.id === String(req.id); });
    if (at < 0) throw new ApiError("That item no longer exists. Refresh and try again.");
    const to = at + dir;
    if (to < 0 || to >= items.length) return;
    const tmp = items[at]; items[at] = items[to]; items[to] = tmp;
    items.forEach(function (x, i) {
      const cell = t.sh.getRange(x.rowNumber, t.col.Sort + 1);
      cell.setNumberFormat("@");
      cell.setValue(String(i + 1));
    });
  });
  return {};
}

function getAudit(req) {
  auth(req, "admin");
  const rows = readRows(getTable("AuditLog"));
  rows.reverse();
  return { data: rows.slice(0, 150) };
}

/* ------------------------------ photo uploads ------------------------------ */

function uploadFolder() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty("UPLOAD_FOLDER_ID");
  if (saved) {
    try { return DriveApp.getFolderById(saved); } catch (err) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder(CONFIG.UPLOAD_FOLDER_NAME);
  props.setProperty("UPLOAD_FOLDER_ID", folder.getId());
  return folder;
}

function trashUpload(fileId) {
  try {
    if (isUploadedFile(fileId)) DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) { /* best effort */ }
}

function uploadImage(req) {
  const a = auth(req, "admin");
  const mime = String(req.mime || "");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime];
  if (!ext) throw new ApiError("Photos must be JPEG, PNG or WebP.");
  const b64 = String(req.data || "");
  if (!b64 || b64.length > 2800000) throw new ApiError("That photo is too large. Pick a smaller one.");
  const bytes = Utilities.base64Decode(b64);
  const b = function (i) { return bytes[i] & 0xff; };
  const okMagic = (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ||
    (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) ||
    (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50);
  if (!okMagic) throw new ApiError("That file doesn't look like a real photo.");
  const blob = Utilities.newBlob(bytes, mime, "history-" + Date.now() + "." + ext);
  const file = uploadFolder().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    throw new ApiError("Google blocked link sharing for this account, so the photo can't be shown in the app.");
  }
  audit(a.user.Name, "Uploaded photo", "History", "");
  return { fileId: file.getId() };
}

/* ------------------------------ owner routes ------------------------------ */

function listUsers(req) {
  auth(req, "owner");
  const all = allUsers();
  return {
    data: all.users.map(function (u) {
      return { id: u.ID, name: u.Name, role: u.Role || "member", status: u.Status || "Active", created: u.Created, lastLogin: u.LastLogin };
    })
  };
}

function targetUser(req, a) {
  const u = findUserById(req.userId);
  if (!u) throw new ApiError("That account no longer exists. Refresh the list.");
  if (u.ID === a.user.ID) throw new ApiError("You can't change your own account this way.");
  if (u.Role === "owner") throw new ApiError("The owner account can't be changed here.", "FORBIDDEN");
  return u;
}

function setRole(req) {
  const a = auth(req, "owner");
  const role = req.role;
  if (role !== "admin" && role !== "member") throw new ApiError("Role must be admin or member.");
  const u = targetUser(req, a);
  withLock(function () { patchUser(u.ID, { Role: role }); });
  dropUserCache(u.ID);
  audit(a.user.Name, role === "admin" ? "Made admin" : "Removed admin", "Users", u.Name);
  return {};
}

function setStatus(req) {
  const a = auth(req, "owner");
  const status = req.status;
  if (status !== "Active" && status !== "Disabled") throw new ApiError("Status must be Active or Disabled.");
  const u = targetUser(req, a);
  withLock(function () {
    patchUser(u.ID, { Status: status });
    if (status === "Disabled") revokeSessions(u.ID, "");
  });
  dropUserCache(u.ID);
  audit(a.user.Name, status === "Disabled" ? "Turned off account" : "Turned on account", "Users", u.Name);
  return {};
}

function resetPasscode(req) {
  const a = auth(req, "owner");
  const u = targetUser(req, a);
  const pass = String(req.passcode || "");
  validatePasscode(pass, u.Name);
  withLock(function () {
    const salt = newToken().slice(0, 24);
    patchUser(u.ID, { Salt: salt, Hash: hashPasscode(pass, salt) });
    revokeSessions(u.ID, "");
  });
  CacheService.getScriptCache().remove("f:" + u.NameKey);
  audit(a.user.Name, "Reset passcode", "Users", u.Name);
  return {};
}

function deleteUser(req) {
  const a = auth(req, "owner");
  const u = targetUser(req, a);
  withLock(function () {
    revokeSessions(u.ID, "");
    getTable("Users").sh.deleteRow(findRowNumber(getTable("Users"), u.ID));
  });
  dropUserCache(u.ID);
  audit(a.user.Name, "Deleted account", "Users", u.Name);
  return {};
}

const ROUTES = {
  ping: ping,
  register: register,
  login: login,
  logout: logout,
  bootstrap: bootstrap,
  changePasscode: changePasscode,
  add: add,
  update: update,
  delete: remove,
  move: move,
  setAttendance: setAttendance,
  reorder: reorder,
  getAudit: getAudit,
  uploadImage: uploadImage,
  listUsers: listUsers,
  setRole: setRole,
  setStatus: setStatus,
  resetPasscode: resetPasscode,
  deleteUser: deleteUser
};

/* ------------------------------------------------------------------ */
/* Run these by hand from the Apps Script editor (Run button).        */
/* ------------------------------------------------------------------ */

/**
 * Step 1: register your account in the app, set OWNER_NAME at the top of this
 * file to that exact name, then run this once. Only someone with edit access to
 * this script can do it, which is why it is the safe way to pick the owner.
 */
function makeOwner() {
  const key = nameKey(CONFIG.OWNER_NAME);
  if (!key) throw new Error("Set OWNER_NAME at the top of the file first.");
  const u = findUserByKey(key);
  if (!u) throw new Error("No account called \"" + CONFIG.OWNER_NAME + "\" yet. Create it in the app first.");
  withLock(function () { patchUser(u.ID, { Role: "owner", Status: "Active" }); });
  dropUserCache(u.ID);
  console.log(u.Name + " is now the owner.");
}

/**
 * If the owner forgets their passcode: fill in the two values below, run this,
 * log in with the new passcode, then delete the passcode from this file again.
 */
function emergencyResetPasscode() {
  const NAME = "";
  const NEW_PASSCODE = "";
  const u = findUserByKey(nameKey(NAME));
  if (!u) throw new Error("No account with that name.");
  validatePasscode(NEW_PASSCODE, u.Name);
  const salt = newToken().slice(0, 24);
  withLock(function () {
    patchUser(u.ID, { Salt: salt, Hash: hashPasscode(NEW_PASSCODE, salt), Status: "Active" });
    revokeSessions(u.ID, "");
  });
  CacheService.getScriptCache().remove("f:" + u.NameKey);
  console.log("Passcode reset for " + u.Name + ". Now clear NEW_PASSCODE from this file.");
}

/** Run once after pasting the code. It creates any missing sheets and asks for Drive permission. */
function setup() {
  Object.keys(SCHEMA).forEach(function (name) { getTable(name); });
  uploadFolder();
  pepper();
  console.log("Sheets, upload folder and security key are ready.");
}
