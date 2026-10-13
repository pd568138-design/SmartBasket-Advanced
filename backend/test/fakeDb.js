// Tiny in-memory stand-in for the MongoDB driver (only what server.js uses). Test-only.
const { Query } = require("mingo");
const { updateObject } = require("mingo/updater");
const clone = (o) => structuredClone(o);

function applyUpdate(doc, upd) {
  for (const op of Object.keys(upd)) updateObject(doc, { [op]: upd[op] });
}
class Cursor {
  constructor(rows) { this.rows = rows; }
  sort(s) { const [k, d] = Object.entries(s)[0]; this.rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d); return this; }
  limit(n) { this.rows = this.rows.slice(0, n); return this; }
  async toArray() { return this.rows.map(clone); }
}
class Col {
  constructor() { this.docs = []; this.n = 0; }
  match(f) { const q = new Query(f); return this.docs.filter((d) => q.test(d)); }
  async insertOne(d) {
    d = clone(d);
    if (d._id === undefined) d._id = "oid" + ++this.n;
    this.docs.push(d);
    return { insertedId: d._id };
  }
  async findOne(f) { const r = this.match(f)[0]; return r ? clone(r) : null; }
  find(f) { return new Cursor(this.match(f).map(clone)); }
  async updateOne(f, u, o = {}) {
    let d = this.match(f)[0];
    if (!d && o.upsert) {
      d = {};
      for (const [k, v] of Object.entries(f)) if (!k.startsWith("$") && typeof v !== "object") d[k] = v;
      if (u.$setOnInsert) Object.assign(d, clone(u.$setOnInsert));
      this.docs.push(d);
      const { $setOnInsert, ...rest } = u; applyUpdate(d, rest);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    const { $setOnInsert, ...rest } = u; applyUpdate(d, rest);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async updateMany(f, u) { const ds = this.match(f); ds.forEach((d) => applyUpdate(d, u)); return { matchedCount: ds.length, modifiedCount: ds.length }; }
  async findOneAndUpdate(f, u) { const d = this.match(f)[0]; if (!d) return null; applyUpdate(d, u); return clone(d); }
  async createIndex() {}
}
module.exports = function fakeDb() {
  const cols = {};
  return { collection: (n) => (cols[n] ||= new Col()), databaseName: "fake" };
};
