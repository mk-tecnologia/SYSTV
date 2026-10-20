CREATE TABLE IF NOT EXISTS initial_setup (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at DATETIME NULL,
  completed_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO initial_setup (id) VALUES (1);

UPDATE initial_setup SET completed_at=COALESCE(completed_at,UTC_TIMESTAMP()),token_hash=NULL,expires_at=NULL
WHERE id=1 AND EXISTS (SELECT 1 FROM users);
