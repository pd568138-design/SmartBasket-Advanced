
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

let db;
let client;

async function connect() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env file");
  }

  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  db = client.db();

  console.log("MongoDB Atlas connected");
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mongo: !!db,
    message: db ? "MongoDB connected" : "MongoDB not connected"
  });
});

app.post("/api/products", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        message: "MongoDB is not connected"
      });
    }

    const {
      barcode,
      name,
      price,
      category = "General"
    } = req.body;

    const code = String(barcode || "");

    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({
        message: "Barcode must be 8-14 digits"
      });
    }

    const product = {
      barcode: code,
      name: String(name || "Unnamed product"),
      price: Number(price),
      category: String(category),
      updatedAt: new Date()
    };

    if (!Number.isFinite(product.price) || product.price < 0) {
      return res.status(400).json({
        message: "Invalid price"
      });
    }

    await db.collection("products").updateOne(
      { barcode: code },
      { $set: product },
      { upsert: true }
    );

    return res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error("Product save error:", error.message);

    return res.status(500).json({
      message: error.message
    });
  }
});

app.post("/api/barcode", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        message: "MongoDB is not connected"
      });
    }

    const {
      barcode,
      basketId = "B001"
    } = req.body;

    const code = String(barcode || "");

    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({
        message: "Invalid barcode. Enter 8-14 digits."
      });
    }

    const product = await db.collection("products").findOne({
      barcode: code
    });

    await db.collection("scans").insertOne({
      barcode: code,
      basketId: String(basketId),
      product: product || null,
      createdAt: new Date()
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message:
          "Barcode digits received, but this product is not registered in MongoDB."
      });
    }

    const esp32Url = (process.env.ESP32_URL || "")
      .replace(/\/$/, "");

    if (
      !esp32Url ||
      esp32Url.includes("YOUR_ESP32_IP")
    ) {
      return res.json({
        success: true,
        message:
          "Product found in MongoDB. ESP32 URL is not configured.",
        product,
        esp32Connected: false
      });
    }

    const url =
      esp32Url +
      "/product?barcode=" + encodeURIComponent(code) +
      "&name=" + encodeURIComponent(product.name) +
      "&price=" + encodeURIComponent(product.price) +
      "&qty=1";

    const response = await fetch(url);
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error("ESP32 HTTP error: " + response.status);
    }

    return res.json({
      success: true,
      message: "Product found and sent to ESP32.",
      product,
      esp32Connected: true,
      esp32Response: responseText
    });
  } catch (error) {
    console.error("Barcode processing error:", error.message);

    return res.status(502).json({
      success: false,
      message: error.message
    });
  }
});

app.listen(PORT, async () => {
  console.log("Starting Smart Basket backend...");

  try {
    await connect();
    console.log("Backend running on port " + PORT);
  } catch (error) {
    console.error(
      "MongoDB connection failed:",
      error.message
    );
    console.error(
      "Check your Atlas URI, DNS settings, and network connection."
    );
  }
});
