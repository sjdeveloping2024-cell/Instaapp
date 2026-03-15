# InstaPay — Full System Setup Guide

## Project Structure

```
INSTAPAY_FULL/
├── backend/                  ← Flask Python API
│   ├── app.py                ← Main backend (updated with JWT auth)
│   ├── instapay_schema.sql   ← Database schema (v8, run this first)
│   ├── requirements.txt      ← Python dependencies
│   └── templates/
│       ├── user_app.html     ← Web preview of user app
│       ├── admin_dashboard.html
│       └── merchant.html
├── instapay_app/             ← React Native / Expo mobile app
│   ├── app/
│   │   ├── _layout.tsx       ← Root layout
│   │   ├── index.tsx         ← Login screen
│   │   ├── register.tsx      ← Register screen
│   │   ├── transfer.tsx      ← Transfer screen
│   │   └── (tabs)/
│   │       ├── _layout.tsx   ← Tab navigator
│   │       ├── home.tsx      ← Home + balance card
│   │       ├── transactions.tsx
│   │       ├── card.tsx
│   │       └── notifications.tsx
│   ├── constants/config.ts   ← ★ SET YOUR IP HERE ★
│   ├── services/api.ts       ← JWT-based API service
│   ├── services/socket.ts    ← Socket.IO real-time
│   ├── context/AuthContext.tsx
│   ├── package.json
│   ├── app.json
│   ├── babel.config.js
│   └── tsconfig.json
└── instapay_stall/
    └── instapay_stall.ino    ← Arduino POS terminal code
```

---

## STEP 1 — Set Up the Database

1. Open **MySQL Workbench**
2. File → Open SQL Script → select `backend/instapay_schema.sql`
3. Click the ⚡ lightning bolt (Execute All)
4. Verify output shows tables created and 2 seed users

**Default login:** PIN `1234` (fingerprint must be enrolled via the app first)

---

## STEP 2 — Set Up the Python Backend

### Prerequisites
- Python 3.8+
- MySQL running locally

### Install
```bash
cd backend
python -m venv venv

# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### Configure
Open `backend/app.py` and change these lines near the top:

```python
app.config['MYSQL_PASSWORD'] = 'YOUR_MYSQL_PASSWORD'   # line ~65
```

And at the very bottom:
```python
start_arduino('COM5')   # change to your COM port e.g. COM3, /dev/ttyUSB0
                        # or comment this line out if no Arduino connected
```

### Run
```bash
python app.py
```

Backend runs at: `http://localhost:5000`
- User app preview: `http://localhost:5000/`
- Admin dashboard: `http://localhost:5000/admin`  (admin / admin123)
- Merchant POS:    `http://localhost:5000/merchant`

---

## STEP 3 — Set Up the React Native App

### Prerequisites
- Node.js 18+
- Expo Go app installed on your Android/iOS phone
- Phone and PC on the **same WiFi network**

### ★ CRITICAL — Set Your IP Address ★

Find your PC's local IP:
- **Windows:** Open CMD → type `ipconfig` → look for **IPv4 Address** (e.g. 192.168.1.10)
- **Mac/Linux:** Open Terminal → type `ifconfig` → look for `inet` under en0/wlan0

Open `instapay_app/constants/config.ts` and change:
```typescript
export const BASE_URL = 'http://192.168.1.100:5000';
//                               ↑ replace with YOUR PC's IP
```

### Install Dependencies
```bash
cd instapay_app
npm install
npx expo install expo-local-authentication expo-linear-gradient @react-native-async-storage/async-storage
```

### Run
```bash
npx expo start
```

Scan the QR code with **Expo Go** on your phone.

---

## STEP 4 — First Time Login Flow

Since the seeded accounts have no fingerprint enrolled yet:

1. Open the app on your phone
2. Tap **Sign Up**
3. Enter:
   - Full Name: `White Card User`
   - ID Number: `11-9220-357300` (or your actual RFID card number)
   - Contact: any 09XXXXXXXXX number
   - Status: Student
   - PIN: `1234` → Confirm PIN: `1234`
4. Tap the fingerprint sensor → scan your thumb
5. Tap **Create Account**
6. You can now sign in with fingerprint + PIN `1234`

---

## System Architecture

```
Phone (Expo Go)
    ↕ HTTP/JWT (REST API)
    ↕ WebSocket (Socket.IO real-time)
Flask Backend (app.py) on port 5000
    ↕ SQL queries
MySQL Database (instapay)
    
Arduino (COM5) ← Serial → Flask Backend
    ↕ RFID tap
Physical RFID Cards (payments at canteen)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Network request failed` | Check BASE_URL IP in `constants/config.ts`. Phone and PC must be on same WiFi. |
| `Fingerprint not available` | On Android emulator/simulator, it uses a simulated token — this is normal. Works on real device. |
| `Module not found` errors | Run `npm install` then `npx expo install expo-local-authentication expo-linear-gradient @react-native-async-storage/async-storage` |
| Backend `ModuleNotFoundError` | Make sure venv is activated and `pip install -r requirements.txt` was run |
| Arduino not found | Change `COM5` to your port in `app.py`, or comment out `start_arduino(...)` to run without hardware |
| `Access-Control-Allow-Origin` error | Make sure you're using the updated `app.py` — it has CORS configured for mobile |

---

## What Changed from Original

| Original | Updated |
|---|---|
| Flask sessions (cookies) | JWT tokens — works with React Native |
| `password_hash` column | Removed — biometric + PIN only |
| `theme` / `accent` columns | Removed |
| Browser WebAuthn fingerprint | `expo-local-authentication` (real device fingerprint) |
| `localStorage` for bio token | `AsyncStorage` (React Native compatible) |
| Single HTML file | Full Expo Router multi-screen app |
