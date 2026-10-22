-- Counting by weight: each product's weight of one vial, and the weight entered on a count line.
ALTER TABLE products
  ADD COLUMN vial_weight_g          numeric(8,3) CHECK (vial_weight_g IS NULL OR vial_weight_g > 0),
  ADD COLUMN vial_weight_updated_at timestamptz,
  ADD COLUMN vial_weight_updated_by text;

ALTER TABLE stock_count_lines
  ADD COLUMN counted_weight_g numeric(10,3) CHECK (counted_weight_g IS NULL OR counted_weight_g >= 0);
