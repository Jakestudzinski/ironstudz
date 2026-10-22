-- Phase 1 additions: stock counts and the business switcher preference

CREATE TABLE stock_counts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finished', 'cancelled')),
  started_by  text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_by text,
  finished_at timestamptz
);
-- Only one open count per business + location at a time
CREATE UNIQUE INDEX stock_counts_one_open_idx ON stock_counts (business_id, location_id) WHERE status = 'open';

CREATE TABLE stock_count_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id uuid NOT NULL REFERENCES stock_counts(id),
  variant_id     uuid NOT NULL REFERENCES variants(id),
  lot_id         uuid NOT NULL REFERENCES lots(id),
  expected_qty   integer NOT NULL CHECK (expected_qty >= 0),
  counted_qty    integer CHECK (counted_qty IS NULL OR counted_qty >= 0),
  UNIQUE (stock_count_id, variant_id, lot_id)
);

CREATE TABLE user_preferences (
  user_id            text PRIMARY KEY,
  active_business_id uuid REFERENCES businesses(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
