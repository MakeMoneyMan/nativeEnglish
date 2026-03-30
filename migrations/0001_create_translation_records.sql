CREATE TABLE IF NOT EXISTS translation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  corrected TEXT NOT NULL DEFAULT '',
  polished TEXT NOT NULL DEFAULT '',
  colloquial TEXT NOT NULL DEFAULT '',
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_translation_records_created_at
ON translation_records(created_at DESC);
