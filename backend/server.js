require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const BASKETS = ["B1", "B2", "B3", "B4", "B5"];
const TTL_MS = (Number(process.env.BASKET_TTL_MIN) || 30) * 60 * 1000; // idle basket auto-frees after this
const STORE_NAME = process.env.STORE_NAME || "SmartBasket Store, Chennai";

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Key can come from header x-api-key or ?key=
function keyOk(req, envName) {
  const expected = process.env[envName];
  if (!expected) return false; // key not configured on server => deny
  return safeEqual(req.get("x-api-key") || req.query.key, expected);
}
const isFree = (d) => !d || d.status !== "In Use" || Date.now() - new Date(d.updatedAt).getTime() > TTL_MS;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round2 = (n) => Math.round(n * 100) / 100;

function cleanLocation(l) {
  if (!l || typeof l !== "object") return null;
  const lat = Number(l.lat), lng = Number(l.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, accuracy: num(l.accuracy, null) };
}
function locationText(basket) {
  const l = basket && basket.location;
  return STORE_NAME + (l ? ` (${l.lat},${l.lng})` : "");
}

function createApp(getDb) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "200kb" }));

  const needDb = (req, res, next) => {
    const db = getDb();
    if (!db) return res.status(503).json({ success: false, message: "MongoDB not connected yet. Try again in a few seconds." });
    req.db = db;
    next();
  };
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ success: false, message: e.message }));
  const needCashier = (req, res, next) =>
    keyOk(req, "CASHIER_KEY") ? next() : res.status(401).json({ success: false, message: "Invalid or missing cashier key." });
  const needDevice = (req, res, next) =>
    keyOk(req, "DEVICE_KEY") ? next() : res.status(401).json({ success: false, message: "Invalid or missing device key." });

  async function ensureBaskets(db) {
    const col = db.collection("baskets");
    for (const id of BASKETS) {
      await col.updateOne({ _id: id }, { $setOnInsert: { status: "Available", sessionId: null, updatedAt: new Date() } }, { upsert: true });
    }
    return col;
  }

  app.get("/api/health", (req, res) => res.json({ ok: true, mongo: !!getDb(), store: STORE_NAME }));

  /* ---------------- Products ---------------- */
  app.get("/api/products", needDb, wrap(async (req, res) => {
    const items = await req.db.collection("products").find({}).sort({ name: 1 }).limit(200).toArray();
    res.json({ success: true, count: items.length, products: items });
  }));

  app.post("/api/products", needDb, needCashier, wrap(async (req, res) => {
    const { barcode, name, price, category = "General" } = req.body || {};
    if (!/^\d{8,14}$/.test(String(barcode || ""))) return res.status(400).json({ message: "Barcode must be 8-14 digits" });
    const p = { barcode: String(barcode), name: String(name || "Unnamed product").slice(0, 20), price: Number(price), category, updatedAt: new Date() };
    if (!Number.isFinite(p.price) || p.price < 0) return res.status(400).json({ message: "Invalid price" });
    await req.db.collection("products").updateOne({ barcode: p.barcode }, { $set: p }, { upsert: true });
    res.json({ success: true, product: p });
  }));

  /* ---------------- Baskets ---------------- */
  app.get("/api/baskets", needDb, wrap(async (req, res) => {
    const col = await ensureBaskets(req.db);
    const docs = await col.find({ _id: { $in: BASKETS } }).toArray();
    const byId = new Map(docs.map((d) => [d._id, d]));
    res.json({ success: true, baskets: BASKETS.map((id) => ({ basketId: id, status: isFree(byId.get(id)) ? "Available" : "In Use" })) });
  }));

  app.post("/api/baskets/:id/select", needDb, wrap(async (req, res) => {
    const basketId = String(req.params.id || "");
    if (!BASKETS.includes(basketId)) return res.status(400).json({ success: false, message: "Invalid basket ID." });
    const col = await ensureBaskets(req.db);
    const body = req.body || {};
    const sessionId = crypto.randomUUID();
    const now = new Date();
    const cutoff = new Date(Date.now() - TTL_MS);
    // Claim atomically: only if it is free OR the old session has been idle past the TTL
    const basket = await col.findOneAndUpdate(
      { _id: basketId, $or: [{ status: { $ne: "In Use" } }, { updatedAt: { $lt: cutoff } }] },
      {
        $set: {
          status: "In Use", sessionId, cartSeq: 0, startedAt: now, updatedAt: now,
          customerName: String(body.customerName || "Guest").slice(0, 40),
          customerPhone: String(body.customerPhone || "").slice(0, 15),
          location: cleanLocation(body.location), storeName: STORE_NAME,
        },
      },
      { returnDocument: "after", includeResultMetadata: false }
    );
    if (!basket) return res.status(409).json({ success: false, message: "This basket is already in use. Please choose another basket." });
    res.json({ success: true, basketId, sessionId, status: "In Use" });
  }));

  app.post("/api/baskets/:id/release", needDb, wrap(async (req, res) => {
    const basketId = String(req.params.id || "");
    if (!BASKETS.includes(basketId)) return res.status(400).json({ success: false, message: "Invalid basket ID." });
    const sessionId = String((req.body || {}).sessionId || "");
    const r = await req.db.collection("baskets").updateOne(
      { _id: basketId, status: "In Use", sessionId },
      { $set: { status: "Available", sessionId: null, updatedAt: new Date() } }
    );
    if (!r.modifiedCount) return res.status(409).json({ success: false, message: "Basket session did not match; it was not released." });
    res.json({ success: true, basketId, status: "Available" });
  }));

  // Phone view of the current cart
  app.get("/api/baskets/:id/cart", needDb, wrap(async (req, res) => {
    const basketId = String(req.params.id || "");
    const sessionId = String(req.query.sessionId || "");
    const items = await req.db.collection("cart_items").find({ basketId, sessionId }).sort({ seq: 1 }).toArray();
    const total = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
    res.json({ success: true, items: items.map(({ seq, barcode, name, price, qty }) => ({ seq, barcode, name, price, qty })), total });
  }));

  /* ---------------- Phone scan -> MongoDB lookup -> cart queue ---------------- */
  app.post("/api/barcode", needDb, wrap(async (req, res) => {
    const { barcode, basketId, sessionId } = req.body || {};
    if (!/^\d{8,14}$/.test(String(barcode || ""))) return res.status(400).json({ success: false, message: "Invalid barcode" });
    if (!BASKETS.includes(String(basketId))) return res.status(400).json({ success: false, message: "Invalid basket ID" });
    const code = String(barcode);
    const baskets = req.db.collection("baskets");
    const active = await baskets.findOne({ _id: basketId, status: "In Use", sessionId: String(sessionId || "") });
    if (!active) return res.status(409).json({ success: false, message: "Your basket session is not active (finished or expired). Select a basket again." });

    const product = await req.db.collection("products").findOne({ barcode: code });
    await req.db.collection("scans").insertOne({ barcode: code, basketId, sessionId, found: !!product, createdAt: new Date() });
    if (!product) return res.status(404).json({ success: false, message: "Digits read, but this barcode is not registered in MongoDB yet." });

    const upd = await baskets.findOneAndUpdate(
      { _id: basketId, status: "In Use", sessionId },
      { $inc: { cartSeq: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", includeResultMetadata: false }
    );
    if (!upd) return res.status(409).json({ success: false, message: "Basket session ended." });
    await req.db.collection("cart_items").insertOne({
      basketId, sessionId, seq: upd.cartSeq, barcode: code, name: product.name, price: product.price, qty: 1, createdAt: new Date(),
    });
    res.json({ success: true, message: `${product.name} (Rs.${product.price}) added. ESP32 LCD will show it in a moment.`, product: { barcode: code, name: product.name, price: product.price }, seq: upd.cartSeq });
  }));

  /* ---------------- ESP32 endpoints (device key) ---------------- */
  // ESP32 polls every ~3s. It sends the session it knows + last seq it received; we return only new items.
  app.get("/api/esp32/poll", needDb, needDevice, wrap(async (req, res) => {
    const basketId = String(req.query.basketId || "");
    if (!BASKETS.includes(basketId)) return res.status(400).json({ success: false, message: "Invalid basketId" });
    const doc = await req.db.collection("baskets").findOne({ _id: basketId });
    if (isFree(doc)) return res.json({ status: "Available", sessionId: "", items: [] });

    // keep an active basket from timing out (cheap conditional write, at most once a minute)
    await req.db.collection("baskets").updateOne(
      { _id: basketId, status: "In Use", updatedAt: { $lt: new Date(Date.now() - 60000) } },
      { $set: { updatedAt: new Date() } }
    );
    const same = String(req.query.session || "") === doc.sessionId;
    const after = same ? num(req.query.after, 0) : 0;
    const rows = await req.db.collection("cart_items").find({ basketId, sessionId: doc.sessionId, seq: { $gt: after } }).sort({ seq: 1 }).limit(40).toArray();
    res.json({
      status: "In Use", sessionId: doc.sessionId, reset: !same,
      customer: doc.customerName || "Guest", location: locationText(doc),
      items: rows.map((r) => ({ seq: r.seq, barcode: r.barcode, name: r.name, price: r.price })),
    });
  }));

  // ESP32 finishes: sends its own list + calculated total + date/time. We save the order for the cashier.
  app.post("/api/esp32/checkout", needDb, needDevice, wrap(async (req, res) => {
    const b = req.body || {};
    const basketId = String(b.basketId || ""), sessionId = String(b.sessionId || "");
    if (!BASKETS.includes(basketId) || !sessionId) return res.status(400).json({ success: false, message: "basketId and sessionId required" });
    const orders = req.db.collection("orders");

    const existing = await orders.findOne({ sessionId });
    if (existing) return res.json({ success: true, duplicate: true, orderId: existing.orderId }); // retry-safe

    const basket = await req.db.collection("baskets").findOne({ _id: basketId });
    if (!basket || basket.sessionId !== sessionId) return res.status(409).json({ success: false, message: "Session not active" });

    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((i) => ({
      barcode: String(i.barcode || ""), name: String(i.name || "").slice(0, 40), price: num(i.price), qty: Math.max(1, num(i.qty, 1)),
    }));
    const esp32Total = round2(num(b.total));
    const cartRows = await req.db.collection("cart_items").find({ basketId, sessionId }).toArray();
    const serverTotal = round2(cartRows.reduce((s, r) => s + r.price * r.qty, 0));
    const order = {
      orderId: "ORD-" + Date.now().toString(36).toUpperCase() + "-" + basketId,
      basketId, sessionId,
      customerName: basket.customerName || String(b.customer || "Guest"),
      customerPhone: basket.customerPhone || "",
      location: basket.location || null, locationText: locationText(basket), storeName: STORE_NAME,
      items, itemCount: items.reduce((s, i) => s + i.qty, 0),
      total: esp32Total, serverTotal, totalMatches: Math.abs(esp32Total - serverTotal) < 0.01,
      deviceDateTime: String(b.datetime || ""), createdAt: new Date(), status: "Pending Payment",
    };
    await orders.insertOne(order);
    await req.db.collection("baskets").updateOne(
      { _id: basketId, sessionId },
      { $set: { status: "Available", sessionId: null, updatedAt: new Date() } }
    );
    res.json({ success: true, orderId: order.orderId, totalMatches: order.totalMatches });
  }));

  /* ---------------- Cashier ---------------- */
  app.get("/api/orders", needDb, needCashier, wrap(async (req, res) => {
    const limit = Math.min(200, num(req.query.limit, 50));
    const orders = await req.db.collection("orders").find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    res.json({ success: true, orders });
  }));

  app.post("/api/orders/:orderId/paid", needDb, needCashier, wrap(async (req, res) => {
    const r = await req.db.collection("orders").updateOne({ orderId: req.params.orderId }, { $set: { status: "Paid", paidAt: new Date() } });
    if (!r.matchedCount) return res.status(404).json({ success: false, message: "Order not found" });
    res.json({ success: true });
  }));

  // Demo helper: frees every basket (use if baskets show "In Use" after testing)
  app.post("/api/admin/reset-baskets", needDb, needCashier, wrap(async (req, res) => {
    await ensureBaskets(req.db);
    const r = await req.db.collection("baskets").updateMany({ _id: { $in: BASKETS } }, { $set: { status: "Available", sessionId: null, updatedAt: new Date() } });
    res.json({ success: true, reset: r.modifiedCount });
  }));

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  let db = null;
  const PORT = process.env.PORT || 5000;
  createApp(() => db).listen(PORT, () => console.log("Backend listening on port " + PORT));
  (async function connect() {
    try {
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      db = client.db();
      await db.collection("orders").createIndex({ sessionId: 1 }, { unique: true });
      await db.collection("cart_items").createIndex({ basketId: 1, sessionId: 1, seq: 1 });
      await db.collection("products").createIndex({ barcode: 1 }, { unique: true });
      console.log("MongoDB Atlas connected, db =", db.databaseName);
    } catch (e) {
      console.error("MongoDB connection failed:", e.message, "- retrying in 10s");
      setTimeout(connect, 10000);
    }
  })();
}
