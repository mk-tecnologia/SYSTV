import { readFile } from 'node:fs/promises';

const repository = 'https://github.com/mk-tecnologia/systv';
const parts = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
export function isNewerVersion(candidate, current) {
  const a = parts(candidate), b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export async function createVersionStatus({ fetch: request = globalThis.fetch, now = Date.now } = {}) {
  const current = (await readFile(new URL('../VERSION', import.meta.url), 'utf8')).trim();
  let cached, expires = 0, pending;
  async function check() {
    try {
      const response = await request('https://api.github.com/repos/mk-tecnologia/systv/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SYSTV-version-check' },
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!response.ok) throw new Error('Release indisponível');
      const release = await response.json();
      if (!parts(release.tag_name) || release.draft || release.prerelease) throw new Error('Release inválida');
      cached = { current, latest: release.tag_name.replace(/^v/, ''), status: 'checked',
        update_available: isNewerVersion(release.tag_name, current),
        release_url: `${repository}/releases/tag/${encodeURIComponent(release.tag_name)}` };
      expires = now() + 60 * 60 * 1000;
    } catch {
      cached = { current, latest: null, status: 'unavailable', update_available: false, release_url: `${repository}/releases/latest` };
      expires = now() + 5 * 60 * 1000;
    }
    return cached;
  }
  return async () => {
    if (cached && now() < expires) return cached;
    if (!pending) pending = check().finally(() => { pending = undefined; });
    return pending;
  };
}
