/*
  ================================================================
  InstaPay — Arduino RFID POS Terminal  (FIXED v2)
  ================================================================
  Hardware:
    - MFRC522 RFID reader   (SS=10, RST=9)
    - 4×4 Matrix Keypad     (rows=2,3,4,5 / cols=6,7,8,A0)
    - 16×2 I2C LCD          (address 0x27)

  Wiring:
    MFRC522 → Arduino Uno
      SDA  → pin 10
      SCK  → pin 13
      MOSI → pin 11
      MISO → pin 12
      RST  → pin 9
      3.3V → 3.3V
      GND  → GND

    Keypad rows  → pins 2, 3, 4, 5
    Keypad cols  → pins 6, 7, 8, A0

    LCD I2C SDA  → A4
    LCD I2C SCL  → A5

  RFID FORMAT: NN-NNNN-NNNNNN (12 decimal digits with dashes)
  HOW TO GET YOUR CARD UIDs:
    1. Upload sketch, open Serial Monitor at 9600 baud
    2. Tap white card → copy RFID:XX-XXXX-XXXXXX
    3. Tap blue card  → copy RFID:XX-XXXX-XXXXXX
    4. Use those exact strings when registering users in the app

  SERIAL PROTOCOL
  Arduino → Flask:
    STALL:<key>              on boot
    RFID:<uid>               card tapped
    KEY:<char>               keypad debug
    ITEMLOOKUP:<code>        look up item
    ADDITEM:<code>           add item to order
    AWAITING_PAYMENT:<total> ready for card tap
    CONFIRMPAY:<rfid>        process payment
    ORDER:CANCEL
    ORDER:CANCEL_PAYMENT
    ORDER:CANCEL_CONFIRM

  Flask → Arduino:
    ITEMINFO:<name>:<price>
    ITEMNOTFOUND
    CARDINFO:<name>:<balance>
    PAYOK:<newbalance>
    PAYFAIL:INSUFFICIENT
    PAYFAIL:NOTFOUND
    PAYFAIL:NOORDER
    PAYFAIL:ERROR
  ================================================================
*/

#include <SPI.h>
#include <MFRC522.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ── Configuration ─────────────────────────────────────────────
#define STALL_KEY    'A'    // Change to 'B', 'C', or 'D' for other terminals
#define BAUD_RATE    9600
#define RFID_SS_PIN  10
#define RFID_RST_PIN 9

// ── Peripherals ───────────────────────────────────────────────
MFRC522          rfid(RFID_SS_PIN, RFID_RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ── Keypad ────────────────────────────────────────────────────
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[4] = {2, 3, 4, 5};
byte colPins[4] = {6, 7, 8, A0};
Keypad kp = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ── State machine ─────────────────────────────────────────────
enum State {
  S_WELCOME,
  S_ITEM_CODE,
  S_WAIT_ITEM,
  S_CONFIRM_ITEM,
  S_CONFIRM_ORDER,
  S_AWAIT_RFID,
  S_WAIT_CARDINFO,
  S_PAY_CONFIRM,
  S_PROCESSING,
  S_SUCCESS,
  S_INSUFFICIENT,
  S_NOT_FOUND
};

State  state         = S_WELCOME;
String kpBuffer      = "";
String lastItemName  = "";
float  lastItemPrice = 0.0;
int    lastItemCode  = 0;
float  orderTotal    = 0.0;
int    itemCount     = 0;
String cardUID       = "";
String cardName      = "";
float  cardBalance   = 0.0;

unsigned long stateTimer = 0;
String        serialBuf  = "";

// ── LCD helpers ───────────────────────────────────────────────
void lcdPrint(String line1, String line2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  while (line1.length() < 16) line1 += ' ';
  lcd.print(line1.substring(0, 16));
  if (line2.length() > 0) {
    lcd.setCursor(0, 1);
    while (line2.length() < 16) line2 += ' ';
    lcd.print(line2.substring(0, 16));
  }
}

String fmtPrice(float p) {
  char buf[12];
  dtostrf(p, 1, 2, buf);
  return String(buf);
}

// ── RFID UID formatter ────────────────────────────────────────
// Each byte printed as 2-digit DECIMAL (not hex), zero-padded.
// Result: NN-NNNN-NNNNNN — matches MySQL users.rfid exactly.
String formatRFID(MFRC522::Uid uid) {
  String digits = "";
  for (byte i = 0; i < uid.size; i++) {
    char tmp[4];
    sprintf(tmp, "%02d", (int)uid.uidByte[i]);   // decimal, NOT hex
    digits += String(tmp);
  }
  while (digits.length() < 12) digits += "0";
  digits = digits.substring(0, 12);
  return digits.substring(0,2) + "-" + digits.substring(2,6) + "-" + digits.substring(6,12);
}

// ── Full reset to welcome screen ──────────────────────────────
void resetToWelcome() {
  state         = S_WELCOME;
  kpBuffer      = "";
  lastItemName  = "";
  lastItemPrice = 0.0;
  lastItemCode  = 0;
  orderTotal    = 0.0;
  itemCount     = 0;
  cardUID       = "";
  cardName      = "";
  cardBalance   = 0.0;
  lcdPrint("  InstaPay  ", "Press A to start");
}

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(BAUD_RATE);
  SPI.begin();
  rfid.PCD_Init();
  lcd.init();
  lcd.backlight();

  // Identify this terminal's stall to Flask on boot
  Serial.print("STALL:");
  Serial.println(STALL_KEY);

  resetToWelcome();
}

