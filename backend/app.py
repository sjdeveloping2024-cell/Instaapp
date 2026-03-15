"""
InstaPay — Flask-SocketIO Backend  (app.py)
===========================================
Real-time events via Flask-SocketIO replace all HTTP polling.

Install dependencies:
  python -m pip install flask flask-cors flask-socketio pymysql pyserial

Run:
  python app.py

Pages:
  http://localhost:5000/           User app
  http://localhost:5000/merchant   Merchant POS
  http://localhost:5000/admin      Admin dashboard

Admin login:  admin / admin123
Card logins:  11-9220-357300 / password123   (white card)
              09-2401-082000 / password123   (blue tag)

Change your MySQL password on line ~55.
Change your COM port on the last line: start_arduino('COM5')
"""

from flask import Flask, request, jsonify, render_template, session, send_file, g
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from datetime import datetime
import pymysql, pymysql.cursors
import uuid, hashlib, os, threading, time, re, io

# ─────────────────────────────────────────────────────────────
# APP SETUP
# ─────────────────────────────────────────────────────────────
app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.environ.get('SECRET_KEY', 'instapay-secret-2025')
CORS(app, supports_credentials=True)

socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

# ── Admin ─────────────────────────────────────────────────────
ADMIN_USERNAME = os.environ.get('ADMIN_USER', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASS', 'admin123')

# ── Database config ────────────────────────────────────────────
DB_HOST = os.environ.get('MYSQL_HOST',     'localhost')
DB_USER = os.environ.get('MYSQL_USER',     'root')
DB_PASS = os.environ.get('MYSQL_PASSWORD', 'saquilon')   # ← YOUR PASSWORD HERE
DB_NAME = os.environ.get('MYSQL_DB',       'instapay')


# ─────────────────────────────────────────────────────────────
# PYMYSQL — one connection per Flask request (stored in g)
# ─────────────────────────────────────────────────────────────
def _new_conn():
    return pymysql.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS,
        database=DB_NAME, charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False
    )

def _get_conn():
    if 'db' not in g:
        g.db = _new_conn()
    return g.db

@app.teardown_appcontext
def _close_conn(exc):
    db = g.pop('db', None)
    if db:
        try: db.close()
        except: pass

def _cur():
    return _get_conn().cursor()

def _commit():
    _get_conn().commit()

def _thread_db():
    """Separate connection for background threads (Arduino reader)."""
    return _new_conn()


# ─────────────────────────────────────────────────────────────
# ARDUINO STATE
# ─────────────────────────────────────────────────────────────
_rfid_state: dict = {
    'admin': {'rfid': None, 'ts': 0},
    'A':     {'rfid': None, 'ts': 0},
    'B':     {'rfid': None, 'ts': 0},
    'C':     {'rfid': None, 'ts': 0},
    'D':     {'rfid': None, 'ts': 0},
}
_rfid_lock         = threading.Lock()
_arduino_connected = False
_serial_handle     = None
_serial_lock       = threading.Lock()


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def _now() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M')

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def _txn_id() -> str:
    return 'TXN-' + datetime.now().strftime('%Y%m%d%H%M%S') + '-' + uuid.uuid4().hex[:4].upper()

def _order_id() -> str:
    return 'ORD-' + datetime.now().strftime('%Y%m%d%H%M%S') + '-' + uuid.uuid4().hex[:4].upper()

def _withdrawal_id() -> str:
    return 'WDR-' + datetime.now().strftime('%Y%m%d%H%M%S') + '-' + uuid.uuid4().hex[:4].upper()

def _format_rfid(raw: str) -> str:
    raw = raw.strip()
    if re.match(r'^\d{2}-\d{4}-\d{6}$', raw):
        return raw
    digits = re.sub(r'\D', '', raw).zfill(12)[:12]
    return f"{digits[0:2]}-{digits[2:6]}-{digits[6:12]}"

def _ref_id() -> str:
    c = _cur()
    c.execute("SELECT COUNT(*) AS n FROM refills")
    return f"REF-{c.fetchone()['n']+1:04d}"

def _req_admin():
    if not session.get('admin'):
        return jsonify({'ok': False, 'error': 'Admin access required.'}), 401
    return None

def _req_user():
    rfid = session.get('user_rfid')
    if not rfid:
        return None, (jsonify({'ok': False, 'error': 'Not logged in.'}), 401)
    return rfid, None


# ─────────────────────────────────────────────────────────────
# SOCKET HELPERS
# ─────────────────────────────────────────────────────────────
def _emit(event: str, data: dict, room: str = None):
    try:
        if room:
            socketio.emit(event, data, room=room)
        else:
            socketio.emit(event, data)
    except Exception as e:
        print(f"[SocketIO] Emit error ({event}): {e}")


# ─────────────────────────────────────────────────────────────
# ARDUINO SERIAL BRIDGE
# ─────────────────────────────────────────────────────────────
def _serial_write(msg: str):
    global _serial_handle
    with _serial_lock:
        if _serial_handle and _serial_handle.is_open:
            try:
                _serial_handle.write((msg.rstrip('\n') + '\n').encode('utf-8'))
                print(f"[Arduino] <- {msg.strip()}")
            except Exception as e:
                print(f"[Arduino] Write error: {e}")


def _reconnect_db(old_db):
    try:
        if old_db: old_db.close()
    except: pass
    try:
        return _thread_db()
    except Exception as e:
        print(f"[Arduino] DB reconnect failed: {e}")
        return None


