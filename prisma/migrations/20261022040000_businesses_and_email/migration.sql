-- What a business mainly sells (shown on the Businesses screen).
ALTER TABLE businesses
  ADD COLUMN sells text CHECK (sells IS NULL OR sells IN ('peptide', 'skin_care', 'pre_workout'));

-- One row per business per Phoenix day: the daily email is only ever sent once a day.
CREATE TABLE daily_email_sends (
  id          bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  send_date   date NOT NULL,
  status      text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'preview')),
  attempts    integer NOT NULL DEFAULT 1,
  recipients  text[] NOT NULL DEFAULT '{}',
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, send_date)
);
