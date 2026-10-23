-- Request counters for rate limiting the inbound API (fixed windows). Old windows are cleaned up as it runs.
CREATE TABLE rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
