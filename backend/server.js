
const ALLOWED_BASKETS = ["B1", "B2", "B3", "B4", "B5"];

// Get all basket statuses
app.get("/api/baskets", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ message: "MongoDB not connected" });
    }

    const collection = db.collection("baskets");

    for (const basketId of ALLOWED_BASKETS) {
      await collection.updateOne(
        { _id: basketId },
        {
          $setOnInsert: {
            status: "Available",
            sessionId: null,
            customerName: null,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    }

    const baskets = await collection
      .find({ _id: { $in: ALLOWED_BASKETS } })
      .toArray();

    res.json({
      success: true,
      baskets: baskets.map(b => ({
        basketId: b._id,
        status: b.status
      }))
    });
  } catch (error) {
    console.error("Basket fetch error:", error.message);
    res.status(500).json({ message: "Unable to load baskets" });
  }
});

// Select an available basket
app.post("/api/baskets/:id/select", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ message: "MongoDB not connected" });
    }

    const basketId = req.params.id;

    if (!ALLOWED_BASKETS.includes(basketId)) {
      return res.status(400).json({ message: "Invalid basket ID" });
    }

    const sessionId = require("crypto").randomUUID();

    const result = await db.collection("baskets").findOneAndUpdate(
      { _id: basketId, status: "Available" },
      {
        $set: {
          status: "In Use",
          sessionId,
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(409).json({
        success: false,
        message: "This basket is already in use"
      });
    }

    res.json({
      success: true,
      basketId,
      sessionId,
      status: "In Use"
    });
  } catch (error) {
    console.error("Basket selection error:", error.message);
    res.status(500).json({ message: "Unable to select basket" });
  }
});
