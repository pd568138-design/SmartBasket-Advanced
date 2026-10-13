// Run: npm test   (no MongoDB needed - uses test/fakeDb.js; needs `npm i --no-save mingo@6`)
process.env.DEVICE_KEY = "dev"; process.env.CASHIER_KEY = "cash"; process.env.BASKET_TTL_MIN = "30";
const assert = require("assert");
const { createApp } = require("../server");
const fakeDb = require("./fakeDb");
const products = require("../seed/products.json");

(async () => {
  const db = fakeDb();
  await db.collection("products").insertOne({ ...products[0] });
  await db.collection("products").insertOne({ ...products[1] });
  await db.collection("products").insertOne({ ...products[2] });
  const server = createApp(() => db).listen(0);
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (m, p, body, key) => {
    const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { s: r.status, j: await r.json() };
  };

  let r = await call("GET", "/api/baskets");
  assert.deepStrictEqual(r.j.baskets.map((b) => b.status), Array(5).fill("Available")); console.log("1 baskets list OK");

  r = await call("POST", "/api/baskets/B1/select", { customerName: "Ravi", customerPhone: "9876543210", location: { lat: 13.0827, lng: 80.2707, accuracy: 20 } });
  assert.strictEqual(r.s, 200); const sid = r.j.sessionId;
  r = await call("POST", "/api/baskets/B1/select", {}); assert.strictEqual(r.s, 409); console.log("2 select + double-select blocked OK");
  r = await call("GET", "/api/baskets"); assert.strictEqual(r.j.baskets[0].status, "In Use");

  r = await call("GET", "/api/esp32/poll?basketId=B1"); assert.strictEqual(r.s, 401); console.log("3 device key enforced OK");
  r = await call("GET", "/api/esp32/poll?basketId=B1", null, "dev");
  assert.strictEqual(r.j.status, "In Use"); assert.strictEqual(r.j.customer, "Ravi"); assert.strictEqual(r.j.items.length, 0);

  r = await call("POST", "/api/barcode", { barcode: products[0].barcode, basketId: "B1", sessionId: "wrong" }); assert.strictEqual(r.s, 409);
  r = await call("POST", "/api/barcode", { barcode: "1234567890123", basketId: "B1", sessionId: sid }); assert.strictEqual(r.s, 404);
  for (const p of [products[0], products[1], products[0], products[2]]) {
    r = await call("POST", "/api/barcode", { barcode: p.barcode, basketId: "B1", sessionId: sid }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  }
  console.log("4 scans -> MongoDB lookup -> queue OK");

  r = await call("GET", "/api/esp32/poll?basketId=B1&session=" + sid + "&after=0", null, "dev");
  assert.deepStrictEqual(r.j.items.map((i) => i.seq), [1, 2, 3, 4]); assert.strictEqual(r.j.reset, false);
  r = await call("GET", "/api/esp32/poll?basketId=B1&session=" + sid + "&after=4", null, "dev"); assert.strictEqual(r.j.items.length, 0);
  r = await call("GET", "/api/esp32/poll?basketId=B1&session=old&after=4", null, "dev"); assert.strictEqual(r.j.reset, true); assert.strictEqual(r.j.items.length, 4);
  console.log("5 ESP32 incremental poll + session reset OK");

  const total = 10 + 30 + 10 + 14;
  const payload = { basketId: "B1", sessionId: sid, customer: "Ravi", datetime: "2026-10-13 14:35:20", total,
    items: [products[0], products[1], products[0], products[2]].map((p) => ({ barcode: p.barcode, name: p.name, price: p.price, qty: 1 })) };
  r = await call("POST", "/api/esp32/checkout", payload, "dev"); assert.strictEqual(r.s, 200); assert.ok(r.j.totalMatches);
  const again = await call("POST", "/api/esp32/checkout", payload, "dev"); assert.ok(again.j.duplicate); // retry-safe
  console.log("6 checkout saved, retry-safe OK");

  r = await call("GET", "/api/orders"); assert.strictEqual(r.s, 401);
  r = await call("GET", "/api/orders", null, "cash");
  assert.strictEqual(r.j.orders.length, 1);
  const o = r.j.orders[0]; assert.strictEqual(o.customerName, "Ravi"); assert.strictEqual(o.total, total); assert.strictEqual(o.basketId, "B1");
  assert.strictEqual(o.deviceDateTime, "2026-10-13 14:35:20"); assert.ok(o.location.lat);
  r = await call("GET", "/api/baskets"); assert.strictEqual(r.j.baskets[0].status, "Available");
  r = await call("POST", "/api/barcode", { barcode: products[0].barcode, basketId: "B1", sessionId: sid }); assert.strictEqual(r.s, 409);
  r = await call("POST", `/api/orders/${o.orderId}/paid`, {}, "cash"); assert.ok(r.j.success);
  console.log("7 cashier order (name, items, total, time, location, basket) + basket auto-free OK");

  // stuck basket auto-expiry + admin reset
  await call("POST", "/api/baskets/B2/select", {});
  db.collection("baskets").docs.find((d) => d._id === "B2").updatedAt = new Date(Date.now() - 31 * 60000);
  r = await call("GET", "/api/baskets"); assert.strictEqual(r.j.baskets[1].status, "Available");
  await call("POST", "/api/baskets/B3/select", {}); await call("POST", "/api/baskets/B4/select", {});
  r = await call("POST", "/api/admin/reset-baskets", {}, "cash"); assert.ok(r.j.success);
  r = await call("GET", "/api/baskets"); assert.ok(r.j.baskets.every((b) => b.status === "Available"));
  console.log("8 stale-basket TTL + reset-all OK");
  console.log("\nALL TESTS PASSED"); server.close();
})().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
