#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <ArduinoJson.h>

// ================= EDIT THESE =================
const char* WIFI_SSID  = "YOUR_WIFI_NAME";
const char* WIFI_PASS  = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "https://YOUR-RENDER-SERVICE.onrender.com";  // no trailing /
const char* DEVICE_KEY = "basket-device-2026";                        // same as Render DEVICE_KEY
const char* BASKET_ID  = "B1";                                        // B1..B5 (different per ESP32)
const uint8_t LCD_ADDR = 0x27;                                        // try 0x3F if LCD is blank
const int   BTN_FINISH = 4;
// ==============================================

const long GMT_OFFSET_SEC = 19800;          // India UTC+5:30
const unsigned long POLL_MS = 3000;

/* ---------- LCD 20x4 over I2C without any library (PCF8574 backpack) ---------- */
#define LCD_RS 0x01
#define LCD_EN 0x04
#define LCD_BL 0x08
void expWrite(uint8_t d) { Wire.beginTransmission(LCD_ADDR); Wire.write(d | LCD_BL); Wire.endTransmission(); }
void write4(uint8_t nibble, uint8_t rs) {
  uint8_t d = (nibble & 0xF0) | rs;
  expWrite(d | LCD_EN); delayMicroseconds(2);
  expWrite(d & ~LCD_EN); delayMicroseconds(60);
}
void lcdSend(uint8_t v, uint8_t rs) { write4(v & 0xF0, rs); write4((v << 4) & 0xF0, rs); }
void lcdCmd(uint8_t c) { lcdSend(c, 0); if (c < 4) delay(3); }
void lcdInit() {
  delay(50); expWrite(0); delay(10);
  write4(0x30, 0); delay(5);
  write4(0x30, 0); delay(5);
  write4(0x30, 0); delayMicroseconds(200);
  write4(0x20, 0); delayMicroseconds(200);
  lcdCmd(0x28); lcdCmd(0x0C); lcdCmd(0x06); lcdCmd(0x01);
}
void lcdSetCursor(uint8_t col, uint8_t row) {
  static const uint8_t off[4] = {0x00, 0x40, 0x14, 0x54};
  lcdCmd(0x80 | (off[row] + col));
}
void lcdPrint(const String& s) { for (size_t i = 0; i < s.length(); i++) lcdSend((uint8_t)s[i], LCD_RS); }
void line(int r, String t) {
  if (t.length() > 20) t = t.substring(0, 20);
  while (t.length() < 20) t += ' ';
  lcdSetCursor(0, r); lcdPrint(t);
}
void show(String a, String b = "", String c = "", String d = "") { line(0, a); line(1, b); line(2, c); line(3, d); }
/* ----------------------------------------------------------------------------- */

// list kept inside the ESP32
const int MAX_ITEMS = 40;
struct Item { char barcode[16]; char name[24]; float price; int qty; };
Item items[MAX_ITEMS];
int   itemCount = 0;
float total = 0;

enum State { ST_IDLE, ST_SHOPPING, ST_DONE };
State state = ST_IDLE;
String sessionId = "", customer = "", locationTxt = "", billTime = "";
long   lastSeq = 0;
bool   saved = false;
unsigned long lastPoll = 0, lastSaveTry = 0, lastWifiTry = 0;

String money(float v) { return "Rs." + String(v, 2); }
String nowStr() {
  struct tm t;
  if (getLocalTime(&t, 50)) { char b[24]; strftime(b, sizeof(b), "%Y-%m-%d %H:%M:%S", &t); return String(b); }
  return "NTP-pending";
}
String nowShort() {
  struct tm t;
  if (getLocalTime(&t, 50)) { char b[16]; strftime(b, sizeof(b), "%d/%m %H:%M", &t); return String(b); }
  return "--/-- --:--";
}

// ---- calculation (all inside ESP32) ----
void recalcTotal() {
  float t = 0;
  for (int i = 0; i < itemCount; i++) t += items[i].price * items[i].qty;
  total = roundf(t * 100.0f) / 100.0f;
}
void resetList() { itemCount = 0; total = 0; lastSeq = 0; saved = false; }
void addItem(const char* barcode, const char* name, float price) {
  if (itemCount >= MAX_ITEMS) return;
  Item &it = items[itemCount++];
  strlcpy(it.barcode, barcode, sizeof(it.barcode));
  strlcpy(it.name, name, sizeof(it.name));
  it.price = price; it.qty = 1;
  recalcTotal();                         // no details on LCD, only counted
}

