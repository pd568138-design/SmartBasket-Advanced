/*
  SMART BASKET - ESP32 (cloud polling version)
  ------------------------------------------------------------------
  Libraries (Arduino IDE -> Library Manager):
    1. "LiquidCrystal I2C"  by Frank de Brabander
    2. "ArduinoJson"        by Benoit Blanchon  (version 7.x)
  Board: "ESP32 Dev Module"

  Wiring:
    LCD 20x4 I2C : SDA -> GPIO21, SCL -> GPIO22, VCC, GND
    FINISH button: one leg -> GPIO4, other leg -> GND  (internal pull-up used)

  Flow:
    phone scans -> Render backend -> MongoDB product lookup -> queue
    ESP32 asks Render every 3 s "any new items for my basket?"  (HTTPS GET)
    ESP32 keeps the products in its own list, shows them on the LCD one by one,
    calculates the total, and when FINISH is pressed it replays the list on the LCD,
    stops on the final bill, then POSTs the order (name, items, total, date/time, location)
    to Render, which saves it in MongoDB Atlas for the cashier.

  Flash a DIFFERENT BASKET_ID (B1..B5) into each basket's ESP32.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>

// ======================= EDIT THESE =======================
const char* WIFI_SSID   = "YOUR_WIFI_NAME";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL  = "https://YOUR-RENDER-SERVICE.onrender.com";  // no trailing slash
const char* DEVICE_KEY  = "change-this-device-key-123";                // same as DEVICE_KEY on Render
const char* BASKET_ID   = "B1";                                        // B1..B5
const int   LCD_ADDR    = 0x27;                                        // try 0x3F if LCD stays blank
const int   BTN_FINISH  = 4;
// ==========================================================

const long  GMT_OFFSET_SEC = 19800;     // India UTC+5:30
const unsigned long POLL_MS       = 3000;
const unsigned long ITEM_SHOW_MS  = 2500;   // new item popup time
const unsigned long REVIEW_STEP_MS = 2500;  // review one-by-one step

LiquidCrystal_I2C lcd(LCD_ADDR, 20, 4);

// ---------- cart list kept INSIDE the ESP32 ----------
const int MAX_ITEMS = 40;
struct Item { char barcode[16]; char name[24]; float price; int qty; };
Item items[MAX_ITEMS];
int   itemCount = 0;
float total = 0;

enum State { ST_IDLE, ST_SHOPPING, ST_REVIEW, ST_DONE };
State state = ST_IDLE;

String sessionId = "";
String customer  = "";
String locationTxt = "";
long   lastSeq = 0;
bool   saved = false;
String billTime = "";

unsigned long lastPoll = 0, popupUntil = 0, reviewNext = 0, lastSaveTry = 0, lastWifiTry = 0;
int reviewIdx = 0;
bool popupActive = false;

// ---------- LCD helpers ----------
void line(int r, String t) {
  if (t.length() > 20) t = t.substring(0, 20);
  while (t.length() < 20) t += ' ';
  lcd.setCursor(0, r); lcd.print(t);
}
void show(String a, String b = "", String c = "", String d = "") { line(0, a); line(1, b); line(2, c); line(3, d); }
String money(float v) { return "Rs." + String(v, 2); }

String nowStr() {   // "2026-10-13 14:35:20" (IST). Falls back to uptime if NTP not ready.
  struct tm t;
  if (getLocalTime(&t, 50)) { char b[24]; strftime(b, sizeof(b), "%Y-%m-%d %H:%M:%S", &t); return String(b); }
  return "NTP-pending";
}
String nowShort() {  // "13/10 14:35"
  struct tm t;
  if (getLocalTime(&t, 50)) { char b[16]; strftime(b, sizeof(b), "%d/%m %H:%M", &t); return String(b); }
  return "--/-- --:--";
}

void showSummary() {
  show(String(BASKET_ID) + " Hi " + customer,
       "Items: " + String(itemCount),
       "Total: " + money(total),
       "Scan / Press=FINISH");
}
void showIdle() {
  show("SMART BASKET " + String(BASKET_ID), "Ready - select this", "basket on your phone", nowShort());
}

// ---------- list handling & calculation ----------
void resetList() { itemCount = 0; total = 0; lastSeq = 0; saved = false; popupActive = false; reviewIdx = 0; }

void recalcTotal() {
  float t = 0;
  for (int i = 0; i < itemCount; i++) t += items[i].price * items[i].qty;
  total = roundf(t * 100.0f) / 100.0f;
}

void addItem(const char* barcode, const char* name, float price) {
  if (itemCount >= MAX_ITEMS) return;
  Item &it = items[itemCount++];
  strlcpy(it.barcode, barcode, sizeof(it.barcode));
  strlcpy(it.name, name, sizeof(it.name));
  it.price = price; it.qty = 1;
  recalcTotal();
  // one-by-one popup on the LCD
  show("ITEM " + String(itemCount) + " ADDED", String(it.name), money(price) + " x1", "Total " + money(total));
  popupActive = true; popupUntil = millis() + ITEM_SHOW_MS;
  Serial.printf("Added #%d %s %.2f | total %.2f\n", itemCount, it.name, price, total);
}

// ---------- network ----------
bool httpsGet(const String& path, String& out) {
  WiFiClientSecure client; client.setInsecure();   // demo: skips certificate check
  HTTPClient http; http.setTimeout(15000);
  if (!http.begin(client, String(SERVER_URL) + path)) return false;
  http.addHeader("x-api-key", DEVICE_KEY);
  int code = http.GET();
  if (code == 200) out = http.getString();
  else Serial.printf("GET %s -> %d\n", path.c_str(), code);
  http.end();
  return code == 200;
}

bool httpsPost(const String& path, const String& body) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http; http.setTimeout(15000);
  if (!http.begin(client, String(SERVER_URL) + path)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_KEY);
  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("POST %s -> %d %s\n", path.c_str(), code, resp.c_str());
  return code == 200 && resp.indexOf("\"success\":true") >= 0;
}

void pollServer() {
  String path = String("/api/esp32/poll?basketId=") + BASKET_ID + "&session=" + sessionId + "&after=" + String(lastSeq);
  String body;
  if (!httpsGet(path, body)) return;

  JsonDocument doc;
  if (deserializeJson(doc, body)) { Serial.println("JSON error"); return; }
  String status = doc["status"] | "Available";

  if (status != "In Use") {
    // basket released (cashier reset / timeout) while shopping -> go idle. DONE screen is kept on purpose.
    if (state == ST_SHOPPING) { state = ST_IDLE; sessionId = ""; resetList(); showIdle(); }
    return;
  }
  String sid = doc["sessionId"] | "";
  if (sid != sessionId) {                          // NEW customer picked this basket
    resetList();
    sessionId = sid;
    customer = String((const char*)(doc["customer"] | "Guest"));
    state = ST_SHOPPING;
    show("WELCOME", customer, "Basket " + String(BASKET_ID), "Scan your products");
    popupActive = true; popupUntil = millis() + 2500;
  }
  if (state != ST_SHOPPING) return;
  locationTxt = String((const char*)(doc["location"] | ""));

  for (JsonObject it : doc["items"].as<JsonArray>()) {
    long seq = it["seq"] | 0;
    if (seq <= lastSeq) continue;
    lastSeq = seq;
    addItem(it["barcode"] | "", it["name"] | "Item", it["price"] | 0.0f);
    delay(ITEM_SHOW_MS);                            // simple: show each new item before the next
    popupActive = false;
  }
}

bool sendCheckout() {
  JsonDocument d;
  d["basketId"] = BASKET_ID;
  d["sessionId"] = sessionId;
  d["customer"] = customer;
  d["location"] = locationTxt;
  d["datetime"] = billTime;
  d["total"] = total;
  JsonArray arr = d["items"].to<JsonArray>();
  for (int i = 0; i < itemCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["barcode"] = items[i].barcode; o["name"] = items[i].name;
    o["price"] = items[i].price;     o["qty"] = items[i].qty;
  }
  String body; serializeJson(d, body);
  return httpsPost("/api/esp32/checkout", body);
}

// ---------- states ----------
void startReview() {
  state = ST_REVIEW; reviewIdx = 0; reviewNext = 0; popupActive = false;
}
void finishBill() {
  recalcTotal();
  billTime = nowStr();
  state = ST_DONE; saved = false; lastSaveTry = 0;
  show("BILL " + String(BASKET_ID) + " " + nowShort(), "Items: " + String(itemCount), "TOTAL " + money(total), "Saving to cashier..");
}

bool buttonPressed() {
  static int last = HIGH; static unsigned long t = 0;
  int v = digitalRead(BTN_FINISH);
  if (v != last && millis() - t > 60) { t = millis(); last = v; if (v == LOW) return true; }
  return false;
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_FINISH, INPUT_PULLUP);
  Wire.begin(21, 22);
  lcd.init(); lcd.backlight();
  show("SMART BASKET " + String(BASKET_ID), "Connecting Wi-Fi...");
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nIP: " + WiFi.localIP().toString());
  configTime(GMT_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");
  show("SMART BASKET " + String(BASKET_ID), "Wi-Fi connected", WiFi.localIP().toString(), "Syncing time...");
  delay(1200);
  showIdle();
}

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiTry > 10000) { lastWifiTry = now; WiFi.reconnect(); }
    return;
  }

  if (buttonPressed() && state == ST_SHOPPING && itemCount > 0) startReview();

  switch (state) {
    case ST_IDLE:
    case ST_SHOPPING:
      if (popupActive && now > popupUntil) { popupActive = false; (state == ST_SHOPPING) ? showSummary() : showIdle(); }
      if (now - lastPoll > POLL_MS) { lastPoll = now; pollServer(); if (state == ST_SHOPPING && !popupActive) showSummary(); else if (state == ST_IDLE) showIdle(); }
      break;

    case ST_REVIEW:   // replay the list ONE BY ONE with running total, then stop on the bill
      if (now >= reviewNext) {
        if (reviewIdx < itemCount) {
          float running = 0;
          for (int i = 0; i <= reviewIdx; i++) running += items[i].price * items[i].qty;
          show("REVIEW " + String(reviewIdx + 1) + "/" + String(itemCount), String(items[reviewIdx].name),
               money(items[reviewIdx].price) + " x" + String(items[reviewIdx].qty), "Running " + money(running));
          reviewIdx++; reviewNext = now + REVIEW_STEP_MS;
        } else {
          finishBill();
        }
      }
      break;

    case ST_DONE:     // LCD STOPS on final bill; upload to MongoDB (retry until saved)
      if (!saved && now - lastSaveTry > 4000) {
        lastSaveTry = now;
        saved = sendCheckout();
        show("BILL " + String(BASKET_ID) + " " + nowShort(), "Items: " + String(itemCount) + " " + customer,
             "TOTAL " + money(total), saved ? "Saved! Pay at counter" : "Retry saving...");
      }
      // after saving, keep polling slowly so the NEXT customer's session resets this screen
      if (saved && now - lastPoll > POLL_MS) { lastPoll = now; pollServer(); }
      break;
  }
}