def _arduino_reader(port: str, baud: int = 9600):
    global _arduino_connected, _serial_handle

    stall_ctx: dict = {k: {'order_id': None, 'total': 0.0} for k in ('A','B','C','D')}
    current_stall = 'A'

    while True:
        db = None
        try:
            import serial as pyserial
            ser = pyserial.Serial(port, baud, timeout=2)
            with _serial_lock:
                _serial_handle = ser
            with _rfid_lock:
                _arduino_connected = True
            print(f"[Arduino] Connected on {port}")
            _emit('arduino_status', {'connected': True})
            db = _thread_db()

            while True:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if not line:
                    continue
                print(f"[Arduino] -> {line}")

                if line.startswith('STALL:'):
                    k = line[6:].strip().upper()
                    current_stall = k if k in stall_ctx else 'A'
                    print(f"[Arduino] Stall = '{current_stall}'")

                elif line.startswith('RFID:'):
                    rfid = _format_rfid(line[5:].strip())
                    key  = current_stall if current_stall in _rfid_state else 'admin'
                    with _rfid_lock:
                        _rfid_state[key] = {'rfid': rfid, 'ts': time.time()}
                    print(f"[Arduino] [{key}] Card tapped: {rfid}")
                    user_info = None
                    try:
                        with db.cursor() as c:
                            c.execute("SELECT name, balance, status FROM users WHERE rfid=%s", (rfid,))
                            u = c.fetchone()
                        if u:
                            user_info = {'name': u['name'], 'balance': float(u['balance']), 'status': u['status']}
                    except Exception as ex:
                        print(f"[Arduino] DB lookup error: {ex}")
                        db = _reconnect_db(db)
                    _emit('rfid_tapped', {'rfid': rfid, 'stall': key, 'user': user_info})
                    _emit('rfid_tapped', {'rfid': rfid, 'stall': key, 'user': user_info}, room='admin')
                    ctx = stall_ctx.get(current_stall, {})
                    if ctx.get('order_id'):
                        if user_info:
                            _serial_write(f"CARDINFO:{user_info['name']}:{user_info['balance']:.2f}")
                        else:
                            _serial_write("PAYFAIL:NOTFOUND")
                            _emit('payment_fail', {'rfid': rfid, 'stall': current_stall, 'reason': 'NOTFOUND'}, room=f'stall_{current_stall}')

                elif line.startswith('ITEMLOOKUP:'):
                    try:
                        code = int(line[11:].strip())
                    except ValueError:
                        _serial_write("ITEMNOTFOUND")
                        continue
                    try:
                        with db.cursor() as c:
                            c.execute(
                                "SELECT mi.name, mi.price FROM menu_items mi "
                                "JOIN stalls s ON s.id=mi.stall_id "
                                "WHERE s.stall_key=%s AND mi.item_code=%s AND mi.is_available=1",
                                (current_stall, code)
                            )
                            item = c.fetchone()
                        if item:
                            _serial_write(f"ITEMINFO:{item['name']}:{float(item['price']):.2f}")
                        else:
                            _serial_write("ITEMNOTFOUND")
                    except Exception as ex:
                        print(f"[Arduino] ITEMLOOKUP error: {ex}")
                        _serial_write("ITEMNOTFOUND")
                        db = _reconnect_db(db)

                elif line.startswith('ADDITEM:'):
                    try:
                        code = int(line[8:].strip())
                    except ValueError:
                        continue
                    try:
                        ctx = stall_ctx[current_stall]
                        if not ctx['order_id']:
                            with db.cursor() as c:
                                c.execute("SELECT id FROM stalls WHERE stall_key=%s", (current_stall,))
                                s = c.fetchone()
                            if s:
                                oid = _order_id()
                                with db.cursor() as c:
                                    c.execute(
                                        "INSERT INTO order_sessions (id,stall_id,status,total_amount,created_at) VALUES (%s,%s,'open',0,%s)",
                                        (oid, s['id'], _now())
                                    )
                                db.commit()
                                ctx['order_id'] = oid
                                ctx['total']    = 0.0
                        if ctx['order_id']:
                            with db.cursor() as c:
                                c.execute(
                                    "SELECT mi.* FROM menu_items mi JOIN stalls s ON s.id=mi.stall_id "
                                    "WHERE s.stall_key=%s AND mi.item_code=%s AND mi.is_available=1",
                                    (current_stall, code)
                                )
                                item = c.fetchone()
                            if item:
                                price = float(item['price'])
                                with db.cursor() as c:
                                    c.execute(
                                        "INSERT INTO order_items (order_session_id,menu_item_id,item_name,unit_price,quantity,subtotal) VALUES (%s,%s,%s,%s,1,%s)",
                                        (ctx['order_id'], item['id'], item['name'], price, price)
                                    )
                                    c.execute("UPDATE order_sessions SET total_amount=total_amount+%s WHERE id=%s", (price, ctx['order_id']))
                                db.commit()
                                ctx['total'] += price
                                _emit('order_updated', {
                                    'stall': current_stall, 'order_id': ctx['order_id'],
                                    'status': 'open', 'total': round(ctx['total'], 2),
                                    'last_item': item['name'], 'last_price': price,
                                }, room=f'stall_{current_stall}')
                    except Exception as ex:
                        print(f"[Arduino] ADDITEM error: {ex}")
                        try: db.rollback()
                        except: pass
                        db = _reconnect_db(db)

                elif line.startswith('AWAITING_PAYMENT:'):
                    ctx = stall_ctx.get(current_stall, {})
                    if ctx.get('order_id'):
                        try:
                            with db.cursor() as c:
                                c.execute("UPDATE order_sessions SET status='pending_payment' WHERE id=%s", (ctx['order_id'],))
                            db.commit()
                            _emit('order_updated', {
                                'stall': current_stall, 'order_id': ctx['order_id'],
                                'status': 'pending_payment', 'total': round(ctx['total'], 2),
                            }, room=f'stall_{current_stall}')
                        except Exception as ex:
                            print(f"[Arduino] AWAITING_PAYMENT error: {ex}")
                            db = _reconnect_db(db)

                elif line.startswith('CONFIRMPAY:'):
                    rfid = _format_rfid(line[11:].strip())
                    ctx  = stall_ctx.get(current_stall, {})
                    print(f"[Arduino] CONFIRMPAY rfid={rfid} order={ctx.get('order_id')}")
                    if not ctx.get('order_id'):
                        _serial_write("PAYFAIL:NOORDER")
                        _emit('payment_fail', {'rfid': rfid, 'stall': current_stall, 'reason': 'NOORDER'}, room=f'stall_{current_stall}')
                        continue
                    try:
                        with db.cursor() as c:
                            c.execute("SELECT id, name, balance FROM users WHERE rfid=%s", (rfid,))
                            u = c.fetchone()
                        if not u:
                            _serial_write("PAYFAIL:NOTFOUND")
                            _emit('payment_fail', {'rfid': rfid, 'stall': current_stall, 'reason': 'NOTFOUND'}, room=f'stall_{current_stall}')
                            continue
                        with db.cursor() as c:
                            c.execute("SELECT total_amount FROM order_sessions WHERE id=%s", (ctx['order_id'],))
                            sess = c.fetchone()
                        if not sess:
                            _serial_write("PAYFAIL:NOORDER")
                            _emit('payment_fail', {'rfid': rfid, 'stall': current_stall, 'reason': 'NOORDER'}, room=f'stall_{current_stall}')
                            continue
                        total = float(sess['total_amount'])
                        bal   = float(u['balance'])
                        if bal < total:
                            _serial_write("PAYFAIL:INSUFFICIENT")
                            _emit('payment_fail', {'rfid': rfid, 'stall': current_stall, 'reason': 'INSUFFICIENT', 'balance': bal, 'total': total}, room=f'stall_{current_stall}')
                            continue
                        new_bal = round(bal - total, 2)
                        now     = _now()
                        tid     = _txn_id()
                        with db.cursor() as c:
                            c.execute("SELECT id FROM stalls WHERE stall_key=%s", (current_stall,))
                            sr  = c.fetchone()
                            sid = sr['id'] if sr else None
                            c.execute("UPDATE users SET balance=%s, last_activity=%s WHERE rfid=%s", (new_bal, now, rfid))
                            c.execute(
                                "INSERT INTO transactions (id,type,user_rfid,user_name,description,amount,bal_after,stall_id,created_at,status) "
                                "VALUES (%s,'payment',%s,%s,%s,%s,%s,%s,%s,'completed')",
                                (tid, rfid, u['name'], f"Purchase at Stall {current_stall} (Order {ctx['order_id']})", -total, new_bal, sid, now)
                            )
                            c.execute(
                                "UPDATE order_sessions SET status='paid', user_rfid=%s, transaction_id=%s, paid_at=%s WHERE id=%s",
                                (rfid, tid, now, ctx['order_id'])
                            )
                            nid = 'NOTIF-' + uuid.uuid4().hex[:8].upper()
                            c.execute(
                                "INSERT INTO notifications (id,user_rfid,type,title,body,from_label,amount,new_balance,created_at) "
                                "VALUES (%s,%s,'payment','Payment Successful',%s,%s,%s,%s,%s)",
                                (nid, rfid, f"Payment of P{total:,.2f} at Stall {current_stall}. New balance: P{new_bal:,.2f}.", f"Stall {current_stall}", total, new_bal, now)
                            )
                        db.commit()
                        stall_ctx[current_stall] = {'order_id': None, 'total': 0.0}
                        _serial_write(f"PAYOK:{new_bal:.2f}")
                        pay_data = {
                            'rfid': rfid, 'stall': current_stall, 'user_name': u['name'],
                            'total': total, 'new_balance': new_bal,
                            'order_id': ctx['order_id'], 'txn_id': tid, 'datetime': now,
                        }
                        _emit('payment_success', pay_data, room=f'stall_{current_stall}')
                        _emit('payment_success', pay_data, room='admin')
                        _emit('balance_updated', {'rfid': rfid, 'balance': new_bal}, room=f'user_{rfid}')
                        _emit('notification_push', {
                            'rfid': rfid,
                            'notif': {
                                'id': nid, 'type': 'payment', 'title': 'Payment Successful',
                                'body': f"Payment of P{total:,.2f} at Stall {current_stall}. New balance: P{new_bal:,.2f}.",
                                'from': f"Stall {current_stall}", 'dt': now, 'read': False,
                                'amount': total, 'newBal': new_bal,
                            }
                        }, room=f'user_{rfid}')
                    except Exception as ex:
                        print(f"[Arduino] CONFIRMPAY error: {ex}")
                        try: db.rollback()
                        except: pass
                        db = _reconnect_db(db)
                        _serial_write("PAYFAIL:ERROR")
                        _emit('payment_fail', {'rfid': rfid, 'stall': current_stall, 'reason': 'ERROR'}, room=f'stall_{current_stall}')

                elif line in ('ORDER:CANCEL', 'ORDER:CANCEL_PAYMENT', 'ORDER:CANCEL_CONFIRM'):
                    ctx = stall_ctx.get(current_stall, {})
                    oid = ctx.get('order_id')
                    if oid:
                        try:
                            with db.cursor() as c:
                                c.execute("UPDATE order_sessions SET status='cancelled' WHERE id=%s", (oid,))
                            db.commit()
                            _emit('order_updated', {'stall': current_stall, 'order_id': oid, 'status': 'cancelled', 'total': 0}, room=f'stall_{current_stall}')
                        except Exception as ex:
                            print(f"[Arduino] ORDER:CANCEL error: {ex}")
                            db = _reconnect_db(db)
                    stall_ctx[current_stall] = {'order_id': None, 'total': 0.0}

                elif line.startswith('KEY:'):
                    print(f"[Arduino] [{current_stall}] Key: {line[4:].strip()}")

        except Exception as e:
            with _rfid_lock:
                _arduino_connected = False
            with _serial_lock:
                _serial_handle = None
            if db:
                try: db.close()
                except: pass
            print(f"[Arduino] Disconnected ({e}). Retry in 5s...")
            _emit('arduino_status', {'connected': False})
            time.sleep(5)


