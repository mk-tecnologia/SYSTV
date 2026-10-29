import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  origin: process.env.PUBLIC_ORIGIN,
  trustProxy: process.env.TRUST_PROXY === 'loopback',
  secureCookie: process.env.COOKIE_SECURE === 'true',
  password: process.env.ADMIN_PASSWORD,
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  mailEncryptionKey: process.env.MAIL_ENCRYPTION_KEY,
  production: process.env.NODE_ENV === 'production',
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'systv',
    user: process.env.DB_USER || 'systv',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    charset: 'utf8mb4',
    timezone: 'Z',
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: 10000,
  },
};
