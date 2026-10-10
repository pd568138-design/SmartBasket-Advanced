#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
const char* WIFI_SSID="YOUR_WIFI_NAME";
const char* WIFI_PASSWORD="YOUR_WIFI_PASSWORD";
const char* BASKET_ID="B001";
LiquidCrystal_I2C lcd(0x27,20,4);WebServer server(80);float total=0;int items=0;
void line(int r,String t){lcd.setCursor(0,r);if(t.length()>20)t=t.substring(0,20);while(t.length()<20)t+=" ";lcd.print(t);}
void show(String a,String b,String c,String d){lcd.clear();line(0,a);line(1,b);line(2,c);line(3,d);}
void root(){server.send(200,"text/plain","Smart Basket "+String(BASKET_ID));}
void product(){if(!server.hasArg("name")||!server.hasArg("price")){server.send(400,"text/plain","Missing product details");return;}String code=server.hasArg("barcode")?server.arg("barcode"):"";String name=server.arg("name");float price=server.arg("price").toFloat();int qty=server.hasArg("qty")?server.arg("qty").toInt():1;if(qty<1)qty=1;total+=price*qty;items+=qty;Serial.println("Basket: "+String(BASKET_ID));Serial.println("Barcode: "+code);Serial.println("Product: "+name);Serial.println("Price: Rs."+String(price,2));Serial.println("Items: "+String(items));Serial.println("Total: Rs."+String(total,2));show("Basket: "+String(BASKET_ID),name,"Price Rs."+String(price,2),"Total Rs."+String(total,2));server.send(200,"application/json","{\"success\":true}");}
void checkout(){show("CHECKOUT","Items: "+String(items),"Total Rs."+String(total,2),"Thank You!");server.send(200,"application/json","{\"success\":true}");total=0;items=0;}
void setup(){Serial.begin(115200);Wire.begin(21,22);lcd.init();lcd.backlight();show("SMART BASKET","Basket: B001","Connecting Wi-Fi","");WiFi.begin(WIFI_SSID,WIFI_PASSWORD);while(WiFi.status()!=WL_CONNECTED){delay(500);Serial.print(".");}Serial.println();Serial.print("ESP32 IP: ");Serial.println(WiFi.localIP());show("SMART BASKET","Wi-Fi connected",WiFi.localIP().toString(),"Starting server");server.on("/",HTTP_GET,root);server.on("/product",HTTP_GET,product);server.on("/checkout",HTTP_GET,checkout);server.begin();delay(1200);show("SMART BASKET","Basket: B001","READY","Capture product");}
void loop(){server.handleClient();}