def _find_arduino_port(baud: int = 9600):
    import serial as pyserial, sys
    candidates = ([f"COM{i}" for i in range(1, 21)] if sys.platform.startswith("win")
                  else ["/dev/ttyUSB0", "/dev/ttyUSB1", "/dev/ttyACM0", "/dev/ttyACM1"])
    for port in candidates:
        try:
            s = pyserial.Serial(port, baud, timeout=1)
            s.close()
            return port
        except: pass
    return None


def start_arduino(port: str = None, baud: int = 9600):
    if port is None:
        port = _find_arduino_port(baud)
    if port:
        threading.Thread(target=_arduino_reader, args=(port, baud), daemon=True).start()
        print(f"[Arduino] Reader thread started on {port}")
    else:
        print("[Arduino] No Arduino found. Pass port: start_arduino('COM5')")


# ─────────────────────────────────────────────────────────────
# SOCKETIO EVENTS
# ─────────────────────────────────────────────────────────────
@socketio.on('connect')
def on_connect():
    print(f"[SocketIO] Client connected: {request.sid}")
    with _rfid_lock:
        connected = _arduino_connected
    emit('arduino_status', {'connected': connected})

@socketio.on('disconnect')
def on_disconnect():
    print(f"[SocketIO] Client disconnected: {request.sid}")

@socketio.on('join_stall')
def on_join_stall(data):
    stall = str(data.get('stall', 'A')).upper()
    room  = f'stall_{stall}'
    join_room(room)
    print(f"[SocketIO] {request.sid} joined room {room}")
    emit('joined', {'room': room})

@socketio.on('join_admin')
def on_join_admin():
    join_room('admin')
    print(f"[SocketIO] {request.sid} joined admin room")
    emit('joined', {'room': 'admin'})

@socketio.on('join_user')
def on_join_user(data):
    rfid = _format_rfid(str(data.get('rfid', '')))
    if rfid:
        room = f'user_{rfid}'
        join_room(room)
        print(f"[SocketIO] {request.sid} joined room {room}")
        emit('joined', {'room': room})

@socketio.on('leave_user')
def on_leave_user(data):
    rfid = _format_rfid(str(data.get('rfid', '')))
    if rfid:
        leave_room(f'user_{rfid}')


# ─────────────────────────────────────────────────────────────
# SERIALISATION
# ─────────────────────────────────────────────────────────────
def _user_dict(u) -> dict:
    if not u: return {}
    return {
        'id':           u['id'],
        'name':         u['name'],
        'rfid':         u['rfid'],
        'contact':      u['contact'],
        'status':       u['status'],
        'balance':      round(float(u['balance']), 2),
        'totalRefills': u['total_refills'],
        'lastActivity': u['last_activity'],
        'theme':        u.get('theme', 'midnight'),
        'accent':       u.get('accent', 'orange'),
    }

def _txn_dict(t) -> dict:
    return {
        'id':       t['id'],  'type': t['type'],
        'user':     t['user_name'], 'rfid': t['user_rfid'],
        'desc':     t['description'], 'amount': float(t['amount']),
        'balAfter': float(t['bal_after']),
        'datetime': str(t['created_at'])[:16], 'status': t['status'],
    }

def _refill_dict(r) -> dict:
    return {
        'ref': r['ref'], 'rfid': r['rfid'], 'user': r['user_name'],
        'amount': float(r['amount']), 'before': float(r['bal_before']),
        'after':  float(r['bal_after']), 'admin': r['admin_user'],
        'datetime': str(r['created_at'])[:16], 'status': r['status'],
        'receiptSent': bool(r['receipt_sent']), 'note': r['note'],
    }

