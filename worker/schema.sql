CREATE TABLE IF NOT EXISTS state (
  id         TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(ip, ts);
