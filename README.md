# Smart Basket Advanced (v2)

```
Phone (Vercel) --scan barcode--> Render API --lookup--> MongoDB Atlas (products)
                                     |  queue per basket
ESP32 (LCD) <--HTTPS poll every 3s---+
ESP32 keeps list, shows items one by one, totals, FINISH button
ESP32 --HTTPS POST bill--> Render API --> MongoDB Atlas (orders)  --> cashier.html
```
The ESP32 never talks to MongoDB directly (no secrets on the device, works behind any Wi-Fi). It only talks to the Render API using DEVICE_KEY.

## Folders
- `backend/`  Node + Express API (Render). `npm run seed` loads 50 products. `npm test` runs a full flow test (needs `npm i --no-save mingo@6`).
- `frontend/` Phone web app (Vercel) + `cashier.html`.
- `esp32/Smart_Basket_ESP32/` Arduino sketch.

## MongoDB collections (database `smartbasket`)
| collection | content |
|---|---|
| products | barcode, name, price, category |
| baskets | B1..B5 status, sessionId, customerName, location |
| cart_items | scanned items per basket session (seq, barcode, name, price) |
| scans | log of every scan |
| orders | final bill: customer, basket, items, total, device date/time, location, status |

## API
Public: `GET /api/health`, `GET /api/baskets`, `POST /api/baskets/:id/select|release`, `GET /api/baskets/:id/cart`, `POST /api/barcode`, `GET /api/products`
Device key (`x-api-key: DEVICE_KEY`): `GET /api/esp32/poll`, `POST /api/esp32/checkout`
Cashier key (`x-api-key: CASHIER_KEY`): `GET /api/orders`, `POST /api/orders/:id/paid`, `POST /api/admin/reset-baskets`, `POST /api/products`

## Basket "In Use" problem (fixed)
Baskets used to stay red forever because nothing released them. Now they free themselves: after checkout on the ESP32, on logout, after 30 min idle (`BASKET_TTL_MIN`), or via "Reset all baskets" in `cashier.html`.

Wiring: LCD SDA=GPIO21, SCL=GPIO22. FINISH button between GPIO4 and GND.
Demo OTP is shown on screen (no SMS); the login is localStorage-only, not production security.
