# Setup steps (in order)

## 1. MongoDB Atlas
1. Cluster (M0 free) -> **Database Access** -> add user (username + password, no special characters).
2. **Network Access** -> Add IP `0.0.0.0/0` (Render has changing IPs).
3. **Connect -> Drivers** -> copy the string and put the DB name before `?`:
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/smartbasket?retryWrites=true&w=majority`

## 2. Load the 50 products (from your laptop)
```
cd backend
npm install
copy .env.example .env      (Mac/Linux: cp)
# edit .env -> paste MONGODB_URI, set DEVICE_KEY and CASHIER_KEY
npm run seed
```
Atlas -> Browse Collections -> `smartbasket.products` must show 50 documents.
(Alternative without Node: Atlas -> products -> Add Data -> Import `backend/seed/products.csv`. Tick the price column as Number.)

**Replace the barcodes of the first 10 products** (`demo:true` in `backend/seed/products.json`) with the real printed numbers on the products you will demo, then run `npm run seed` again.

## 3. Render (backend)
Push the whole folder to GitHub. Render -> New Web Service (or Blueprint). Root dir `backend`, build `npm install`, start `npm start`.
Environment variables: `MONGODB_URI`, `DEVICE_KEY`, `CASHIER_KEY` (and optionally `STORE_NAME`, `BASKET_TTL_MIN`).
Test: `https://YOUR-SERVICE.onrender.com/api/health` -> `{"ok":true,"mongo":true}`.
Free Render sleeps after 15 min idle; open /api/health once before the demo.

## 4. Vercel (frontend)
Edit `frontend/js/config.js` -> `BACKEND_URL = "https://YOUR-SERVICE.onrender.com"`, push, Vercel root dir `frontend`.
If all baskets are red: open `/cashier.html`, enter CASHIER_KEY, click **Reset all baskets**.

## 5. ESP32
Arduino IDE: install ESP32 boards, libraries **LiquidCrystal I2C** and **ArduinoJson 7.x**.
Open `esp32/Smart_Basket_ESP32/Smart_Basket_ESP32.ino`, edit Wi-Fi, SERVER_URL, DEVICE_KEY (same as Render), BASKET_ID (B1..B5), upload, Serial Monitor 115200.

## Demo run
1. Phone: register -> login -> Select basket (e.g. B1) -> allow location.
2. LCD shows WELCOME <name>. Scan product -> Confirm: LCD shows ITEM n ADDED, name, price, running total.
3. Press the FINISH button on the basket: LCD replays items one by one, stops on the BILL, uploads it.
4. Cashier: `cashier.html` -> key -> Load orders: name, basket, items, total, date/time, location. Mark paid.