def _notif_dict(n) -> dict:
    return {
        'id':    n['id'],    'type':  n['type'],
        'title': n['title'], 'body':  n['body'],
        'from':  n['from_label'],
        'dt':    str(n['created_at'])[:16], 'read': bool(n['is_read']),
        'amount': float(n['amount'])      if n.get('amount')      else None,
        'newBal': float(n['new_balance']) if n.get('new_balance') else None,
        'from_user': n.get('from_user'),
        'refId': n.get('id', ''), 'user': '',
        'before': 0,
        'after':  float(n['new_balance']) if n.get('new_balance') else 0,
    }


# ═══════════════════════════════════════════════════════════════
# PAGE ROUTES
# ═══════════════════════════════════════════════════════════════
@app.route('/')
def page_user():
    return render_template('user_app.html')

@app.route('/merchant')
def page_merchant():
    return render_template('merchant.html')

@app.route('/admin')
def page_admin():
    return render_template('admin_dashboard.html')


# ═══════════════════════════════════════════════════════════════
# USER AUTH
# ═══════════════════════════════════════════════════════════════
@app.route('/api/login', methods=['POST'])
def api_login():
    d    = request.json or {}
    rfid = _format_rfid(d.get('rfid', '').strip())
    pw   = d.get('password', '')
    c    = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    user = c.fetchone()
    if not user or user['password_hash'] != _hash(pw):
        return jsonify({'ok': False, 'error': 'Invalid ID or password.'}), 401
    session['user_rfid'] = rfid
    return jsonify({'ok': True, 'user': _user_dict(user)})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('user_rfid', None)
    return jsonify({'ok': True})

@app.route('/api/register', methods=['POST'])
def api_register():
    d       = request.json or {}
    name    = d.get('name', '').strip()
    rfid    = _format_rfid(d.get('rfid', '').strip())
    contact = d.get('contact', '').strip()
    status  = d.get('status', 'Student')
    pw      = d.get('password', '')
    if not all([name, rfid, contact, status, pw]):
        return jsonify({'ok': False, 'error': 'All fields are required.'}), 400
    if not re.match(r'^\d{2}-\d{4}-\d{6}$', rfid):
        return jsonify({'ok': False, 'error': 'RFID format must be NN-NNNN-NNNNNN.'}), 400
    c = _cur()
    c.execute("SELECT id FROM users WHERE rfid=%s", (rfid,))
    if c.fetchone():
        return jsonify({'ok': False, 'error': 'RFID already registered.'}), 409
    uid = 'U' + datetime.now().strftime('%Y%m%d%H%M%S')
    c.execute(
        "INSERT INTO users (id,name,rfid,contact,status,password_hash,balance,total_refills,last_activity,theme,accent) "
        "VALUES (%s,%s,%s,%s,%s,%s,0,0,'—','midnight','orange')",
        (uid, name, rfid, contact, status, _hash(pw))
    )
    _commit()
    c.execute("SELECT * FROM users WHERE id=%s", (uid,))
    return jsonify({'ok': True, 'user': _user_dict(c.fetchone())}), 201

@app.route('/api/me')
def api_me():
    rfid, err = _req_user()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    u = c.fetchone()
    if not u:
        return jsonify({'ok': False, 'error': 'User not found.'}), 404
    return jsonify({'ok': True, 'user': _user_dict(u)})

@app.route('/api/transactions')
def api_transactions():
    rfid, err = _req_user()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM transactions WHERE user_rfid=%s ORDER BY created_at DESC", (rfid,))
    return jsonify({'ok': True, 'transactions': [_txn_dict(r) for r in c.fetchall()]})

@app.route('/api/notifications')
def api_notifications():
    rfid, err = _req_user()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM notifications WHERE user_rfid=%s ORDER BY created_at DESC", (rfid,))
    return jsonify({'ok': True, 'notifications': [_notif_dict(r) for r in c.fetchall()]})

@app.route('/api/notifications/read-all', methods=['POST'])
def api_read_all():
    rfid, err = _req_user()
    if err: return err
    c = _cur()
    c.execute("UPDATE notifications SET is_read=1 WHERE user_rfid=%s", (rfid,))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/transfer', methods=['POST'])
def api_transfer():
    rfid, err = _req_user()
    if err: return err
    d     = request.json or {}
    to_id = _format_rfid(d.get('toRfid', '').strip())
    try:   amt = float(d.get('amount', 0))
    except: return jsonify({'ok': False, 'error': 'Invalid amount.'}), 400
    c = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    sender = c.fetchone()
    c.execute("SELECT * FROM users WHERE rfid=%s", (to_id,))
    recip  = c.fetchone()
    if not recip:   return jsonify({'ok': False, 'error': 'Recipient not found.'}), 404
    if rfid==to_id: return jsonify({'ok': False, 'error': 'Cannot transfer to yourself.'}), 400
    if amt<=0:      return jsonify({'ok': False, 'error': 'Amount must be > 0.'}), 400
    if float(sender['balance']) < amt: return jsonify({'ok': False, 'error': 'Insufficient balance.'}), 400
    now = _now()
    sb  = round(float(sender['balance']) - amt, 2)
    rb  = round(float(recip['balance'])  + amt, 2)
    c.execute("UPDATE users SET balance=%s, last_activity=%s WHERE rfid=%s", (sb, now, rfid))
    c.execute("UPDATE users SET balance=%s, last_activity=%s WHERE rfid=%s", (rb, now, to_id))
    tid1 = _txn_id(); tid2 = _txn_id() + 'R'
    c.execute(
        "INSERT INTO transactions (id,type,user_rfid,user_name,description,amount,bal_after,stall_id,created_at,status) "
        "VALUES (%s,'transfer',%s,%s,%s,%s,%s,NULL,%s,'completed')",
        (tid1, rfid, sender['name'], f"Transfer to {recip['name']}", -amt, sb, now))
    c.execute(
        "INSERT INTO transactions (id,type,user_rfid,user_name,description,amount,bal_after,stall_id,created_at,status) "
        "VALUES (%s,'transfer',%s,%s,%s,%s,%s,NULL,%s,'completed')",
        (tid2, to_id, recip['name'], f"Transfer from {sender['name']}", amt, rb, now))
    nid = 'NOTIF-' + uuid.uuid4().hex[:8].upper()
    c.execute(
        "INSERT INTO notifications (id,user_rfid,type,title,body,from_label,amount,new_balance,from_user,created_at) "
        "VALUES (%s,%s,'transfer_received','Money Received!',%s,'InstaPay System',%s,%s,%s,%s)",
        (nid, to_id, f"You received P{amt:,.2f} from {sender['name']}. New balance: P{rb:,.2f}.", amt, rb, sender['name'], now)
    )
    _commit()
    _emit('balance_updated', {'rfid': rfid,  'balance': sb}, room=f'user_{rfid}')
    _emit('balance_updated', {'rfid': to_id, 'balance': rb}, room=f'user_{to_id}')
    _emit('notification_push', {
        'rfid': to_id,
        'notif': {
            'id': nid, 'type': 'transfer_received', 'title': 'Money Received!',
            'body': f"You received P{amt:,.2f} from {sender['name']}. New balance: P{rb:,.2f}.",
            'from': 'InstaPay System', 'dt': now, 'read': False,
            'amount': amt, 'newBal': rb, 'from_user': sender['name'],
        }
    }, room=f'user_{to_id}')
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    return jsonify({'ok': True, 'sender': _user_dict(c.fetchone())})