// ---- screens ----
void showIdle()     { show("SMART BASKET " + String(BASKET_ID), "Ready", "Select this basket", "on your phone"); }
void showShopping() { show("Hi " + customer, "Products scanned: " + String(itemCount), "", "Press FINISH = bill"); }
void drawBill(String status) {
  show("TOTAL BILL", money(total), "Items:" + String(itemCount) + " " + nowShort(), status);
}

// ---- network ----
bool httpsGet(const String& path, String& out) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http; http.setTimeout(15000);
  if (!http.begin(client, String(SERVER_URL) + path)) return false;
  http.addHeader("x-api-key", DEVICE_KEY);
  int code = http.GET();
  if (code == 200) out = http.getString(); else Serial.printf("GET -> %d\n", code);
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
  Serial.printf("POST -> %d %s\n", code, resp.c_str());
  return code == 200 && resp.indexOf("\"success\":true") >= 0;
}

void pollServer() {
  String path = String("/api/esp32/poll?basketId=") + BASKET_ID + "&session=" + sessionId + "&after=" + String(lastSeq);
  String body;
  if (!httpsGet(path, body)) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  String status = doc["status"] | "Available";
  if (status != "In Use") {
    if (state == ST_SHOPPING) { state = ST_IDLE; sessionId = ""; resetList(); showIdle(); }
    return;                               // DONE screen stays
  }
  String sid = doc["sessionId"] | "";
  if (sid != sessionId) {                 // new customer started this basket
    resetList();
    sessionId = sid;
    customer = String((const char*)(doc["customer"] | "Guest"));
    state = ST_SHOPPING;
    showShopping();
  }
  if (state != ST_SHOPPING) return;
  locationTxt = String((const char*)(doc["location"] | ""));

  bool added = false;
  for (JsonObject it : doc["items"].as<JsonArray>()) {
    long seq = it["seq"] | 0;
    if (seq <= lastSeq) continue;
    lastSeq = seq;
    addItem(it["barcode"] | "", it["name"] | "Item", it["price"] | 0.0f);
    added = true;
  }
  if (added) showShopping();
}

bool sendCheckout() {                     // saves the bill in MongoDB Atlas
  JsonDocument d;
  d["basketId"] = BASKET_ID; d["sessionId"] = sessionId; d["customer"] = customer;
  d["location"] = locationTxt; d["datetime"] = billTime; d["total"] = total;
  JsonArray arr = d["items"].to<JsonArray>();
  for (int i = 0; i < itemCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["barcode"] = items[i].barcode; o["name"] = items[i].name;
    o["price"] = items[i].price;     o["qty"] = items[i].qty;
  }
  String body; serializeJson(d, body);
  return httpsPost("/api/esp32/checkout", body);
}

void finishBill() {
  recalcTotal();
  billTime = nowStr();
  state = ST_DONE; saved = false; lastSaveTry = 0;
  drawBill("Saving...");
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
  lcdInit();
  show("SMART BASKET " + String(BASKET_ID), "Connecting Wi-Fi...");
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  configTime(GMT_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");
  show("SMART BASKET " + String(BASKET_ID), "Wi-Fi connected", WiFi.localIP().toString());
  delay(1200);
  showIdle();
}

void loop() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiTry > 10000) { lastWifiTry = now; WiFi.reconnect(); }
    return;
  }
  if (buttonPressed() && state == ST_SHOPPING && itemCount > 0) finishBill();

  if (state == ST_DONE && !saved) {       // retry until the bill is saved
    if (now - lastSaveTry > 4000) {
      lastSaveTry = now;
      saved = sendCheckout();
      drawBill(saved ? "Saved! Pay cashier" : "Retry saving...");
    }
  } else if (now - lastPoll > POLL_MS) {
    lastPoll = now;
    pollServer();
    if (state == ST_IDLE) showIdle();
  }
}
