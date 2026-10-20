export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32000) throw new HttpError(413, 'Requisição muito grande.');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, 'JSON inválido.'); }
}

export function validText(value, max = 120) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

export function validId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Identificador inválido.');
  return id;
}
