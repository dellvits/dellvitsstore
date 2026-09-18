-- Run once in the Supabase SQL Editor, or use npm run db:migrate.
-- A private schema: the browser never receives database credentials.
BEGIN;
CREATE SCHEMA IF NOT EXISTS dellvit;
SET LOCAL search_path TO dellvit, public;

CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,name TEXT NOT NULL,lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL);

CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',location_id TEXT REFERENCES locations(id),password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','outlet','rider')),login_id TEXT UNIQUE,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS outlets(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,location_id TEXT NOT NULL REFERENCES locations(id),address TEXT NOT NULL,lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL,customer_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id),active INTEGER NOT NULL DEFAULT 1,image TEXT NOT NULL,category TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,outlet_id TEXT NOT NULL REFERENCES outlets(id),name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0),unit TEXT NOT NULL,location_id TEXT NOT NULL REFERENCES locations(id),discount INTEGER NOT NULL DEFAULT 0 CHECK(discount BETWEEN 0 AND 90),deal TEXT NOT NULL DEFAULT '',images TEXT NOT NULL,includes TEXT NOT NULL,excludes TEXT NOT NULL,delivery_minutes INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,user_id TEXT REFERENCES users(id),guest_session TEXT, outlet_id TEXT NOT NULL REFERENCES outlets(id),rider_id TEXT REFERENCES users(id),name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,location_id TEXT NOT NULL REFERENCES locations(id),lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL,notes TEXT NOT NULL DEFAULT '',payment_method TEXT NOT NULL DEFAULT 'cod',subtotal INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL,otp TEXT NOT NULL,otp_attempts INTEGER NOT NULL DEFAULT 0,otp_locked_until TEXT,created_at TEXT NOT NULL,deliver_by TEXT NOT NULL,delivered_at TEXT,idempotency_key TEXT NOT NULL UNIQUE);

CREATE TABLE IF NOT EXISTS order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,image TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS order_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,created_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,outlet_id TEXT NOT NULL REFERENCES outlets(id),name TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS admin_access(user_id TEXT PRIMARY KEY REFERENCES users(id),super INTEGER NOT NULL DEFAULT 0,permissions TEXT NOT NULL DEFAULT '[]');

CREATE TABLE IF NOT EXISTS platform_records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));

CREATE TABLE IF NOT EXISTS area_settings(location_id TEXT PRIMARY KEY REFERENCES locations(id),active INTEGER NOT NULL DEFAULT 1,radius DOUBLE PRECISION NOT NULL DEFAULT 8,fee INTEGER NOT NULL DEFAULT 15000);

CREATE TABLE IF NOT EXISTS rider_state(user_id TEXT PRIMARY KEY REFERENCES users(id),available INTEGER NOT NULL DEFAULT 1,capacity INTEGER NOT NULL DEFAULT 5,lat DOUBLE PRECISION,lng DOUBLE PRECISION,accuracy DOUBLE PRECISION,updated_at TEXT);

CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS order_details(order_id TEXT PRIMARY KEY REFERENCES orders(id),discount INTEGER NOT NULL DEFAULT 0,coupon_code TEXT NOT NULL DEFAULT '',payment_name TEXT NOT NULL,payment_type TEXT NOT NULL,payment_instructions TEXT NOT NULL DEFAULT '',payment_status TEXT NOT NULL DEFAULT 'due', transaction_id TEXT NOT NULL DEFAULT '', payer_name TEXT NOT NULL DEFAULT '', payer_account TEXT NOT NULL DEFAULT '', proof_id TEXT, payment_note TEXT NOT NULL DEFAULT '', payment_details TEXT NOT NULL DEFAULT '{}', payment_updated_at TEXT, payment_reviewed_by TEXT, payment_reviewed_at TEXT);

