CREATE TABLE IF NOT EXISTS screen_presence (
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  screen_id VARCHAR(32) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  INDEX presence_seen (last_seen_at),
  INDEX presence_screen (screen_id),
  FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