@app.route('/api/ping-transfer', methods=['POST'])
def api_ping():
    rfid, err = _req_user()
    if err: return err
    d     = request.json or {}
    to_id = _format_rfid(d.get('toRfid', '').strip())
    c     = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    sender = c.fetchone()
    c.execute("SELECT * FROM users WHERE rfid=%s", (to_id,))
    recip  = c.fetchone()
    if not recip:
        return jsonify({'ok': False, 'error': 'Recipient not found.'}), 404
    nid = 'PING-' + uuid.uuid4().hex[:8].upper()
    now = _now()
    c.execute(
        "INSERT INTO notifications (id,user_rfid,type,title,body,from_label,created_at) "
        "VALUES (%s,%s,'ping','Transfer Verification',%s,%s,%s)",
        (nid, to_id, f"{sender['name']} is verifying your account before sending money.", sender['name'], now)
    )
    _commit()
    _emit('notification_push', {
        'rfid': to_id,
        'notif': {
            'id': nid, 'type': 'ping', 'title': 'Transfer Verification',
            'body': f"{sender['name']} is verifying your account before sending money.",
            'from': sender['name'], 'dt': now, 'read': False,
        }
    }, room=f'user_{to_id}')
    return jsonify({'ok': True, 'recipientName': recip['name']})

@app.route('/api/theme', methods=['POST'])
def api_theme():
    rfid, err = _req_user()
    if err: return err
    d = request.json or {}
    c = _cur()
    c.execute("UPDATE users SET theme=%s, accent=%s WHERE rfid=%s",
              (d.get('theme', 'midnight'), d.get('accent', 'orange'), rfid))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/withdraw-slip', methods=['POST'])
def api_withdraw_slip():
    rfid, err = _req_user()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    user = c.fetchone()
    if not user:
        return jsonify({'ok': False, 'error': 'User not found.'}), 404
    balance = float(user['balance'])
    if balance <= 0:
        return jsonify({'ok': False, 'error': 'No balance to withdraw.'}), 400
    now = _now()
    wid = _withdrawal_id()
    tid = _txn_id()
    c.execute("UPDATE users SET balance=0, last_activity=%s WHERE rfid=%s", (now, rfid))
    c.execute(
        "INSERT INTO transactions (id,type,user_rfid,user_name,description,amount,bal_after,stall_id,created_at,status) "
        "VALUES (%s,'withdrawal',%s,%s,'Full Balance Withdrawal',%s,0,NULL,%s,'completed')",
        (tid, rfid, user['name'], -balance, now)
    )
    c.execute(
        "INSERT INTO withdrawals (id,rfid,user_name,amount,bal_before,created_at,status) "
        "VALUES (%s,%s,%s,%s,%s,%s,'completed')",
        (wid, rfid, user['name'], balance, balance, now)
    )
    _commit()
    _emit('balance_updated', {'rfid': rfid, 'balance': 0}, room=f'user_{rfid}')
    slip = (
        "╔══════════════════════════════════╗\n"
        "║        INSTAPAY                  ║\n"
        "║   OFFICIAL WITHDRAWAL SLIP       ║\n"
        "╚══════════════════════════════════╝\n\n"
        f"  Slip ID    : {wid}\n"
        f"  Txn ID     : {tid}\n"
        f"  Date/Time  : {now}\n"
        "  ──────────────────────────────────\n"
        f"  Card Holder: {user['name']}\n"
        f"  RFID       : {user['rfid']}\n"
        f"  Status     : {user['status']}\n"
        "  ──────────────────────────────────\n"
        f"  Amount     : P{balance:,.2f}\n"
        f"  New Balance: P0.00\n"
        "  ──────────────────────────────────\n\n"
        "  Present this slip to the cashier.\n\n"
        "  ★  InstaPay Administration  ★\n"
        "══════════════════════════════════\n"
    )
    buf = io.BytesIO(slip.encode('utf-8'))
    buf.seek(0)
    return send_file(buf, mimetype='text/plain', as_attachment=True,
                     download_name=f'withdrawal-{wid}.txt')


# ═══════════════════════════════════════════════════════════════
# ADMIN
# ═══════════════════════════════════════════════════════════════
@app.route('/api/admin/login', methods=['POST'])
def api_admin_login():
    d = request.json or {}
    if d.get('username') == ADMIN_USERNAME and d.get('password') == ADMIN_PASSWORD:
        session['admin'] = ADMIN_USERNAME
        return jsonify({'ok': True})
    return jsonify({'ok': False, 'error': 'Invalid credentials.'}), 401

@app.route('/api/admin/logout', methods=['POST'])
def api_admin_logout():
    session.pop('admin', None)
    return jsonify({'ok': True})

@app.route('/api/admin/users')
def api_admin_users():
    err = _req_admin()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM users ORDER BY name")
    return jsonify({'ok': True, 'users': [_user_dict(u) for u in c.fetchall()]})

@app.route('/api/admin/users/<rfid>', methods=['PUT'])
def api_admin_edit_user(rfid):
    err = _req_admin()
    if err: return err
    d = request.json or {}
    new_rfid = d.get('rfid', rfid).strip()
    c = _cur()
    c.execute("SELECT id FROM users WHERE rfid=%s", (rfid,))
    if not c.fetchone():
        return jsonify({'ok': False, 'error': 'User not found.'}), 404
    c.execute("UPDATE users SET name=%s, rfid=%s, contact=%s, status=%s WHERE rfid=%s",
              (d.get('name'), new_rfid, d.get('contact'), d.get('status'), rfid))
    _commit()
    c.execute("SELECT * FROM users WHERE rfid=%s", (new_rfid,))
    return jsonify({'ok': True, 'user': _user_dict(c.fetchone())})

@app.route('/api/admin/users/<rfid>', methods=['DELETE'])
def api_admin_drop(rfid):
    err = _req_admin()
    if err: return err
    c = _cur()
    c.execute("DELETE FROM users WHERE rfid=%s", (rfid,))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/admin/latest-tap')
def api_admin_latest_tap():
    err = _req_admin()
    if err: return err
    with _rfid_lock:
        best, best_ts = None, 0
        for val in _rfid_state.values():
            if val['rfid'] and val['ts'] > best_ts:
                best_ts = val['ts']
                best    = val['rfid']
    return jsonify({'ok': True, 'rfid': best})

