-- A note saying how an order issue (unknown SKU or shortfall) was resolved.
ALTER TABLE inbound_order_issues ADD COLUMN resolution_note text;
