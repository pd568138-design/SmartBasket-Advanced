SMART BASKET ADVANCED

Flow: Register -> demo OTP -> Login -> Dashboard/Basket ID -> phone camera capture -> image preprocessing (crop, grayscale, contrast stretch, threshold, upscale) -> digits-only OCR -> user verifies digits -> Node backend -> MongoDB Atlas product lookup -> ESP32 -> 20x4 LCD.

Backend setup (PowerShell): cd backend; npm install; copy .env.example .env; edit .env; npm start. Set MONGODB_URI to your Atlas connection and ESP32_URL=http://ESP32_IP. Test http://localhost:5000/api/health.

Frontend: open frontend/index.html using VS Code Live Server. For phone access, set frontend/js/config.js BACKEND_URL to http://LAPTOP_IP:5000 and use laptop IPv4 from ipconfig. Camera generally requires HTTPS or localhost; LAN HTTP may be blocked by mobile browser.

ESP32: open esp32/Smart_Basket_ESP32.ino in Arduino IDE, install ESP32 board package and LiquidCrystal_I2C library, enter Wi-Fi credentials, upload, Serial Monitor 115200. Set its IP in backend/.env. Laptop, phone and ESP32 should share Wi-Fi for local testing. A normal Render service cannot reach a private 192.168.x.x ESP32 IP.

MongoDB: create Atlas database smartbasket. Add products using POST /api/products with JSON {"barcode":"8901234567890","name":"Sample Biscuit","price":25,"category":"Snacks"}. Replace sample barcode with real product code.

LCD I2C: SDA GPIO21, SCL GPIO22, GND GND, VCC as required by module. Protect ESP32 I2C pins from 5V pull-ups if the backpack uses 5V.

Demo OTP is displayed on screen, not sent by SMS. Frontend demo credentials are localStorage-only and not production secure. OCR cannot guarantee recovery from severe blur; retake when digits are unclear.


Deployment guide: see `DEPLOYMENT.md` for VS Code local run, Render backend, Vercel frontend, phone camera testing, and the ESP32 cloud limitation.