CREATE TABLE IF NOT EXISTS coupon_uses(order_id TEXT PRIMARY KEY REFERENCES orders(id),coupon_id TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',link TEXT NOT NULL DEFAULT '',read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),p256dh TEXT NOT NULL,auth TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS rider_settings(user_id TEXT PRIMARY KEY REFERENCES users(id),commission_type TEXT NOT NULL DEFAULT 'fixed' CHECK(commission_type IN ('fixed','percent')),commission_value DOUBLE PRECISION NOT NULL DEFAULT 10000,commission_base TEXT NOT NULL DEFAULT 'delivery_fee' CHECK(commission_base IN ('delivery_fee','subtotal','total')));

CREATE TABLE IF NOT EXISTS rider_earnings(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),amount INTEGER NOT NULL,commission_type TEXT NOT NULL,commission_value DOUBLE PRECISION NOT NULL,commission_base TEXT NOT NULL,base_amount INTEGER NOT NULL,cash_collected INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS rider_payouts(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',created_by TEXT,created_at TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'cash', reference TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'paid');

CREATE TABLE IF NOT EXISTS payout_requests(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,method TEXT NOT NULL,account TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT NOT NULL DEFAULT '',payout_id TEXT);

CREATE TABLE IF NOT EXISTS order_flow(order_id TEXT PRIMARY KEY REFERENCES orders(id),sent_at TEXT,sent_by TEXT,outlet_status TEXT NOT NULL DEFAULT 'unsent',outlet_responded_at TEXT,outlet_note TEXT NOT NULL DEFAULT '',rider_status TEXT NOT NULL DEFAULT 'unsent',rider_responded_at TEXT,rider_note TEXT NOT NULL DEFAULT '',rider_rejections INTEGER NOT NULL DEFAULT 0,payment_verified_at TEXT,cancel_reason TEXT NOT NULL DEFAULT '',cancelled_by TEXT,cancel_request TEXT NOT NULL DEFAULT '',cancel_request_at TEXT,reminders INTEGER NOT NULL DEFAULT 0,last_reminder_at TEXT);

CREATE TABLE IF NOT EXISTS payment_proofs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),filename TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS outlet_settings(outlet_id TEXT PRIMARY KEY REFERENCES outlets(id),commission_rate DOUBLE PRECISION NOT NULL DEFAULT 10,accepting INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS order_settlements(order_id TEXT PRIMARY KEY REFERENCES orders(id),outlet_id TEXT NOT NULL,rider_id TEXT,total INTEGER NOT NULL,subtotal INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,discount INTEGER NOT NULL,outlet_rate DOUBLE PRECISION NOT NULL,outlet_commission INTEGER NOT NULL,outlet_payable INTEGER NOT NULL,rider_commission INTEGER NOT NULL,store_net INTEGER NOT NULL,cash_collected INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS cod_deposits(id TEXT PRIMARY KEY,rider_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,review_note TEXT NOT NULL DEFAULT '');

ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order BIGINT GENERATED BY DEFAULT AS IDENTITY;

ALTER TABLE order_events ADD COLUMN IF NOT EXISTS sort_order BIGINT GENERATED BY DEFAULT AS IDENTITY;

CREATE INDEX IF NOT EXISTS idx_products_location ON products(location_id,active);

CREATE INDEX IF NOT EXISTS idx_products_outlet ON products(outlet_id);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(user_id,created_at);

CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id,status);

CREATE INDEX IF NOT EXISTS idx_orders_outlet ON orders(outlet_id,status);

CREATE INDEX IF NOT EXISTS idx_orders_guest ON orders(guest_session);

CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);

CREATE INDEX IF NOT EXISTS idx_earnings_rider ON rider_earnings(rider_id,created_at);

CREATE INDEX IF NOT EXISTS idx_payouts_rider ON rider_payouts(rider_id,created_at);

CREATE INDEX IF NOT EXISTS idx_deposits_rider ON cod_deposits(rider_id,created_at);

CREATE INDEX IF NOT EXISTS idx_payout_requests_rider ON payout_requests(rider_id,created_at);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

INSERT INTO platform_records(kind,id,data) VALUES('payments','cod','{"name":"Cash on delivery","type":"cod","instructions":"Pay your rider when your order arrives.","active":true,"position":0}') ON CONFLICT DO NOTHING;

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE admin_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE platform_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE area_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE rider_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_details ENABLE ROW LEVEL SECURITY;

ALTER TABLE coupon_uses ENABLE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE rider_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE rider_earnings ENABLE ROW LEVEL SECURITY;

ALTER TABLE rider_payouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_flow ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_proofs ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_settlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE cod_deposits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,reset_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA dellvit FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA dellvit FROM PUBLIC;
COMMIT;
