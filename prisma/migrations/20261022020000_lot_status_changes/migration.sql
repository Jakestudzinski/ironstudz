-- Every change to a lot's testing status, with who, when and why. Rows are never updated or deleted.
CREATE TABLE lot_status_changes (
  id          bigserial PRIMARY KEY,
  lot_id      uuid NOT NULL REFERENCES lots(id),
  from_status text NOT NULL CHECK (from_status IN ('in_testing', 'passed', 'failed')),
  to_status   text NOT NULL CHECK (to_status IN ('in_testing', 'passed', 'failed')),
  note        text,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status <> to_status)
);
CREATE INDEX lot_status_changes_lot_idx ON lot_status_changes (lot_id, changed_at DESC);
