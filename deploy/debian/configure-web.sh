#!/usr/bin/env bash
# Configuração transacional do proxy e da origem. Não modifica o banco.
set -Eeuo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ORIGIN=''
TLS_MODE=''
TLS_CERT=''
TLS_KEY=''
EMAIL=''
RENEW=false
fail() { echo "Erro: $*" >&2; exit 1; }
while (($#)); do
  case $1 in
    --origin|--tls|--tls-cert|--tls-key|--email)
      [[ $# -ge 2 ]] || fail "Falta valor para $1"
      case $1 in
        --origin) ORIGIN=$2 ;; --tls) TLS_MODE=$2 ;; --tls-cert) TLS_CERT=$2 ;;
        --tls-key) TLS_KEY=$2 ;; --email) EMAIL=$2 ;;
      esac
      shift 2 ;;
    --renew-certificate) RENEW=true; shift ;;
    -h|--help)
      echo 'Uso: systvctl web [--origin URL] [--tls none|self-signed|provided|letsencrypt]'
      echo 'Certificado da empresa: --tls provided --tls-cert /caminho/fullchain.pem --tls-key /caminho/key.pem'
      exit 0 ;;
    *) fail "Opção desconhecida: $1" ;;
  esac
done
[[ $EUID == 0 ]] || fail 'Execute como root.'
[[ -L /opt/systv/current && -f /etc/systv/systv.env ]] || fail 'Instalação por releases não encontrada.'
if [[ ${SYSTV_DEPLOY_LOCK_HELD:-} != 1 ]]; then
  exec 9>/run/lock/systv-deploy.lock
  flock -n 9 || fail 'Outra manutenção está em andamento.'
fi
if [[ -z $ORIGIN ]]; then
  ORIGIN=$(/opt/systv/node/bin/node --env-file=/etc/systv/systv.env --input-type=module -e 'console.log(process.env.PUBLIC_ORIGIN || "")')
fi
# shellcheck disable=SC1091
source "$SCRIPT_DIR/web-common.sh"
web_validate
[[ $RENEW == false || $TLS_MODE == self-signed ]] || fail '--renew-certificate só pode ser usado com self-signed.'
if [[ $TLS_MODE == letsencrypt ]]; then
  # Este fluxo usa HTTP-01. Servidores internos com domínio público podem usar
  # DNS-01 fora do instalador e importar o certificado com provided.
  python3 - "$SITE_HOST" <<'PY'
import ipaddress, socket, sys
try:
    addresses = {r[4][0] for r in socket.getaddrinfo(sys.argv[1], 80, type=socket.SOCK_STREAM)}
except socket.gaierror:
    raise SystemExit('O domínio não resolve. Use HTTPS local/CA interna para intranet.')
if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
    raise SystemExit('HTTP-01 exige DNS público e acesso externo à porta 80. Use self-signed/provided na intranet.')
