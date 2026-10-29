#!/usr/bin/env bash
# Executar somente no Debian descartável já provisionado pelos smoke tests.
set -Eeuo pipefail
[[ $(stat -c %U /opt/systv/current/server.js) == root ]]
for user in systv systv-build; do
  for target in /opt/systv/current /opt/systv/current/server.js /opt/systv/current/deploy/debian/systvctl /opt/systv/current/node; do
    runuser -u "$user" -- test ! -w "$target"
  done
done
runuser -u systv-build -- test ! -r /etc/systv/systv.env
[[ $(readlink /opt/systv/node) == /opt/systv/current/node ]]
[[ -x /opt/systv/current/node/bin/node ]]
[[ ! -e /etc/systv/install-pending.json ]]
grep -q '^TRUST_PROXY=loopback$' /etc/systv/systv.env
# A variável pertence ao Nginx e precisa permanecer literal.
# shellcheck disable=SC2016
grep -q 'proxy_set_header X-Real-IP $remote_addr;' /etc/nginx/sites-available/systv
grep -q 'limit_req_zone' /etc/nginx/conf.d/systv-limits.conf
# O proxy sobrescreve cabeçalhos fornecidos pelo cliente: variar X-Real-IP não burla a cota.
status=''
for index in {1..11}; do
  status=$(curl --silent --show-error --noproxy '*' --interface 127.0.0.2 -o /dev/null -w '%{http_code}' \
    -H "X-Real-IP: 198.51.100.$index" -H 'Content-Type: application/json' \
    -d '{"username":"!","password":"invalid"}' http://127.0.0.1/api/login)
done
[[ $status == 429 ]]
# Outro cliente do mesmo Nginx ainda alcança a validação normal.
status=$(curl --silent --show-error --noproxy '*' --interface 127.0.0.3 -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -d '{"username":"!","password":"invalid"}' http://127.0.0.1/api/login)
[[ $status == 401 ]]
status=$(curl --silent --show-error --noproxy '*' -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -d '{"device":"11111111-1111-4111-8111-111111111111"}' \
  http://127.0.0.1/api/screens/tv01/heartbeat)
[[ $status == 401 ]]
echo 'Permissões, runtime, proxy e presença autenticada: OK'
