ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled TINYINT UNSIGNED NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
CREATE TABLE IF NOT EXISTS mail_settings (
 id TINYINT UNSIGNED PRIMARY KEY,
 config_json TEXT NOT NULL,
 secrets_encrypted TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS auth_challenges (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id INT UNSIGNED NOT NULL,
 purpose ENUM('login','enable','reset') NOT NULL,
 code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 email VARCHAR(254) NOT NULL,
 password_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX challenge_user (user_id,purpose,created_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
