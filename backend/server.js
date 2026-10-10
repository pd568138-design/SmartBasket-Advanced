
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  "https://smartbasket-advanced-frontend.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header, such as local health checks.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);

app.use(express.json());

let db;
let client;

// Health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Smart Basket backend is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mongo: Boolean(db),
    message: db ? "MongoDB connected" : "MongoDB not connected",
  });
});

// Save or update a product in MongoDB
app.post("/api/products", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        message: "MongoDB is not connected",
      });
    }

    const { barcode, name, price, category = "General" } = req.body;
    const code = String(barcode || "").trim();
    const productPrice = Number(price);

    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({
        message: "Barcode must be 8-14 digits",
      });
    }

    if (
      price === undefined ||
      price === null ||
      String(price).trim() === "" ||
      !Number.isFinite(productPrice) ||
      productPrice < 0
    ) {
      return res.status(400).json({
        message: "Invalid price",
      });
    }

    const product = {
      barcode: code,
      name: String(name || "Unnamed product").trim(),
      price: productPrice,
      category: String(category || "General").trim(),
      updatedAt: new Date(),
    };

    await db.collection("products").updateOne(
      { barcode: code },
      { $set: product },
      { upsert: true }
    );

    return res.json({
      success: true,
      message: "Product saved successfully",
      product,
    });
  } catch (error) {
    console.error("Product save error:", error.message);

    return res.status(500).json({
      message: "Unable to save product",
    });
  }
});

// Scan a barcode and find its product
app.post("/api/barcode", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        message: "MongoDB is not connected",
      });
    }

    const { barcode, basketId = "B001" } = req.body;
    const code = String(barcode || "").trim();

    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({
        message: "Invalid barcode. Enter 8-14 digits.",
      });
    }

    const product = await db.collection("products").findOne({
      barcode: code,
    });

    await db.collection("scans").insertOne({
      barcode: code,
      basketId: String(basketId),
      product: product || null,
      createdAt: new Date(),
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message:
          "Barcode received, but product is not registered in MongoDB.",
      });
    }

    const esp32Url = (process.env.ESP32_URL || "").replace(/\/$/, "");

    // If ESP32 is not configured, still return the MongoDB product.
    if (!esp32Url || esp32Url.includes("YOUR_ESP32_IP")) {
      return res.json({
        success: true,
        message: "Product found in MongoDB. ESP32 is not configured.",
        product,
        esp32Connected: false,
      });
    }

    const url =
      `${esp32Url}/product?barcode=${encodeURIComponent(code)}` +
      `&name=${encodeURIComponent(product.name)}` +
      `&price=${encodeURIComponent(product.price)}` +
      "&qty=1";

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`ESP32 HTTP error: ${response.status}`);
    }

    return res.json({
      success: true,
      message: "Product found and sent to ESP32.",
      product,
      esp32Connected: true,
      esp32Response: responseText,
    });
  } catch (error) {
    console.error("Barcode processing error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Barcode processing failed",
    });
  }
});

// Start server and connect to MongoDB
async function startServer() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing from environment variables.");
    process.exit(1);
  }

  client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();
    db = client.db();

    console.log("MongoDB Atlas connected");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Smart Basket backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