// ─────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────
void loop() {

  // Auto-clear success/error screens after 3 seconds
  if ((state == S_SUCCESS || state == S_INSUFFICIENT || state == S_NOT_FOUND)
      && millis() - stateTimer > 3000) {
    resetToWelcome();
    return;
  }

  // Keypad
  char key = kp.getKey();
  if (key) {
    Serial.print("KEY:");
    Serial.println(key);
    handleKey(key);
  }

  // RFID reader
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String uid = formatRFID(rfid.uid);
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    // Always print — use this to get your card's UID for registration
    Serial.print("RFID:");
    Serial.println(uid);

    // Only act during payment flow
    if (state == S_AWAIT_RFID) {
      cardUID = uid;
      state   = S_WAIT_CARDINFO;
      lcdPrint("Card detected...", "Please wait...  ");
    }
  }

  // Incoming serial from Flask
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialBuf.trim();
      if (serialBuf.length() > 0) handleSerialIn(serialBuf);
      serialBuf = "";
    } else if (c != '\r') {
      serialBuf += c;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// HANDLE INCOMING SERIAL FROM FLASK
// ─────────────────────────────────────────────────────────────
void handleSerialIn(String line) {

  // ITEMINFO:<name>:<price>
  if (line.startsWith("ITEMINFO:")) {
    String rest = line.substring(9);
    int sep = rest.lastIndexOf(':');
    if (sep > 0) {
      lastItemName  = rest.substring(0, sep);
      lastItemPrice = rest.substring(sep + 1).toFloat();
      state = S_CONFIRM_ITEM;
      lcdPrint(lastItemName.substring(0, 16),
               "P" + fmtPrice(lastItemPrice) + " *No #Yes");
    }
    return;
  }

  // ITEMNOTFOUND
  if (line == "ITEMNOTFOUND") {
    lcdPrint("Item not found! ", "Try another code");
    delay(1800);
    state    = S_ITEM_CODE;
    kpBuffer = "";
    lcdPrint("Item code:      ", "_               ");
    return;
  }

  // CARDINFO:<name>:<balance>
  if (line.startsWith("CARDINFO:")) {
    String rest = line.substring(9);
    int sep = rest.lastIndexOf(':');
    if (sep > 0) {
      cardName    = rest.substring(0, sep);
      cardBalance = rest.substring(sep + 1).toFloat();
      state = S_PAY_CONFIRM;
      lcdPrint(cardName.substring(0, 16), "*=Cancel #=Pay  ");
    }
    return;
  }

  // PAYOK:<newbalance>
  if (line.startsWith("PAYOK:")) {
    float newBal = line.substring(6).toFloat();
    state        = S_SUCCESS;
    stateTimer   = millis();
    lcdPrint("Payment Success!");
    return;
  }

  // PAYFAIL:INSUFFICIENT
  if (line == "PAYFAIL:INSUFFICIENT") {
    state      = S_INSUFFICIENT;
    stateTimer = millis();
    lcdPrint("Insuf. Balance! ", "Tap another card");
    delay(2500);
    if (state == S_INSUFFICIENT) {
      cardUID     = "";
      cardName    = "";
      cardBalance = 0.0;
      state       = S_AWAIT_RFID;
      lcdPrint("Total:P" + fmtPrice(orderTotal), "Tap RFID card...");
    }
    return;
  }

  // PAYFAIL:NOTFOUND
  if (line == "PAYFAIL:NOTFOUND") {
    state      = S_NOT_FOUND;
    stateTimer = millis();
    lcdPrint("Card not found! ", "Tap another card");
    delay(2500);
    if (state == S_NOT_FOUND) {
      cardUID     = "";
      cardName    = "";
      cardBalance = 0.0;
      state       = S_AWAIT_RFID;
      lcdPrint("Total:P" + fmtPrice(orderTotal), "Tap RFID card...");
    }
    return;
  }

  // PAYFAIL:NOORDER — order ex