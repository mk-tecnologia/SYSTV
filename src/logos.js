import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { requireAdmin, requireCurrentAdmin } from './users.js';

export function validSide(side) {
  if (!['left', 'right'].includes(side)) throw new HttpError(404, 'Logo não encontrada.');
}

export async function readLogo(req) {
  const mime = req.headers['content-type']?.split(';')[0];
  if (!['image/png','image/jpeg','image/webp'].includes(mime)) throw new HttpError(415, 'Envie uma imagem PNG, JPEG ou WebP.');
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new HttpError(413, 'A imagem deve ter no máximo 5 MB.');
    parts.push(chunk);
  }
  const data = Buffer.concat(parts);
  const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const webp = data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new HttpError(415, 'O arquivo não é uma imagem PNG, JPEG ou WebP válida.');
  try {
    const image = sharp(data, { limitInputPixels: 25000000 });
    const metadata = await image.metadata();
    if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error();
    return await image.rotate().resize({ width: 640, height: 320, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw new HttpError(400, 'Imagem inválida ou muito grande. Use uma imagem estática de até 25 megapixels.'); }
}

export function createLogos(db) {
  return {
    async get(side) {
      validSide(side);
      const [logo] = await db.query('SELECT data,etag FROM logos WHERE side=?', [side]);
      if (!logo) throw new HttpError(404, 'Logo não encontrada.');
      return logo;
    },
    async save(side, data, user) {
      requireAdmin(user); validSide(side);
      const etag = createHash('sha256').update(data).digest('hex');
      await db.transaction(async connection => {
        await connection.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireCurrentAdmin(connection, user);
        await connection.execute('INSERT INTO logos (side,data,etag) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),etag=VALUES(etag)', [side, data, etag]);
      });
    },
    async delete(side, user) {
      requireAdmin(user); validSide(side);
      await db.transaction(async connection => {
        await connection.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireCurrentAdmin(connection, user);
        await connection.execute('DELETE FROM logos WHERE side=?', [side]);
      });
    },
  };
}
