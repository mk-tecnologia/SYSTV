#!/usr/bin/env bash
# Executado somente em um container descartável Debian 13 com systemd real.
set -Eeuo pipefail
SOURCE=/var/tmp/systv-source
cd "$SOURCE"
if [[ ! -L /opt/systv/current ]]; then
  TEST_SCHEME=${SYSTV_TEST_TRANSPORT:-http}
  bash deploy/debian/install.sh --origin "$TEST_SCHEME://127.0.0.1"
fi
systvctl doctor
# Exercita autenticação, inicialização vazia e permissões do serviço real.
NODE_TEST_CA=''
[[ ! -f /etc/systv/tls/server.crt ]] || NODE_TEST_CA=/etc/systv/tls/server.crt
NODE_EXTRA_CA_CERTS="$NODE_TEST_CA" /opt/systv/node/bin/node --env-file=/etc/systv/systv.env --input-type=module <<'JS'
import assert from 'node:assert/strict';
const state = await (await fetch(process.env.PUBLIC_ORIGIN + '/api/state')).json();
assert.equal(state.products.length, 0);
assert.equal(state.screens.length, 1);
assert.equal(state.settings.name, 'Minha empresa');
const login = await fetch(process.env.PUBLIC_ORIGIN + '/api/login', {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: process.env.PUBLIC_ORIGIN},
  body: JSON.stringify({username: 'admin', password: process.env.ADMIN_PASSWORD}),
});
assert.equal(login.status, 200);
assert.match(login.headers.get('set-cookie'), /HttpOnly/);
if (process.env.COOKIE_SECURE === 'true') assert.match(login.headers.get('set-cookie'), /Secure/);
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.HOST, '127.0.0.1');
JS
runuser -u systv -- test ! -w /opt/systv/current/server.js
runuser -u systv -- test ! -w /etc/systv/systv.env
ENV_HASH=$(sha256sum /etc/systv/systv.env)
FIRST=$(readlink -f /opt/systv/current)
systvctl backup
# Nova versão sintética somente para exercitar migração/ativação/rollback.
python3 - <<'PY'
import json
from pathlib import Path
major, minor, patch = map(int, Path('VERSION').read_text().strip().split('.'))
version = f'{major}.{minor}.{patch + 1}'
Path('VERSION').write_text(version + '\n')
for file in ['package.json', 'package-lock.json']:
    path = Path(file)
    data = json.loads(path.read_text())
    data['version'] = version
    if file.endswith('lock.json'):
        data['packages']['']['version'] = version
    path.write_text(json.dumps(data))
PY
NEXT_VERSION=$(cat VERSION)
bash deploy/debian/install.sh --update
[[ $(cat /opt/systv/current/VERSION) == "$NEXT_VERSION" ]]
[[ $(sha256sum /etc/systv/systv.env) == "$ENV_HASH" ]]
[[ $(readlink -f /opt/systv/current) != "$FIRST" ]]
systvctl rollback
[[ $(readlink -f /opt/systv/current) == "$FIRST" ]]
systvctl doctor
# Reinicialização dos serviços preserva o catálogo e a configuração.
systemctl restart mariadb systv nginx
for _attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1/api/health >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1/api/health

bash /var/tmp/web-smoke.sh
