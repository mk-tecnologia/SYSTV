#!/usr/bin/env bash
# Executado somente em um container descartável Debian 13 com systemd real.
set -Eeuo pipefail
SOURCE=/var/tmp/systv-source
cd "$SOURCE"
bash deploy/debian/install.sh --origin http://127.0.0.1
systvctl doctor
# Exercita autenticação, inicialização vazia e permissões do serviço real.
/opt/systv/node/bin/node --env-file=/etc/systv/systv.env --input-type=module <<'JS'
import assert from 'node:assert/strict';
const state = await (await fetch('http://127.0.0.1/api/state')).json();
assert.equal(state.products.length, 0);
assert.equal(state.screens.length, 1);
assert.equal(state.settings.name, 'Minha empresa');
const login = await fetch('http://127.0.0.1/api/login', {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: process.env.PUBLIC_ORIGIN},
  body: JSON.stringify({username: 'admin', password: process.env.ADMIN_PASSWORD}),
});
assert.equal(login.status, 200);
assert.match(login.headers.get('set-cookie'), /HttpOnly/);
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
Path('VERSION').write_text('2.1.1\n')
for file in ['package.json', 'package-lock.json']:
    path = Path(file)
    data = json.loads(path.read_text())
    data['version'] = '2.1.1'
    if file.endswith('lock.json'):
        data['packages']['']['version'] = '2.1.1'
    path.write_text(json.dumps(data))
PY
bash deploy/debian/install.sh --update
[[ $(cat /opt/systv/current/VERSION) == 2.1.1 ]]
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