@app.route('/api/admin/assign-card', methods=['POST'])
def api_admin_assign_card():
    err = _req_admin()
    if err: return err
    d = request.json or {}
    old_rfid = d.get('old_rfid', '').strip()
    new_rfid = _format_rfid(d.get('new_rfid', '').strip())
    if not old_rfid or not new_rfid:
        return jsonify({'ok': False, 'error': 'old_rfid and new_rfid required.'}), 400
    c = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (old_rfid,))
    u = c.fetchone()
    if not u:
        return jsonify({'ok': False, 'error': f'No user with RFID {old_rfid}'}), 404
    c.execute("SELECT id FROM users WHERE rfid=%s AND rfid!=%s", (new_rfid, old_rfid))
    if c.fetchone():
        return jsonify({'ok': False, 'error': f'RFID {new_rfid} already belongs to another user.'}), 409
    c.execute("UPDATE users SET rfid=%s WHERE rfid=%s", (new_rfid, old_rfid))
    _commit()
    c.execute("SELECT * FROM users WHERE rfid=%s", (new_rfid,))
    return jsonify({'ok': True, 'user': _user_dict(c.fetchone()), 'message': f"Card reassigned to {u['name']}"})

@app.route('/api/admin/register-new-card', methods=['POST'])
def api_admin_register_new_card():
    err = _req_admin()
    if err: return err
    d       = request.json or {}
    rfid    = _format_rfid(d.get('rfid', '').strip())
    name    = d.get('name', '').strip()
    contact = d.get('contact', '').strip() or '—'
    status  = d.get('status', 'Student').strip()
    if not rfid or not name:
        return jsonify({'ok': False, 'error': 'rfid and name required.'}), 400
    default_pw = hashlib.sha256(b'password123').hexdigest()
    c = _cur()
    c.execute("SELECT id FROM users WHERE rfid=%s", (rfid,))
    if c.fetchone():
        return jsonify({'ok': False, 'error': f'RFID {rfid} already registered.'}), 409
    uid = 'U-' + uuid.uuid4().hex[:8].upper()
    c.execute(
        "INSERT INTO users (id,name,rfid,contact,status,password_hash,balance,total_refills,last_activity,theme,accent) "
        "VALUES (%s,%s,%s,%s,%s,%s,0,0,%s,'midnight','orange')",
        (uid, name, rfid, contact, status, default_pw, _now())
    )
    _commit()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    return jsonify({'ok': True, 'user': _user_dict(c.fetchone()), 'message': f'User {name} registered. Default password: password123'})

@app.route('/api/admin/refill', methods=['POST'])
def api_admin_refill():
    err = _req_admin()
    if err: return err
    d    = request.json or {}
    rfid = _format_rfid(d.get('rfid', '').strip())
    try:   amt = float(d.get('amount', 0))
    except: return jsonify({'ok': False, 'error': 'Invalid amount.'}), 400
    note = d.get('note', '—') or '—'
    if amt <= 0:
        return jsonify({'ok': False, 'error': 'Amount must be > 0.'}), 400
    c = _cur()
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    u = c.fetchone()
    if not u:
        return jsonify({'ok': False, 'error': 'User not found.'}), 404
    before = float(u['balance'])
    after  = round(before + amt, 2)
    now    = _now()
    ref    = _ref_id()
    c.execute("UPDATE users SET balance=%s, total_refills=total_refills+1, last_activity=%s WHERE rfid=%s", (after, now, rfid))
    c.execute(
        "INSERT INTO refills (ref,rfid,user_name,amount,bal_before,bal_after,admin_user,note,receipt_sent,status,created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,0,'completed',%s)",
        (ref, rfid, u['name'], amt, before, after, session.get('admin', 'Admin'), note, now)
    )
    desc = 'Card Refill' + (f' ({note})' if note != '—' else '')
    c.execute(
        "INSERT INTO transactions (id,type,user_rfid,user_name,description,amount,bal_after,stall_id,created_at,status) "
        "VALUES (%s,'refill',%s,%s,%s,%s,%s,NULL,%s,'completed')",
        (_txn_id(), rfid, u['name'], desc, amt, after, now))
    _commit()
    _emit('balance_updated', {'rfid': rfid, 'balance': after}, room=f'user_{rfid}')
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    c2 = _cur(); c2.execute("SELECT * FROM refills WHERE ref=%s", (ref,))
    return jsonify({'ok': True, 'user': _user_dict(c.fetchone()), 'refill': _refill_dict(c2.fetchone())})

@app.route('/api/admin/send-receipt', methods=['POST'])
def api_admin_send_receipt():
    err = _req_admin()
    if err: return err
    ref = (request.json or {}).get('ref')
    c   = _cur()
    c.execute("SELECT * FROM refills WHERE ref=%s", (ref,))
    r = c.fetchone()
    if not r:
        return jsonify({'ok': False, 'error': 'Refill not found.'}), 404
    c.execute("UPDATE refills SET receipt_sent=1 WHERE ref=%s", (ref,))
    nid = 'NOTIF-' + uuid.uuid4().hex[:8].upper()
    now    = _now()
    amt    = float(r['amount'])
    bal_af = float(r['bal_after'])
    bal_be = float(r['bal_before'])
    c.execute(
        "INSERT INTO notifications (id,user_rfid,type,title,body,from_label,amount,new_balance,created_at) "
        "VALUES (%s,%s,'receipt','Refill Receipt',%s,'InstaPay Admin',%s,%s,%s)",
        (nid, r['rfid'], f"Card refilled. Amount: P{amt:,.2f}. New balance: P{bal_af:,.2f}. Ref: {ref}.", amt, bal_af, now)
    )
    _commit()
    _emit('notification_push', {
        'rfid': r['rfid'],
        'notif': {
            'id': nid, 'type': 'receipt', 'title': 'Refill Receipt',
            'body': f"Card refilled. Amount: P{amt:,.2f}. New balance: P{bal_af:,.2f}. Ref: {ref}.",
            'from': 'InstaPay Admin', 'dt': now, 'read': False,
            'amount': amt, 'newBal': bal_af,
            'refId': ref, 'user': r['user_name'],
            'before': bal_be, 'after': bal_af,
        }
    }, room=f'user_{r["rfid"]}')
    c.execute("SELECT * FROM refills WHERE ref=%s", (ref,))
    return jsonify({'ok': True, 'refill': _refill_dict(c.fetchone())})

@app.route('/api/admin/audit')
def api_admin_audit():
    err = _req_admin()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM refills ORDER BY created_at DESC")
    return jsonify({'ok': True, 'audit': [_refill_dict(r) for r in c.fetchall()]})

@app.route('/api/admin/history')
def api_admin_history():
    err = _req_admin()
    if err: return err
    c = _cur()
    c.execute("SELECT * FROM transactions ORDER BY created_at DESC")
    return jsonify({'ok': True, 'history': [_txn_dict(r) for r in c.fetchall()]})

@app.route('/api/admin/stats')
def api_admin_stats():
    err = _req_admin()
    if err: return err
    c = _cur()
    c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(balance),0) AS total_bal FROM users")
    u = c.fetchone()
    c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total FROM refills WHERE status='completed'")
    r = c.fetchone()
    return jsonify({'ok': True, 'stats': {
        'userCount':    u['cnt'],
        'totalBalance': float(u['total_bal']),
        'totalLoaded':  float(r['total']),
        'refillCount':  r['cnt'],
    }})