PY
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y certbot python3-certbot-nginx
fi
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
mkdir "$WORK/tls"
check_pair() {
  local cert=$1 key=$2
  openssl x509 -in "$cert" -checkend 86400 -noout >/dev/null || fail 'Certificado expirado ou com menos de um dia de validade.'
  if [[ $SITE_HOST =~ ^[0-9.]+$ ]]; then
    openssl x509 -in "$cert" -checkip "$SITE_HOST" -noout >/dev/null || fail 'Certificado não atende o IP da URL.'
  else
    openssl x509 -in "$cert" -checkhost "$SITE_HOST" -noout >/dev/null || fail 'Certificado não atende o hostname da URL.'
  fi
  [[ $(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum) == \
     "$(openssl pkey -in "$key" -passin pass: -pubout -outform DER | sha256sum)" ]] || fail 'A chave privada não corresponde ao certificado.'
}
case $TLS_MODE in
  self-signed)
    REUSE=false
    if [[ $RENEW == false && -f /etc/systv/web-mode && $(cat /etc/systv/web-mode) == self-signed && -f /etc/systv/tls/server.crt && -f /etc/systv/tls/server.key ]]; then
      if openssl x509 -in /etc/systv/tls/server.crt -checkend 2592000 -noout >/dev/null; then
        if [[ $SITE_HOST =~ ^[0-9.]+$ ]]; then
          openssl x509 -in /etc/systv/tls/server.crt -checkip "$SITE_HOST" -noout >/dev/null && REUSE=true
        else
          openssl x509 -in /etc/systv/tls/server.crt -checkhost "$SITE_HOST" -noout >/dev/null && REUSE=true
        fi
      fi
    fi
    if [[ $REUSE == true ]]; then
      cp /etc/systv/tls/server.crt /etc/systv/tls/server.key "$WORK/tls/"
    else
      SAN=DNS:$SITE_HOST
      [[ ! $SITE_HOST =~ ^[0-9.]+$ ]] || SAN=IP:$SITE_HOST
      openssl req -x509 -newkey rsa:3072 -noenc -sha256 -days 365 \
        -subj "/CN=$SITE_HOST" -addext "subjectAltName=$SAN" \
        -addext 'extendedKeyUsage=serverAuth' \
        -keyout "$WORK/tls/server.key" -out "$WORK/tls/server.crt" 2>/dev/null
    fi
    check_pair "$WORK/tls/server.crt" "$WORK/tls/server.key" ;;
  provided)
    check_pair "$TLS_CERT" "$TLS_KEY"
    install -m 0644 "$TLS_CERT" "$WORK/tls/server.crt"
    install -m 0600 "$TLS_KEY" "$WORK/tls/server.key" ;;
esac
# Snapshot privado antes de alterar qualquer arquivo da instalação.
SNAPSHOT_FILES=(etc/systv)
# O banner original e o MOTD não dependem mais da URL do painel.
HAD_LIMITS=false
if [[ -f /etc/nginx/conf.d/systv-limits.conf ]]; then
  HAD_LIMITS=true; SNAPSHOT_FILES+=(etc/nginx/conf.d/systv-limits.conf)
fi
[[ ! -f /etc/nginx/sites-available/systv ]] || SNAPSHOT_FILES+=(etc/nginx/sites-available/systv)
install -d -m 0700 /var/backups/systv
SNAPSHOT=/var/backups/systv/web-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz
tar -czf "$SNAPSHOT" -C / "${SNAPSHOT_FILES[@]}"
HAD_SITE=false
[[ ! -f /etc/nginx/sites-available/systv ]] || HAD_SITE=true
HAD_LINK=false
[[ ! -L /etc/nginx/sites-enabled/systv ]] || HAD_LINK=true
rollback() {
  local status=$?
  trap - ERR
  tar -xzf "$SNAPSHOT" -C / || true
  if [[ $HAD_LIMITS == false ]]; then rm -f /etc/nginx/conf.d/systv-limits.conf; fi
  if [[ $HAD_SITE == false ]]; then rm -f /etc/nginx/sites-available/systv; fi
  if [[ $HAD_LINK == false ]]; then rm -f /etc/nginx/sites-enabled/systv; fi
  if nginx -t; then systemctl reload nginx || true; fi
  systemctl reset-failed systv || true
  systemctl restart systv || true
  echo "Configuração anterior restaurada. Snapshot: $SNAPSHOT" >&2
  exit "$status"
}
trap rollback ERR
if [[ $TLS_MODE == self-signed || $TLS_MODE == provided ]]; then
  install -d -m 0700 /etc/systv/tls
  install -m 0644 "$WORK/tls/server.crt" /etc/systv/tls/server.crt
  install -m 0600 "$WORK/tls/server.key" /etc/systv/tls/server.key
fi
# Atualiza somente origem/cookie; preserva senhas e chave SMTP, sem source/eval.
python3 - "$ORIGIN" "$SCHEME" <<'PY'
import os, pathlib, tempfile
import sys
path = pathlib.Path('/etc/systv/systv.env')
meta = path.stat()
values = {'PUBLIC_ORIGIN': sys.argv[1], 'COOKIE_SECURE': str(sys.argv[2] == 'https').lower()}
lines = [line for line in path.read_text().splitlines() if line.split('=', 1)[0] not in values]
lines.extend(f'{key}={value}' for key, value in values.items())
fd, name = tempfile.mkstemp(dir=path.parent)
with os.fdopen(fd, 'w') as output:
    output.write('\n'.join(lines) + '\n')
    os.fchown(output.fileno(), meta.st_uid, meta.st_gid)
    os.fchmod(output.fileno(), 0o640)
