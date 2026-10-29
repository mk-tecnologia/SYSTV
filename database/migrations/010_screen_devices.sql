CREATE TABLE IF NOT EXISTS screen_devices (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  screen_id VARCHAR(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY device_screen (screen_id,device_id),
  FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