# ═══════════════════════════════════════════════════════════════
# MERCHANT
# ═══════════════════════════════════════════════════════════════
@app.route('/api/merchant/stalls')
def api_merchant_stalls():
    c = _cur()
    c.execute("SELECT * FROM stalls WHERE is_active=1 ORDER BY stall_key")
    return jsonify({'ok': True, 'stalls': list(c.fetchall())})

@app.route('/api/merchant/stall/<stall_key>/menu')
def api_merchant_menu(stall_key):
    c = _cur()
    c.execute(
        "SELECT mi.* FROM menu_items mi JOIN stalls s ON s.id=mi.stall_id "
        "WHERE s.stall_key=%s AND mi.is_available=1 ORDER BY mi.item_code",
        (stall_key.upper(),)
    )
    return jsonify({'ok': True, 'items': [
        {'id': i['id'], 'code': i['item_code'], 'name': i['name'], 'price': float(i['price'])}
        for i in c.fetchall()
    ]})

@app.route('/api/merchant/stall/<stall_key>/menu/item', methods=['POST'])
def api_merchant_add_item(stall_key):
    d = request.json or {}
    c = _cur()
    c.execute("SELECT id FROM stalls WHERE stall_key=%s", (stall_key.upper(),))
    s = c.fetchone()
    if not s:
        return jsonify({'ok': False, 'error': 'Stall not found.'}), 404
    try:   price = float(d.get('price', 0))
    except: return jsonify({'ok': False, 'error': 'Invalid price.'}), 400
    c.execute("INSERT INTO menu_items (stall_id,item_code,name,price) VALUES (%s,%s,%s,%s)",
              (s['id'], d.get('item_code'), d.get('name'), price))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/merchant/stall/<stall_key>/menu/item/<int:item_id>', methods=['DELETE'])
def api_merchant_del_item(stall_key, item_id):
    c = _cur()
    c.execute("DELETE FROM menu_items WHERE id=%s", (item_id,))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/merchant/order/start', methods=['POST'])
def api_order_start():
    d     = request.json or {}
    stall = d.get('stall_key', 'A').upper()
    c     = _cur()
    c.execute("SELECT id FROM stalls WHERE stall_key=%s", (stall,))
    s = c.fetchone()
    if not s:
        return jsonify({'ok': False, 'error': 'Stall not found.'}), 404
    oid = _order_id()
    c.execute("INSERT INTO order_sessions (id,stall_id,status,total_amount,created_at) VALUES (%s,%s,'open',0,%s)",
              (oid, s['id'], _now()))
    _commit()
    return jsonify({'ok': True, 'order_id': oid})

@app.route('/api/merchant/order/<order_id>/add-item', methods=['POST'])
def api_order_add_item(order_id):
    d = request.json or {}
    stall_key = d.get('stall_key', 'A').upper()
    try:
        item_code = int(d.get('item_code', 0))
        quantity  = int(d.get('quantity', 1))
    except: return jsonify({'ok': False, 'error': 'Invalid item_code or quantity.'}), 400
    c = _cur()
    c.execute(
        "SELECT mi.* FROM menu_items mi JOIN stalls s ON s.id=mi.stall_id "
        "WHERE s.stall_key=%s AND mi.item_code=%s AND mi.is_available=1",
        (stall_key, item_code)
    )
    item = c.fetchone()
    if not item:
        return jsonify({'ok': False, 'error': f'Item {item_code} not found.'}), 404
    subtotal = round(float(item['price']) * quantity, 2)
    c.execute(
        "INSERT INTO order_items (order_session_id,menu_item_id,item_name,unit_price,quantity,subtotal) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (order_id, item['id'], item['name'], float(item['price']), quantity, subtotal)
    )
    c.execute("UPDATE order_sessions SET total_amount=total_amount+%s WHERE id=%s", (subtotal, order_id))
    _commit()
    c.execute("SELECT total_amount FROM order_sessions WHERE id=%s", (order_id,))
    total = float(c.fetchone()['total_amount'])
    return jsonify({'ok': True,
                    'item': {'name': item['name'], 'price': float(item['price']),
                             'quantity': quantity, 'subtotal': subtotal},
                    'total': total})

@app.route('/api/merchant/order/<order_id>/items')
def api_order_items(order_id):
    c = _cur()
    c.execute("SELECT * FROM order_items WHERE order_session_id=%s", (order_id,))
    items = c.fetchall()
    c.execute("SELECT total_amount, status FROM order_sessions WHERE id=%s", (order_id,))
    sess = c.fetchone()
    if not sess:
        return jsonify({'ok': False, 'error': 'Order not found.'}), 404
    return jsonify({'ok': True,
                    'items': [{'name': i['item_name'], 'price': float(i['unit_price']),
                               'qty': i['quantity'], 'subtotal': float(i['subtotal'])} for i in items],
                    'total': float(sess['total_amount']), 'status': sess['status']})

@app.route('/api/merchant/order/<order_id>/cancel', methods=['POST'])
def api_order_cancel(order_id):
    c = _cur()
    c.execute("UPDATE order_sessions SET status='cancelled' WHERE id=%s", (order_id,))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/merchant/order/<order_id>/pending-rfid', methods=['POST'])
def api_order_pending(order_id):
    c = _cur()
    c.execute("UPDATE order_sessions SET status='pending_payment' WHERE id=%s", (order_id,))
    _commit()
    return jsonify({'ok': True})

@app.route('/api/merchant/order/<order_id>/pay', methods=['POST'])
def api_order_pay(order_id):
    d    = request.json or {}
    rfid = _format_rfid(d.get('rfid', '').strip())
    c    = _cur()
    c.execute(
        "SELECT os.*, s.stall_key FROM order_sessions os "
        "JOIN stalls s ON s.id=os.stall_id WHERE os.id=%s", (order_id,)
    )
    order = c.fetchone()
    if not order:
        return jsonify({'ok': False, 'error': 'Order not found.'}), 404
    if order['status'] not in ('open', 'pending_payment'):
        return jsonify({'ok': False, 'error': f"Order already {order['status']}."}), 400
    c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
    user = c.fetchone()
    if not user:
        return jsonify({'ok': False, 'error': 'RFID not registered.'}), 404
    total   = float(order['total_amount'])
    bal     = float(user['balance'])
    if bal < total:
        return jsonify({'ok': False, 'error': 'Insufficient balance.', 'balance': bal, 'total': total}), 402
    new_bal = round(bal - total, 2)
    now     = _now()
    tid     = _txn_id()
    c.execute("UPDATE users SET balance=%s, last_activity=%s WHERE rfid=%s", (new_bal, now, rfid))
    c.execute("SELECT id FROM stalls WHERE stall_key=%s", (order['stall_key'],))
    sid = c.fetchone()['id']
    c.execute(
        "INSERT INTO transactions (id,type,user_rfid,user_name,description,amount,bal_after,stall_id,created_at,status) "
        "VALUES (%s,'payment',%s,%s,%s,%s,%s,%s,%s,'completed')",
        (tid, rfid, user['name'], f"Purchase at Stall {order['stall_key']} (Order {order_id})", -total, new_bal, sid, now))
    c.execute("UPDATE order_sessions SET status='paid', user_rfid=%s, transaction_id=%s, paid_at=%s WHERE id=%s",
              (rfid, tid, now, order_id))
    nid = 'NOTIF-' + uuid.uuid4().hex[:8].upper()
    c.execute(
        "INSERT INTO notifications (id,user_rfid,type,title,body,from_label,amount,new_balance,created_at) "
        "VALUES (%s,%s,'payment','Payment Successful',%s,%s,%s,%s,%s)",
        (nid, rfid, f"Payment of P{total:,.2f} at Stall {order['stall_key']}. New balance: P{new_bal:,.2f}.",
         f"Stall {order['stall_key']}", total, new_bal, now)
    )
    _commit()
    _emit('balance_updated', {'rfid': rfid, 'balance': new_bal}, room=f'user_{rfid}')
    _emit('payment_success', {
        'rfid': rfid, 'stall': order['stall_key'], 'user_name': user['name'],
        'total': total, 'new_balance': new_bal, 'order_id': order_id,
    }, room=f'stall_{order["stall_key"]}')
    return jsonify({'ok': True, 'new_balance': new_bal, 'user_name': user['name'],
                    'total': total, 'transaction_id': tid})