os.replace(name, path)
access = path.parent / 'acesso-inicial.txt'
if access.exists():
    text = '\n'.join('URL: ' + sys.argv[1] if line.startswith('URL: ') else line for line in access.read_text().splitlines())
    access.write_text(text + '\n')
    access.chmod(0o600)
activation = path.parent / 'activation-link.txt'
if activation.exists():
    from urllib.parse import urlsplit
    fragment = urlsplit(activation.read_text().strip()).fragment
    if fragment:
        activation.write_text(sys.argv[1] + '/activate#' + fragment + '\n')
        activation.chmod(0o600)
PY
PROXY=$(cat <<'NGINX'
    client_max_body_size 8m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
NGINX
)
if [[ $TLS_MODE == none || $TLS_MODE == letsencrypt ]]; then
  cat > /etc/nginx/sites-available/systv <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SITE_HOST;
$PROXY
}
NGINX
else
  cat > /etc/nginx/sites-available/systv <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SITE_HOST;
    return 301 https://$SITE_HOST\$request_uri;
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $SITE_HOST;
    ssl_certificate /etc/systv/tls/server.crt;
    ssl_certificate_key /etc/systv/tls/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
$PROXY
}
NGINX
fi
# O nome curto entra somente por HTTP e redireciona à origem canônica.
# O certificado continua vinculado ao nome completo; não altera outros sites/default.
if [[ $SITE_HOST == *.* && ! $SITE_HOST =~ ^[0-9.]+$ ]]; then
  SHORT_HOST=${SITE_HOST%%.*}
  cat >> /etc/nginx/sites-available/systv <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SHORT_HOST;
    return 302 $ORIGIN\$request_uri;
}
NGINX
fi
chmod 0644 /etc/nginx/sites-available/systv
if [[ ! -L /etc/nginx/sites-enabled/systv ]]; then
  [[ ! -e /etc/nginx/sites-enabled/systv ]] || { echo 'Arquivo conflitante em sites-enabled.' >&2; false; }
  ln -s /etc/nginx/sites-available/systv /etc/nginx/sites-enabled/systv
fi
python3 "$SCRIPT_DIR/harden-web.py"
nginx -t
systemctl enable --now nginx
systemctl reload nginx
if [[ $TLS_MODE == letsencrypt ]]; then
  certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" -d "$SITE_HOST"
  systemctl enable --now certbot.timer
fi
systemctl reset-failed systv
systemctl restart systv
for _attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health > /dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet systv
PORT=80
CURL_ARGS=()
if [[ $SCHEME == https ]]; then
  PORT=443
  [[ $TLS_MODE == letsencrypt ]] || CURL_ARGS+=(--cacert /etc/systv/tls/server.crt)
fi
curl --fail --silent --show-error --noproxy '*' "${CURL_ARGS[@]}" --resolve "$SITE_HOST:$PORT:127.0.0.1" "$ORIGIN/api/health" >/dev/null
printf '%s\n' "$TLS_MODE" > /etc/systv/web-mode
python3 "$SCRIPT_DIR/configure-server.py" --refresh
trap - ERR
printf '\nAcesso configurado: %s\nModo: %s\nSnapshot anterior: %s\n' "$ORIGIN" "$TLS_MODE" "$SNAPSHOT"
if [[ $TLS_MODE == self-signed ]]; then
  echo 'Certificado local: /etc/systv/tls/server.crt (validade de um ano).'
  echo 'Distribua e confie neste certificado nos computadores/TVs; sem isso o navegador exibe alerta.'
  openssl x509 -in /etc/systv/tls/server.crt -fingerprint -sha256 -noout
fi
