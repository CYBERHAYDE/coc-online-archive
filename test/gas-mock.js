// A small stand-in for the Apps Script services Code.gs uses, so the backend logic can be tested in Node.
const crypto = require("crypto");
const vm = require("vm");
const fs = require("fs");

function makeEnv(opts) {
  opts = opts || {};
  const sheets = {};
  const formatsSeen = [];
  let lockHeld = false;

  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const v = (this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j];
          row.push(v === undefined ? "" : v);
        }
        out.push(row);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      for (let i = 0; i < vals.length; i++) {
        const idx = this.r - 1 + i;
        while (this.sh.rows.length <= idx) this.sh.rows.push([]);
        for (let j = 0; j < vals[i].length; j++) {
          this.sh.rows[idx][this.c - 1 + j] = vals[i][j];
          this.sh.written.push({ r: idx + 1, c: this.c + j, fmt: this.sh.fmt[(idx + 1) + ":" + (this.c + j)] });
        }
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormat(f) {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.fmt[(this.r + i) + ":" + (this.c + j)] = f;
      return this;
    }
    createTextFinder(text) {
      const self = this;
      const finder = {
        matchEntireCell() { return finder; },
        findNext() {
          for (let i = 0; i < self.nr; i++) {
            for (let j = 0; j < self.nc; j++) {
              const v = (self.sh.rows[self.r - 1 + i] || [])[self.c - 1 + j];
              if (String(v) === text) return { getRow: () => self.r + i };
            }
          }
          return null;
        }
      };
      return finder;
    }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.fmt = {}; this.written = []; }
    getLastRow() { let n = 0; this.rows.forEach((r, i) => { if (r && r.some(c => c !== "" && c !== undefined)) n = i + 1; }); return n; }
    getLastColumn() { let n = 0; this.rows.forEach(r => { if (r) n = Math.max(n, r.length); }); return n; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    deleteRow(n) { this.rows.splice(n - 1, 1); }
    setFrozenRows() {}
  }
  const book = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n)),
    getSpreadsheetTimeZone: () => "Africa/Lagos"
  };

  const props = {};
  const cacheStore = new Map();
  const drive = { files: {}, folder: { id: "folder-1" } };

  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book },
    CacheService: { getScriptCache: () => ({
      get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
      put: (k, v) => { cacheStore.set(k, String(v)); },
      remove: k => { cacheStore.delete(k); }
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; }
    }) },
    LockService: { getScriptLock: () => ({
      waitLock() { if (lockHeld) throw new Error("DEADLOCK: lock requested while already held"); lockHeld = true; },
      releaseLock() { lockHeld = false; }
    }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac("sha256", k).update(v).digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz === "UTC" ? "UTC" : tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
        if (fmt === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
        if (fmt === "yyyyMMddHH") return `${parts.year}${parts.month}${parts.day}${parts.hour}`;
        throw new Error("fmt " + fmt);
      },
      base64Decode: s => Array.from(Buffer.from(s, "base64")).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name })
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      createFolder: () => ({ getId: () => drive.folder.id, createFile: blob => { const id = "file" + Object.keys(drive.files).length + "abcdefghij"; drive.files[id] = { blob, trashed: false }; return { getId: () => id, setSharing() {} }; } }),
      getFolderById: id => ({ getId: () => id, createFile: blob => { const id2 = "file" + Object.keys(drive.files).length + "abcdefghij"; drive.files[id2] = { blob, trashed: false }; return { getId: () => id2, setSharing() {} }; } }),
      getFileById: id => {
        if (!drive.files[id]) throw new Error("not found");
        return { getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => drive.folder.id }; } }; }, setTrashed: v => { drive.files[id].trashed = v; } };
      }
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + "/../backend/Code.gs", "utf8"), ctx, { filename: "Code.gs" });

  function call(action, payload) {
    const out = vm.runInContext("doPost(" + JSON.stringify({ postData: { contents: JSON.stringify(Object.assign({ action }, payload || {})) } }) + ")", ctx);
    return JSON.parse(out.content);
  }
  return { call, ctx, sheets, drive, run: code => vm.runInContext(code, ctx), cacheStore };
}
module.exports = { makeEnv };