@app.route('/api/merchant/stall/<stall_key>/sales')
def api_merchant_stall_sales(stall_key):
    c = _cur()
    c.execute(
        "SELECT os.id, os.total_amount, os.paid_at, u.name AS customer_name "
        "FROM order_sessions os JOIN stalls s ON s.id=os.stall_id "
        "LEFT JOIN users u ON u.rfid=os.user_rfid "
        "WHERE s.stall_key=%s AND os.status='paid' ORDER BY os.paid_at DESC",
        (stall_key.upper(),)
    )
    rows  = c.fetchall()
    sales = [{'id': r['id'], 'customer_name': r['customer_name'] or 'Guest',
              'total': float(r['total_amount']),
              'paid_at': str(r['paid_at'])[:16] if r['paid_at'] else '—'} for r in rows]
    return jsonify({'ok': True, 'sales': sales,
                    'total_orders':     len(sales),
                    'total_revenue':    round(sum(s['total'] for s in sales), 2),
                    'unique_customers': len({s['customer_name'] for s in sales if s['customer_name'] != 'Guest'})})


# ═══════════════════════════════════════════════════════════════
# ARDUINO REST API
# ═══════════════════════════════════════════════════════════════
@app.route('/api/arduino/status')
def api_arduino_status():
    with _rfid_lock:
        ok = _arduino_connected
    return jsonify({'ok': True, 'connected': ok})

@app.route('/api/arduino/check-rfid')
def api_arduino_check_rfid():
    raw  = request.args.get('rfid', '').strip()
    rfid = _format_rfid(raw) if raw else ''
    if not rfid:
        return jsonify({'ok': False, 'error': 'rfid param required.'}), 400
    c = _cur()
    c.execute("SELECT id, name, rfid, balance, status FROM users WHERE rfid=%s", (rfid,))
    u = c.fetchone()
    if u:
        return jsonify({'ok': True, 'found': True, 'rfid': rfid,
                        'name': u['name'], 'balance': float(u['balance']), 'status': u['status']})
    return jsonify({'ok': True, 'found': False, 'rfid': rfid})

@app.route('/api/arduino/simulate', methods=['POST'])
def api_arduino_simulate():
    d     = request.json or {}
    rfid  = d.get('rfid', '').strip()
    stall = d.get('stall', 'admin').upper()
    if not rfid:
        return jsonify({'ok': False, 'error': 'rfid required.'}), 400
    rfid = _format_rfid(rfid)
    key  = stall if stall in _rfid_state else 'admin'
    with _rfid_lock:
        _rfid_state[key] = {'rfid': rfid, 'ts': time.time()}
    c = _cur()
    c.execute("SELECT name, balance, status FROM users WHERE rfid=%s", (rfid,))
    u = c.fetchone()
    user_info = {'name': u['name'], 'balance': float(u['balance']), 'status': u['status']} if u else None
    _emit('rfid_tapped', {'rfid': rfid, 'stall': key, 'user': user_info})
    _emit('rfid_tapped', {'rfid': rfid, 'stall': key, 'user': user_info}, room='admin')
    return jsonify({'ok': True, 'rfid': rfid, 'stall': key})

@app.route('/api/arduino/latest')
def api_arduino_latest():
    with _rfid_lock:
        scan = _rfid_state['admin'].copy()
        _rfid_state['admin'] = {'rfid': None, 'ts': 0}
    rfid = scan['rfid']
    if rfid:
        c = _cur()
        c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
        u = c.fetchone()
        return jsonify({'ok': True, 'rfid': rfid, 'ts': scan['ts'], 'user': _user_dict(u) if u else None})
    return jsonify({'ok': True, 'rfid': None, 'ts': 0, 'user': None})

@app.route('/api/arduino/stall/<stall_key>/latest')
def api_arduino_stall_latest(stall_key):
    key = stall_key.upper()
    if key not in _rfid_state:
        return jsonify({'ok': False, 'error': 'Unknown stall.'}), 400
    with _rfid_lock:
        scan = _rfid_state[key].copy()
        _rfid_state[key] = {'rfid': None, 'ts': 0}
    rfid = scan['rfid']
    if rfid:
        c = _cur()
        c.execute("SELECT * FROM users WHERE rfid=%s", (rfid,))
        u = c.fetchone()
        return jsonify({'ok': True, 'rfid': rfid, 'ts': scan['ts'], 'user': _user_dict(u) if u else None})
    return jsonify({'ok': True, 'rfid': None, 'ts': 0, 'user': None})


# ═══════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════
def _seed_cards():
    pw_hash = hashlib.sha256(b'password123').hexdigest()
    cards = [
        ('U-WHITE-CARD', 'White Card User', '11-9220-357300', '09000000001'),
        ('U-BLUE-TAG',   'Blue Tag User',   '09-2401-082000', '09000000002'),
    ]
    db = None
    try:
        db = _thread_db()
        with db.cursor() as c:
            for uid, name, rfid, contact in cards:
                c.execute("SELECT id FROM users WHERE rfid=%s", (rfid,))
                if not c.fetchone():
                    c.execute(
                        "INSERT INTO users "
                        "(id,name,rfid,contact,status,password_hash,"
                        " balance,total_refills,last_activity,theme,accent) "
                        "VALUES (%s,%s,%s,%s,'Student',%s,0,0,'—','midnight','orange')",
                        (uid, name, rfid, contact, pw_hash)
                    )
                    print(f"[Seed] Registered: {rfid} -> {name}")
                else:
                    print(f"[Seed] Already exists: {rfid} -> {name}")
        db.commit()
    except Exception as e:
        print(f"[Seed] Warning: {e}")
    finally:
        if db:
            try: db.close()
            except: pass


if __name__ == '__main__':
    _seed_cards()
    start_arduino('COM5')   # ← change to your COM port
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, use_reloader=False)