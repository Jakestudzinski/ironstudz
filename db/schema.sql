-- Inventory system schema (multi-business ready)
-- Requires PostgreSQL 13+ (gen_random_uuid is built in).
-- User ids are stored as text so they work with the website's existing users table.

BEGIN;

CREATE TABLE businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Which website users (managers) can work in which business
CREATE TABLE business_users (
  business_id uuid NOT NULL REFERENCES businesses(id),
  user_id     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

-- One or more API keys per business; only a SHA-256 hash is stored
CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  key_hash    text NOT NULL UNIQUE,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- Physical locations are shared across businesses (same building).
-- Stock still belongs to one business through its variant.
CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  area        text NOT NULL CHECK (area IN ('back_stock', 'packing_station', 'storage')),
  is_active   boolean NOT NULL DEFAULT true
);

INSERT INTO locations (name, area) VALUES
  ('Back 1', 'back_stock'),
  ('Rack A', 'packing_station'),
  ('Rack C', 'packing_station'),
  ('D6', 'storage'),
  ('D3', 'storage'),
  ('D2', 'storage');

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id),
  name          text NOT NULL,
  category      text NOT NULL CHECK (category IN ('peptide', 'skin_care', 'pre_workout')),
  strength_size text,
  is_priority   boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_business_idx ON products (business_id);

CREATE TABLE variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses(id),
  product_id        uuid NOT NULL REFERENCES products(id),
  package_type      text NOT NULL CHECK (package_type IN ('kit', 'half_kit', 'vial', 'unit')),
  units_per_package integer NOT NULL CHECK (units_per_package > 0),
  sku               text NOT NULL,
  home_location_id  uuid REFERENCES locations(id),
  min_level         integer NOT NULL DEFAULT 0 CHECK (min_level >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku)
);

CREATE TABLE lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES products(id),
  lot_number        text NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  testing_status    text NOT NULL DEFAULT 'in_testing'
                    CHECK (testing_status IN ('in_testing', 'passed', 'failed')),
  status_changed_at timestamptz,
  status_changed_by text,
  notes             text,
  UNIQUE (product_id, lot_number)
);

CREATE TABLE stock (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  uuid NOT NULL REFERENCES variants(id),
  lot_id      uuid NOT NULL REFERENCES lots(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  quantity    integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, lot_id, location_id)
);

CREATE TABLE receipts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  reference   text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes       text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, reference)
);

CREATE TABLE movements (
  id               bigserial PRIMARY KEY,
  business_id      uuid NOT NULL REFERENCES businesses(id),
  movement_type    text NOT NULL
                   CHECK (movement_type IN ('received', 'sold', 'break_down', 'transfer', 'adjustment')),
  variant_id       uuid NOT NULL REFERENCES variants(id),
  lot_id           uuid NOT NULL REFERENCES lots(id),
  from_location_id uuid REFERENCES locations(id),
  to_location_id   uuid REFERENCES locations(id),
  quantity         integer NOT NULL CHECK (quantity > 0),
  reason           text CHECK (reason IS NULL OR reason IN
                   ('count_correction', 'damaged', 'failed_testing', 'order_cancelled', 'other')),
  order_ref        text,
  receipt_id       uuid REFERENCES receipts(id),
  user_id          text,          -- NULL means the website did it automatically
  group_id         uuid,          -- ties related rows together (e.g. a break down)
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movements_business_time_idx ON movements (business_id, created_at DESC);
CREATE INDEX movements_variant_type_time_idx ON movements (variant_id, movement_type, created_at);

-- Paid orders received from a business website (also makes orders idempotent)
CREATE TABLE inbound_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id),
  order_ref          text NOT NULL,
  paid_at            timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'needs_review')),
  cancelled_at       timestamptz,
  cancel_type        text CHECK (cancel_type IS NULL OR cancel_type IN ('cancelled', 'refunded')),
  cancel_reviewed_at timestamptz,
  cancel_reviewed_by text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, order_ref)
);

-- Problems found while deducting an order (unknown SKU, not enough passed stock)
CREATE TABLE inbound_order_issues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_order_id   uuid NOT NULL REFERENCES inbound_orders(id),
  sku                text NOT NULL,
  quantity_requested integer NOT NULL,
  quantity_deducted  integer NOT NULL DEFAULT 0,
  issue              text NOT NULL CHECK (issue IN ('unknown_sku', 'insufficient_stock')),
  resolved_at        timestamptz,
  resolved_by        text
);

-- Log of every inbound API request
CREATE TABLE inbound_requests (
  id          bigserial PRIMARY KEY,
  business_id uuid REFERENCES businesses(id),
  endpoint    text NOT NULL,
  reference   text,
  status_code integer NOT NULL,
  payload     jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_settings (
  business_id              uuid PRIMARY KEY REFERENCES businesses(id),
  email_time               time NOT NULL DEFAULT '07:00',
  email_recipients         text[] NOT NULL DEFAULT '{}',
  cover_days               integer NOT NULL DEFAULT 90,
  sales_window_days        integer NOT NULL DEFAULT 60,
  testing_overdue_days     integer NOT NULL DEFAULT 40,
  count_mismatch_threshold integer NOT NULL DEFAULT 2
);

COMMIT;
