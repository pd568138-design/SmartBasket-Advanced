# Smart Basket — run locally, then deploy

## 1. Run in VS Code first
1. Extract this ZIP and open the `SmartBasket-Advanced` folder in VS Code.
2. Open a terminal in `backend`: `cd backend`
3. Run `npm install`
4. Copy `.env.example` to `.env` and fill in your MongoDB Atlas URI. For local ESP32 testing, set `ESP32_URL=http://ESP32_LOCAL_IP`.
5. Run `npm start`; check `http://localhost:5000/api/health`.
6. Install the VS Code Live Server extension, then open `frontend/index.html` with Live Server.
7. In `frontend/js/config.js`, set `BACKEND_URL` to `http://localhost:5000` for laptop-only testing, or `http://LAPTOP_IP:5000` for another device on the same Wi-Fi.

## 2. Deploy backend to Render
1. Push the extracted project to a GitHub repository.
2. In Render choose **New + → Blueprint** and select the repository; it reads `render.yaml`. Alternatively create a Web Service with root directory `backend`, build command `npm install`, start command `npm start`.
3. In Render environment variables, set `MONGODB_URI` to the MongoDB Atlas connection string. Leave `ESP32_URL` unset for cloud-only product lookup, or use it only if the target is publicly reachable and secured. A private `192.168.x.x` address will not be reachable from Render.
4. Wait for deploy and test `https://YOUR-RENDER-SERVICE.onrender.com/api/health`. A successful response should include `ok: true` and `mongo: true`.

## 3. Deploy frontend to Vercel
1. In Vercel import the same GitHub repository. Set the **Root Directory** to `frontend`; use the static/default framework setting (no build command needed).
2. After Render deploys, edit `frontend/js/config.js` in GitHub/VS Code to use `const BACKEND_URL = "https://YOUR-RENDER-SERVICE.onrender.com";` and push the change. Redeploy Vercel.
3. Open the Vercel HTTPS URL on your phone, allow camera permission, register/login, then capture and verify the printed barcode digits.

## 4. Add a product to MongoDB
Use Postman or curl to call `POST https://YOUR-RENDER-SERVICE.onrender.com/api/products` with JSON body:
```json
{
  "barcode": "8901234567890",
  "name": "Sample Biscuit",
  "price": 25,
  "category": "Snacks"
}
```
Use a real barcode and the matching product information for your demo. Never store passwords or real OTPs in browser localStorage in a production app.

## Important mobile + ESP32 limitation
The Vercel/Render deployment supports the mobile HTTPS camera, OCR and MongoDB product lookup. Render cannot call an ESP32 on a private home/college Wi-Fi address. To show cloud-scanned products on the physical LCD while using the hosted app, add a secure outbound bridge (for example, a small service on the same Wi-Fi that polls Render for queued commands and forwards them to ESP32, or an MQTT broker). The current simple local demo sends directly to ESP32 when the backend and ESP32 are on the same LAN. Do not expose the ESP32 directly to the public internet.

## Camera note
Mobile camera access generally requires HTTPS or localhost. The Vercel URL is HTTPS, so it is the recommended way to test camera capture on a phone. OCR can still fail on blurred, tilted, reflective, or very small digits; retake and confirm the digits before sending.


## Basket Selection update
- Deploy the `backend` folder to the same Render service and keep the existing MongoDB Atlas environment variable `MONGODB_URI`.
- Set `frontend/js/config.js` to the real Render base URL, for example `https://your-real-service-name.onrender.com` (do not leave the placeholder).
- Redeploy the existing Vercel frontend with `frontend` as the existing root directory.
- Open `/api/health` on Render and confirm `mongo: true`, then open `/api/baskets` and confirm B1–B5 are returned.
- Basket status is stored in MongoDB collection `baskets`; an available basket is atomically changed to `In Use` when selected. The release API is available at `POST /api/baskets/:id/release` and requires the matching `sessionId`.
