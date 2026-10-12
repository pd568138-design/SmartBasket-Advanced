const express=require("express"),cors=require("cors"),{MongoClient}=require("mongodb");require("dotenv").config();const app=express();app.use(cors());app.use(express.json());const PORT=process.env.PORT||5000;let db;async function connect(){const c=new MongoClient(process.env.MONGODB_URI);await c.connect();db=c.db();console.log("MongoDB Atlas connected")}app.get("/api/health",(q,s)=>s.json({ok:true,mongo:!!db}));app.post("/api/products",async(q,s)=>{try{const{barcode,name,price,category="General"}=q.body;if(!/^\d{8,14}$/.test(String(barcode||"")))return s.status(400).json({message:"Barcode must be 8–14 digits"});const p={barcode:String(barcode),name:String(name||"Unnamed product"),price:Number(price),category,updatedAt:new Date()};if(!Number.isFinite(p.price)||p.price<0)return s.status(400).json({message:"Invalid price"});await db.collection("products").updateOne({barcode:p.barcode},{$set:p},{upsert:true});s.json({success:true,product:p})}catch(e){s.status(500).json({message:e.message})}});app.post("/api/barcode",async(q,s)=>{try{const{barcode,basketId="B001"}=q.body;if(!/^\d{8,14}$/.test(String(barcode||"")))return s.status(400).json({message:"Invalid barcode"});const code=String(barcode),p=await db.collection("products").findOne({barcode:code});await db.collection("scans").insertOne({barcode:code,basketId,product:p||null,createdAt:new Date()});if(!p)return s.status(404).json({message:"Digits extracted, but barcode is not registered in MongoDB yet."});const esp=(process.env.ESP32_URL||"").replace(/\/$/,"");if(!esp)return s.json({success:true,message:"Product found in MongoDB. ESP32 is not connected in cloud mode; configure a local bridge for LCD output.",product:p,esp32Connected:false});const url=esp+"/product?barcode="+encodeURIComponent(code)+"&name="+encodeURIComponent(p.name)+"&price="+encodeURIComponent(p.price)+"&qty=1";const r=await fetch(url),text=await r.text();if(!r.ok)throw Error("ESP32 HTTP "+r.status);s.json({success:true,message:"Product found and sent to ESP32 LCD.",product:p,esp32Response:text})}catch(e){s.status(502).json({success:false,message:e.message})}});
const ALLOWED_BASKETS = ["B1", "B2", "B3", "B4", "B5"];
app.get("/api/baskets", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: "MongoDB is not connected yet. Please try again shortly." });
    const col = db.collection("baskets");
    for (const basketId of ALLOWED_BASKETS) {
      await col.updateOne({ _id: basketId }, { $setOnInsert: { status: "Available", sessionId: null, updatedAt: new Date() } }, { upsert: true });
    }
    const docs = await col.find({ _id: { $in: ALLOWED_BASKETS } }).toArray();
    const byId = new Map(docs.map(d => [d._id, d]));
    res.json({ success: true, baskets: ALLOWED_BASKETS.map(basketId => ({ basketId, status: byId.get(basketId)?.status || "Available" })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post("/api/baskets/:id/select", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: "MongoDB is not connected yet. Please try again shortly." });
    const basketId = String(req.params.id || "");
    if (!ALLOWED_BASKETS.includes(basketId)) return res.status(400).json({ success: false, message: "Invalid basket ID." });
    const crypto = require("crypto");
    const sessionId = crypto.randomUUID();
    const col = db.collection("baskets");
    // Ensure the basket exists, then atomically claim it only if it is Available.
    await col.updateOne({ _id: basketId }, { $setOnInsert: { status: "Available", sessionId: null, updatedAt: new Date() } }, { upsert: true });
    const basket = await col.findOneAndUpdate(
      { _id: basketId, status: "Available" },
      { $set: { status: "In Use", sessionId, updatedAt: new Date() } },
      { returnDocument: "after", includeResultMetadata: false }
    );
    if (!basket) return res.status(409).json({ success: false, message: "This basket is already in use. Please choose another basket." });
    res.json({ success: true, basketId, sessionId, status: "In Use" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post("/api/baskets/:id/release", async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: "MongoDB is not connected." });
    const basketId = String(req.params.id || "");
    if (!ALLOWED_BASKETS.includes(basketId)) return res.status(400).json({ success: false, message: "Invalid basket ID." });
    const sessionId = String(req.body.sessionId || "");
    const result = await db.collection("baskets").updateOne(
      { _id: basketId, status: "In Use", sessionId },
      { $set: { status: "Available", sessionId: null, updatedAt: new Date() } }
    );
    if (!result.modifiedCount) return res.status(409).json({ success: false, message: "Basket session did not match; it was not released." });
    res.json({ success: true, basketId, status: "Available" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.listen(PORT,async()=>{try{await connect();console.log("Backend running on port "+PORT)}catch(e){console.error("MongoDB connection failed:",e.message)}});
