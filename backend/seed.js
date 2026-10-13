// Usage: npm run seed   (reads MONGODB_URI from .env, upserts all products in seed/products.json)
require("dotenv").config();
const { MongoClient } = require("mongodb");
const products = require("./seed/products.json");

(async () => {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing. Create backend/.env first.");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const col = db.collection("products");
  await col.createIndex({ barcode: 1 }, { unique: true });
  const ops = products.map((p) => ({
    updateOne: {
      filter: { barcode: String(p.barcode) },
      update: { $set: { barcode: String(p.barcode), name: p.name.slice(0, 20), price: Number(p.price), category: p.category || "General", updatedAt: new Date() } },
      upsert: true,
    },
  }));
  const r = await col.bulkWrite(ops);
  console.log(`DB "${db.databaseName}": ${r.upsertedCount} inserted, ${r.modifiedCount} updated, total now ${await col.countDocuments()}`);
  await client.close();
})().catch((e) => { console.error("Seed failed:", e.message); process.exit(1); });
