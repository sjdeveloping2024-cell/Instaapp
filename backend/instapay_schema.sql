-- ============================================================
--  InstaPay — MySQL Schema  (FINAL v8 — React Native Edition)
--  Changes from v7:
--    • password_hash REMOVED — system uses biometric + PIN only
--    • theme / accent columns gone (already removed in v7)
--    • Migration block handles existing v5/v6/v7 databases
-- ============================================================

CREATE DATABASE IF NOT EXISTS instapay
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE instapay;

-- ─────────────────────────────────────────────────────────────
-- USERS  (password_hash removed — biometric + PIN only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED   NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100)   NOT NULL,
  rfid            VARCHAR(20)    NOT NULL UNIQUE,
  contact         VARCHAR(20)    NOT NULL DEFAULT '',
  status          ENUM('Student','Non-Student') NOT NULL DEFAULT 'Student',
  pin_hash        VARCHAR(64)    NOT NULL DEFAULT '',
  bio_token       TEXT                    DEFAULT NULL,
  balance         DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  total_refills   INT UNSIGNED   NOT NULL DEFAULT 0,
  last_activity   VARCHAR(20)    NOT NULL DEFAULT '—',
  created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- MIGRATION GUARD  (safe upgrade from any previous version)
-- ─────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS instapay_upgrade;
DELIMITER //
CREATE PROCEDURE instapay_upgrade()
BEGIN
  DECLARE col_type VARCHAR(100);

  -- Migrate id column from VARCHAR to INT AUTO_INCREMENT if needed
  SELECT DATA_TYPE INTO col_type
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'id';

  IF col_type = 'varchar' THEN
    -- Drop primary key first, then alter column
    ALTER TABLE users DROP PRIMARY KEY;
    ALTER TABLE users MODIFY COLUMN id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY;
  END IF;

  -- Add pin_hash if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'pin_hash'
  ) THEN
    ALTER TABLE users ADD COLUMN pin_hash VARCHAR(64) NOT NULL DEFAULT '' AFTER status;
  END IF;

  -- Add bio_token if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'bio_token'
  ) THEN
    ALTER TABLE users ADD COLUMN bio_token TEXT DEFAULT NULL AFTER pin_hash;
  END IF;

  -- Drop password_hash if still present
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'
  ) THEN
    ALTER TABLE users DROP COLUMN password_hash;
  END IF;

  -- Drop theme if still present
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'theme'
  ) THEN
    ALTER TABLE users DROP COLUMN theme;
  END IF;

  -- Drop accent if still present
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'accent'
  ) THEN
    ALTER TABLE users DROP COLUMN accent;
  END IF;
END //
DELIMITER ;
CALL instapay_upgrade();
DROP PROCEDURE IF EXISTS instapay_upgrade;

