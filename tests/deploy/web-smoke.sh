#!/usr/bin/env bash
# TLS e recuperação: somente no Debian descartável preparado pela CI.
set -Eeuo pipefail
SOURCE=/var/tmp/systv-source
credentials_digest() {
  /opt/systv/node/bin/node --env-file=/etc/systv/systv.env --input-type=module -e 'import {createHash} from "node:crypto"; console.log(createHash("sha256").update(["ADMIN_PASSWORD","DB_PASSWORD","MAIL_ENCRYPTION_KEY"].map(k=>process.env[k]).join("\0")).digest("hex"))'
}
ORIGINAL_SECRETS=$(credentials_digest)
FIRST_VERSION=$(cat /opt/systv/current/VERSION)
FIRST_USERS=$(mariadb -N -e 'SELECT COUNT(*) FROM systv.users')
# Reproduz a configuração incompleta de uma instalação antiga após erro do Certbot.
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/systv/systv.env')
text=p.read_text().splitlines()
text=[line for line in text if not line.startswith(('PUBLIC_ORIGIN=', 'COOKIE_SECURE='))]
p.write_text('\n'.join(text)+'\nPUBLIC_ORIGIN=https://tv.empresa.intranet\nCOOKIE_SECURE=true\n')
PY
bash "$SOURCE/deploy/debian/install.sh" --configure-web --tls self-signed
curl --fail --silent --show-error --noproxy '*' --cacert /etc/systv/tls/server.crt \
  --resolve tv.empresa.intranet:443:127.0.0.1 https://tv.empresa.intranet/api/health
# O nome curto deve abrir o sistema pelo endereço correto, preservando path/query.
SHORT_HEADERS=$(curl --silent --show-error --noproxy '*' -D - -o /dev/null \
  -H 'Host: tv' 'http://127.0.0.1/tv?screen=tv01')
printf '%s' "$SHORT_HEADERS" | grep -q '302'
printf '%s' "$SHORT_HEADERS" | grep -qi 'Location: https://tv.empresa.intranet/tv?screen=tv01'
[[ $(credentials_digest) == "$ORIGINAL_SECRETS" ]]
[[ $(cat /opt/systv/current/VERSION) == "$FIRST_VERSION" ]]
[[ $(mariadb -N -e 'SELECT COUNT(*) FROM systv.users') == "$FIRST_USERS" ]]
[[ $(stat -c %a /etc/systv/tls/server.key) == 600 ]]
FIRST_CERT=$(sha256sum /etc/systv/tls/server.crt)
systvctl web --tls self-signed
[[ $(sha256sum /etc/systv/tls/server.crt) == "$FIRST_CERT" ]]
# Simula certificado da CA da empresa; as chaves existem apenas neste container.
install -d -m 0700 /var/tmp/systv-test-ca
openssl req -x509 -newkey rsa:2048 -noenc -days 2 -subj /CN=SYSTV-Test-CA \
  -addext basicConstraints=critical,CA:TRUE -keyout /var/tmp/systv-test-ca/ca.key \
  -out /var/tmp/systv-test-ca/ca.crt 2>/dev/null
openssl req -newkey rsa:2048 -noenc -subj /CN=tv.empresa.intranet \
  -addext subjectAltName=DNS:tv.empresa.intranet -keyout /var/tmp/systv-test-ca/server.key \
  -out /var/tmp/systv-test-ca/server.csr 2>/dev/null
openssl x509 -req -in /var/tmp/systv-test-ca/server.csr -CA /var/tmp/systv-test-ca/ca.crt \
  -CAkey /var/tmp/systv-test-ca/ca.key -CAcreateserial -days 2 -copy_extensions copy \
  -out /var/tmp/systv-test-ca/server.crt 2>/dev/null
cat /var/tmp/systv-test-ca/server.crt /var/tmp/systv-test-ca/ca.crt > /var/tmp/systv-test-ca/fullchain.pem
systvctl web --tls provided --tls-cert /var/tmp/systv-test-ca/fullchain.pem --tls-key /var/tmp/systv-test-ca/server.key
curl --fail --silent --show-error --noproxy '*' --cacert /var/tmp/systv-test-ca/ca.crt \
  --resolve tv.empresa.intranet:443:127.0.0.1 https://tv.empresa.intranet/api/health
ENV_HASH=$(sha256sum /etc/systv/systv.env)
NGINX_HASH=$(sha256sum /etc/nginx/sites-available/systv)
if systvctl web --origin https://outro.empresa.intranet --tls provided \
  --tls-cert /var/tmp/systv-test-ca/fullchain.pem --tls-key /var/tmp/systv-test-ca/server.key; then
  echo 'Certificado para hostname errado foi aceito.' >&2; exit 1
fi
if systvctl web --tls letsencrypt --email admin@example.com; then
  echo "Let's Encrypt foi aceito para nome interno." >&2; exit 1
fi
[[ $(sha256sum /etc/systv/systv.env) == "$ENV_HASH" ]]
[[ $(sha256sum /etc/nginx/sites-available/systv) == "$NGINX_HASH" ]]
# Erro de configuração Nginx restaura origem, cookies e o certificado anterior.
printf 'invalid_test_directive;\n' > /etc/nginx/conf.d/systv-test-invalid.conf
if systvctl web --origin http://127.0.0.1 --tls none; then
  echo 'Nginx inválido foi aceito.' >&2; exit 1
fi
rm /etc/nginx/conf.d/systv-test-invalid.conf
[[ $(sha256sum /etc/systv/systv.env) == "$ENV_HASH" ]]
[[ $(sha256sum /etc/nginx/sites-available/systv) == "$NGINX_HASH" ]]
if systvctl web --origin http://tv.empresa.intranet --tls none; then
  echo 'HTTP de rede foi aceito.' >&2; exit 1
fi
systvctl web --origin http://127.0.0.1 --tls none
[[ $(credentials_digest) == "$ORIGINAL_SECRETS" ]]
grep -q '^COOKIE_SECURE=false$' /etc/systv/systv.env
curl --fail --silent --show-error http://127.0.0.1/api/health
systvctl doctor
