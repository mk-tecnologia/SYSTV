#!/usr/bin/env bash
# Somente no Debian descartável novo; falha real de npm antes da primeira publicação.
set -Eeuo pipefail
cd /var/tmp/systv-source
cp package-lock.json /var/tmp/systv-original-lock.json
printf '{invalid-json\n' > package-lock.json
if bash deploy/debian/install.sh --origin https://127.0.0.1 --hostname srv-systv --domain mk.intranet --timezone America/Sao_Paulo; then
  echo 'Instalação com lockfile inválido foi aceita.' >&2; exit 1
fi
[[ -f /etc/systv/install-pending.json ]]
[[ $(stat -c %a /etc/systv/install-pending.json) == 600 ]]
env_digest() {
  python3 - <<'ENV'
import hashlib, json
from pathlib import Path
values=dict(line.split('=',1) for line in Path('/etc/systv/systv.env').read_text().splitlines() if '=' in line)
print(hashlib.sha256(json.dumps(values,sort_keys=True).encode()).hexdigest())
ENV
}
ENV_HASH=$(env_digest)
cp /var/tmp/systv-original-lock.json package-lock.json
bash deploy/debian/install.sh --resume
[[ $(env_digest) == "$ENV_HASH" ]]
[[ ! -e /etc/systv/install-pending.json ]]
[[ $(hostnamectl --static) == srv-systv ]]
grep -q "srv-systv.mk.intranet" /etc/issue
systvctl doctor
# Falha tardia de migração em atualização deve restaurar código e runtime anteriores.
OLD=$(readlink -f /opt/systv/current)
python3 - <<'PY'
import json
from pathlib import Path
version='99.0.0'
Path('VERSION').write_text(version+'\n')
for filename in ['package.json','package-lock.json']:
    p=Path(filename); data=json.loads(p.read_text()); data['version']=version
    if filename.endswith('lock.json'): data['packages']['']['version']=version
    p.write_text(json.dumps(data))
Path('database/migrations/999_test_failure.sql').write_text('THIS IS NOT VALID SQL;\n')
PY
if bash deploy/debian/install.sh --update; then
  echo 'Migração inválida foi aceita.' >&2; exit 1
fi
[[ $(readlink -f /opt/systv/current) == "$OLD" ]]
grep -q "SYSTV $(cat "$OLD/VERSION") =>" /etc/issue
systvctl doctor
echo 'Retomada sem alteração de credenciais e recuperação de atualização: OK'