-- ─────────────────────────────────────────────────────────────
-- STALLS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stalls (
  id          INT UNSIGNED   NOT NULL AUTO_INCREMENT PRIMARY KEY,
  stall_key   CHAR(1)        NOT NULL UNIQUE,
  name        VARCHAR(80)    NOT NULL,
  description VARCHAR(200)            DEFAULT '',
  is_active   TINYINT(1)     NOT NULL DEFAULT 1,
  created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- MENU ITEMS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            INT UNSIGNED   NOT NULL AUTO_INCREMENT PRIMARY KEY,
  stall_id      INT UNSIGNED   NOT NULL,
  item_code     INT UNSIGNED   NOT NULL,
  name          VARCHAR(80)    NOT NULL,
  price         DECIMAL(8,2)   NOT NULL,
  is_available  TINYINT(1)     NOT NULL DEFAULT 1,
  FOREIGN KEY (stall_id) REFERENCES stalls(id) ON DELETE CASCADE,
  UNIQUE KEY uq_stall_code (stall_id, item_code)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- ORDER SESSIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_sessions (
  id              VARCHAR(40)   NOT NULL PRIMARY KEY,
  stall_id        INT UNSIGNED  NOT NULL,
  user_rfid       VARCHAR(20)            DEFAULT NULL,
  status          ENUM('open','pending_payment','paid','cancelled') NOT NULL DEFAULT 'open',
  total_amount    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  transaction_id  VARCHAR(40)            DEFAULT NULL,
  paid_at         VARCHAR(20)            DEFAULT NULL,
  created_at      VARCHAR(20)   NOT NULL,
  FOREIGN KEY (stall_id) REFERENCES stalls(id)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- ORDER ITEMS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_session_id   VARCHAR(40)   NOT NULL,
  menu_item_id       INT UNSIGNED  NOT NULL,
  item_name          VARCHAR(80)   NOT NULL,
  unit_price         DECIMAL(8,2)  NOT NULL,
  quantity           INT UNSIGNED  NOT NULL DEFAULT 1,
  subtotal           DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_session_id) REFERENCES order_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id)     REFERENCES menu_items(id)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- TRANSACTIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          VARCHAR(40)   NOT NULL PRIMARY KEY,
  type        ENUM('refill','payment','transfer','withdrawal') NOT NULL,
  user_rfid   VARCHAR(20)   NOT NULL,
  user_name   VARCHAR(100)  NOT NULL,
  description VARCHAR(200)  NOT NULL DEFAULT '',
  amount      DECIMAL(10,2) NOT NULL,
  bal_after   DECIMAL(10,2) NOT NULL,
  stall_id    INT UNSIGNED           DEFAULT NULL,
  created_at  VARCHAR(20)   NOT NULL,
  status      ENUM('completed','failed','pending') NOT NULL DEFAULT 'completed',
  INDEX idx_user    (user_rfid),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- REFILLS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refills (
  ref           VARCHAR(12)   NOT NULL PRIMARY KEY,
  rfid          VARCHAR(20)   NOT NULL,
  user_name     VARCHAR(100)  NOT NULL,
  amount        DECIMAL(10,2) NOT NULL,
  bal_before    DECIMAL(10,2) NOT NULL,
  bal_after     DECIMAL(10,2) NOT NULL,
  admin_user    VARCHAR(50)   NOT NULL DEFAULT 'Admin',
  note          VARCHAR(200)           DEFAULT '—',
  receipt_sent  TINYINT(1)    NOT NULL DEFAULT 0,
  status        ENUM('completed','failed') NOT NULL DEFAULT 'completed',
  created_at    VARCHAR(20)   NOT NULL,
  INDEX idx_rfid (rfid)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- WITHDRAWALS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
  id          VARCHAR(40)   NOT NULL PRIMARY KEY,
  rfid        VARCHAR(20)   NOT NULL,
  user_name   VARCHAR(100)  NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  bal_before  DECIMAL(10,2) NOT NULL,
  created_at  VARCHAR(20)   NOT NULL,
  status      ENUM('completed','failed') NOT NULL DEFAULT 'completed',
  INDEX idx_rfid (rfid)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           VARCHAR(40)  NOT NULL PRIMARY KEY,
  user_rfid    VARCHAR(20)  NOT NULL,
  type         VARCHAR(30)  NOT NULL,
  title        VARCHAR(80)  NOT NULL,
  body         TEXT         NOT NULL,
  from_label   VARCHAR(80)           DEFAULT 'InstaPay',
  amount       DECIMAL(10,2)         DEFAULT NULL,
  new_balance  DECIMAL(10,2)         DEFAULT NULL,
  from_user    VARCHAR(100)          DEFAULT NULL,
  is_read      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   VARCHAR(20)  NOT NULL,
  INDEX idx_user (user_rfid)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────
-- SEED: Stalls
-- ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO stalls (stall_key, name, description, is_active) VALUES
  ('A', 'Stall 1', 'Main canteen stall', 1),
  ('B', 'Stall 2', 'Secondary stall',    0),
  ('C', 'Stall 3', 'Third stall',        0),
  ('D', 'Stall 4', 'Fourth stall',       0);

-- ─────────────────────────────────────────────────────────────
-- SEED: Stall A sample menu
-- ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO menu_items (stall_id, item_code, name, price)
  SELECT id, 1, 'Pizza',   85.00 FROM stalls WHERE stall_key='A' UNION ALL
  SELECT id, 2, 'Coke',    30.00 FROM stalls WHERE stall_key='A' UNION ALL
  SELECT id, 3, 'Cake',    55.00 FROM stalls WHERE stall_key='A' UNION ALL
  SELECT id, 4, 'Sundae',  45.00 FROM stalls WHERE stall_key='A';

-- ─────────────────────────────────────────────────────────────
-- SEED: Physical RFID cards  (id is AUTO_INCREMENT — assigned automatically)
-- DEFAULT PIN: 1234
-- SHA-256('1234') = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
-- ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO users
  (name, rfid, contact, status, pin_hash, bio_token, balance, total_refills, last_activity)
VALUES
  (
    'White Card User', '11-9220-357300', '09000000001', 'Student',
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    NULL, 0.00, 0, '—'
  ),
  (
    'Blue Tag User', '09-2401-082000', '09000000002', 'Student',
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    NULL, 0.00, 0, '—'
  );

-- ─────────────────────────────────────────────────────────────
-- VERIFY
-- ─────────────────────────────────────────────────────────────
SHOW TABLES;
SELECT
  name,
  rfid                                                    AS rfid_card,
  CONCAT('P', FORMAT(balance, 2))                         AS balance,
  IF(pin_hash  != '', 'SET (default: 1234)', 'NOT SET')   AS pin_status,
  IF(bio_token IS NOT NULL, 'ENROLLED',
     'PENDING — user must Sign Up in the app first')      AS fingerprint_status
FROM users;
