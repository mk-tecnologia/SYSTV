import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(deriveKey);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}
