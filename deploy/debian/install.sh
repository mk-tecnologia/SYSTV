#!/usr/bin/env bash
# Provisionamento e publicação de uma release de produção.
set -Eeuo pipefail
umask 027
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ORIGIN=''
EMAIL=''
MODE=install
RESUME=false
TLS_MODE=''
TLS_CERT=''
TLS_KEY=''
SERVER_HOSTNAME=''
SERVER_DOMAIN=''
SERVER_TIMEZONE=''
usage() {
  cat <<'HELP'
SYSTV — Debian 13
Uso: install.sh [--origin https://IP-ou-host --tls self-signed]
     install.sh --origin http://127.0.0.1 --tls none  # somente teste local
     install.sh --update
     install.sh --resume
     install.sh --configure-server [--hostname srv-systv --domain mk.intranet --timezone America/Sao_Paulo]
     install.sh --configure-web [--origin URL] [--tls self-signed|none|provided|letsencrypt]
HTTPS local é padrão; use --tls letsencrypt apenas em servidor público.
Sem parâmetros, solicita a URL de acesso. Instala releases em /opt/systv/releases.
HELP
}
fail() { echo "Erro: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --origin|--email|--tls|--tls-cert|--tls-key|--hostname|--domain|--timezone)
      (($# >= 2)) || fail "Falta valor para $1"
      case $1 in
        --origin) ORIGIN=$2 ;; --email) EMAIL=$2 ;; --tls) TLS_MODE=$2 ;;
        --tls-cert) TLS_CERT=$2 ;; --tls-key) TLS_KEY=$2 ;;
        --hostname) SERVER_HOSTNAME=$2 ;; --domain) SERVER_DOMAIN=$2 ;; --timezone) SERVER_TIMEZONE=$2 ;;
      esac
      shift 2 ;;
    --resume) RESUME=true; shift ;;
    --update) [[ $MODE == install ]] || fail "Escolha uma operação."; MODE=update; shift ;;
    --configure-server) [[ $MODE == install ]] || fail "Escolha uma operação."; MODE=configure-server; shift ;;
    --configure-web) [[ $MODE == install ]] || fail "Escolha uma operação."; MODE=configure-web; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Opção desconhecida: $1" ;;
  esac
done
[[ $EUID == 0 ]] || fail 'Execute como root.'
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == debian && ${VERSION_ID%%.*} == 13 ]] || fail 'Este instalador exige Debian 13.'
[[ -d /run/systemd/system ]] || fail 'É necessário systemd em execução.'
[[ -f $SOURCE/VERSION && -f $SOURCE/package-lock.json ]] || fail 'Pacote incompleto.'
VERSION=$(cat "$SOURCE/VERSION")
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Versão inválida.'
if [[ $MODE == configure-server ]]; then
  SERVER_ARGS=()
  [[ -z $ORIGIN ]] || SERVER_ARGS+=(--origin "$ORIGIN")
  [[ -z $SERVER_HOSTNAME ]] || SERVER_ARGS+=(--hostname "$SERVER_HOSTNAME")
  [[ -z $SERVER_DOMAIN ]] || SERVER_ARGS+=(--domain "$SERVER_DOMAIN")
  [[ -z $SERVER_TIMEZONE ]] || SERVER_ARGS+=(--timezone "$SERVER_TIMEZONE")
  exec bash "$SOURCE/deploy/debian/configure-server.sh" "${SERVER_ARGS[@]}"
fi
if [[ $MODE == configure-web ]]; then
  WEB_ARGS=()
  [[ -z $ORIGIN ]] || WEB_ARGS+=(--origin "$ORIGIN")
  [[ -z $TLS_MODE ]] || WEB_ARGS+=(--tls "$TLS_MODE")
  [[ -z $TLS_CERT ]] || WEB_ARGS+=(--tls-cert "$TLS_CERT")
  [[ -z $TLS_KEY ]] || WEB_ARGS+=(--tls-key "$TLS_KEY")
  [[ -z $EMAIL ]] || WEB_ARGS+=(--email "$EMAIL")
  exec bash "$SOURCE/deploy/debian/configure-web.sh" "${WEB_ARGS[@]}"
fi
# Instalações/atualizações concorrentes nunca alteram a mesma release.
exec 9>/run/lock/systv-deploy.lock
flock -n 9 || fail 'Outra instalação ou manutenção está em andamento.'
if [[ $RESUME == true ]]; then
  [[ $MODE == install ]] || fail '--resume só retoma instalação inicial.'
  [[ -f /etc/systv/install-pending.json && ! -L /etc/systv/install-pending.json && -f /etc/systv/systv.env ]] || fail 'Nenhuma instalação pendente encontrada.'
  [[ $(stat -c '%u:%a' /etc/systv/install-pending.json) == 0:600 ]] || fail 'Estado de instalação inseguro.'
  [[ -z $ORIGIN && -z $EMAIL && -z $TLS_MODE && -z $TLS_CERT && -z $TLS_KEY && -z $SERVER_HOSTNAME && -z $SERVER_DOMAIN && -z $SERVER_TIMEZONE ]] || fail '--resume reutiliza os parâmetros originais.'
  mapfile -t PENDING < <(python3 - <<'STATE'
import json
from pathlib import Path
state=json.loads(Path('/etc/systv/install-pending.json').read_text())
for key in ['origin','tls','cert','key','email','hostname','domain','timezone']:
    value=state.get(key, '')
    if not isinstance(value,str) or '\n' in value or '\r' in value: raise SystemExit('Estado inválido')
    print(value)
STATE
)
  [[ ${#PENDING[@]} == 8 ]] || fail 'Estado inválido.'
  ORIGIN=${PENDING[0]} TLS_MODE=${PENDING[1]} TLS_CERT=${PENDING[2]} TLS_KEY=${PENDING[3]} EMAIL=${PENDING[4]}
  SERVER_HOSTNAME=${PENDING[5]} SERVER_DOMAIN=${PENDING[6]} SERVER_TIMEZONE=${PENDING[7]}
fi
if [[ $MODE == install ]]; then
  if [[ $RESUME == false ]]; then
    for target in /opt/systv /etc/systv /etc/systemd/system/systv.service /etc/nginx/sites-available/systv /etc/nginx/sites-enabled/systv; do
    [[ ! -e $target && ! -L $target ]] || fail "$target já existe. Use systvctl update para uma instalação gerenciada por releases."
  done
  getent passwd systv >/dev/null && fail 'Usuário systv já existe.'
  getent group systv >/dev/null && fail 'Grupo systv já existe.'
  fi
  if [[ -z $ORIGIN ]]; then
    [[ -t 0 || -r /dev/tty ]] || fail 'Informe --origin para instalação sem terminal.'
    read -r -p "Nome do servidor [${SERVER_HOSTNAME:-srv-systv}]: " ANSWER < /dev/tty
    SERVER_HOSTNAME=${ANSWER:-${SERVER_HOSTNAME:-srv-systv}}
    SERVER_HOSTNAME=${SERVER_HOSTNAME,,}
    read -r -p "Domínio local [${SERVER_DOMAIN:-mk.intranet}]: " ANSWER < /dev/tty
    SERVER_DOMAIN=${ANSWER:-${SERVER_DOMAIN:-mk.intranet}}
    SERVER_DOMAIN=${SERVER_DOMAIN,,}
    read -r -p "Fuso horário [${SERVER_TIMEZONE:-America/Sao_Paulo}]: " ANSWER < /dev/tty
    SERVER_TIMEZONE=${ANSWER:-${SERVER_TIMEZONE:-America/Sao_Paulo}}
    read -r -p "URL de acesso [https://$SERVER_HOSTNAME.$SERVER_DOMAIN]: " ORIGIN < /dev/tty
    ORIGIN=${ORIGIN:-https://$SERVER_HOSTNAME.$SERVER_DOMAIN}
  fi
  # HTTPS sem modo explícito é local; Certbot só é usado por opção explícita.
  if [[ $TLS_MODE == letsencrypt && -z $EMAIL ]]; then
    read -r -p 'E-mail para certificado público: ' EMAIL < /dev/tty
  fi
  # shellcheck disable=SC1091
  source "$SOURCE/deploy/debian/web-common.sh"
  web_validate
else
  [[ -L /opt/systv/current && -f /etc/systv/systv.env ]] || fail 'Instalação por releases não encontrada.'
  [[ -z $ORIGIN && -z $EMAIL && -z $TLS_MODE && -z $TLS_CERT && -z $TLS_KEY ]] || fail 'Atualização preserva a URL e configuração existentes.'
fi
VALIDATE_ARGS=(--validate)
[[ -z $SERVER_HOSTNAME ]] || VALIDATE_ARGS+=(--hostname "$SERVER_HOSTNAME")
[[ -z $SERVER_DOMAIN ]] || VALIDATE_ARGS+=(--domain "$SERVER_DOMAIN")
[[ -z $SERVER_TIMEZONE ]] || VALIDATE_ARGS+=(--timezone "$SERVER_TIMEZONE")
if command -v python3 >/dev/null && [[ -f /usr/share/zoneinfo/America/Sao_Paulo ]]; then
  python3 "$SOURCE/deploy/debian/configure-server.py" "${VALIDATE_ARGS[@]}"
fi
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) fail 'Arquiteturas suportadas: amd64 e arm64.' ;;
esac
install -d -m 0750 /var/log/systv
LOG_FILE=/var/log/systv/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$$.log
exec 3>&1
exec > >(tee -a "$LOG_FILE") 2>&1
WORK=$(mktemp -d)
OLD_RELEASE=''
SWITCHED=false
STOPPED=false
INITIAL_CONFIG=''
cleanup() {
  rm -rf -- "$WORK"
  [[ -z $INITIAL_CONFIG ]] || rm -rf -- "$INITIAL_CONFIG"
}
on_error() {
  local status=$? line=$1
  trap - ERR
  # ERR também é herdado por subshells; só o processo principal faz recuperação.
  [[ $BASH_SUBSHELL == 0 ]] || exit "$status"
  echo "Falha na linha $line. Log: $LOG_FILE" >&2
  if [[ -n $OLD_RELEASE && ( $SWITCHED == true || $STOPPED == true ) ]]; then
    ln -s "$OLD_RELEASE" /opt/systv/.current-recovery-$$
    mv -Tf /opt/systv/.current-recovery-$$ /opt/systv/current
    systemctl reset-failed systv || true
    systemctl restart systv || true
    local recovered=false
    for _recovery_attempt in {1..30}; do
      if curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null; then recovered=true; break; fi
      sleep 1
    done
    if [[ $recovered == true ]]; then
      echo 'Código e runtime anteriores reativados e respondendo. Migrações não são desfeitas; confira o banco e o backup.' >&2
    else
      echo 'A recuperação não respondeu à verificação de saúde; consulte journalctl -u systv.' >&2
    fi
  fi
  if [[ -n $OLD_RELEASE && -f /etc/systv/server-profile.json ]]; then
    python3 "$SOURCE/deploy/debian/configure-server.py" --refresh || true
  fi
  if [[ $MODE == install && -f /etc/systv/install-pending.json ]]; then
    echo 'Instalação pendente preservada. Retome com o mesmo pacote: bash deploy/debian/install.sh --resume' >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'on_error "$LINENO"' ERR
export DEBIAN_FRONTEND=noninteractive
if [[ $MODE == install ]]; then
  apt-get update
  apt-get install -y ca-certificates curl xz-utils openssl mariadb-server nginx rsync python3 tzdata iproute2 procps
  python3 "$SOURCE/deploy/debian/configure-server.py" "${VALIDATE_ARGS[@]}"
  systemctl enable --now mariadb
  if [[ $RESUME == false ]]; then
  [[ $(mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='systv'") == 0 ]] || fail 'Banco systv já existe; preservado.'
  [[ $(mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM mysql.user WHERE User='systv'") == 0 ]] || fail 'Usuário MariaDB systv já existe; preservado.'
  INITIAL_CONFIG=$(mktemp -d /etc/.systv-install-XXXXXX)
  DB_PASSWORD=$(openssl rand -hex 32)
  MAIL_KEY=$(openssl rand -hex 32)
  COOKIE_SECURE=false
  [[ $SCHEME != https ]] || COOKIE_SECURE=true
  cat > "$INITIAL_CONFIG/systv.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=$ORIGIN
COOKIE_SECURE=$COOKIE_SECURE
TRUST_PROXY=loopback
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=systv
DB_USER=systv
DB_PASSWORD=$DB_PASSWORD
DB_POOL_SIZE=10
MAIL_ENCRYPTION_KEY=$MAIL_KEY
ENV
  chmod 0600 "$INITIAL_CONFIG/systv.env"
  python3 - "$ORIGIN" "$TLS_MODE" "$TLS_CERT" "$TLS_KEY" "$EMAIL" "$INITIAL_CONFIG" "$SERVER_HOSTNAME" "$SERVER_DOMAIN" "$SERVER_TIMEZONE" <<'STATE'
import json, os, sys
from pathlib import Path
path=Path(sys.argv[6]) / 'install-pending.json'
state=dict(zip(['origin','tls','cert','key','email'],sys.argv[1:6]))
state.update(zip(['hostname','domain','timezone'],sys.argv[7:10]))
path.write_text(json.dumps(state))
os.chmod(path,0o600)
STATE
  mv -T "$INITIAL_CONFIG" /etc/systv
  else
    DB_PASSWORD=$(python3 - <<'PASSWORD'
import re
from pathlib import Path
values=dict(line.split('=',1) for line in Path('/etc/systv/systv.env').read_text().splitlines() if '=' in line)
value=values.get('DB_PASSWORD','')
if not re.fullmatch('[a-f0-9]{64}', value): raise SystemExit('Credencial inválida')
print(value)
PASSWORD
)
    [[ $DB_PASSWORD =~ ^[a-f0-9]{64}$ ]] || fail 'Credencial inválida.'
  fi
  if ! getent passwd systv >/dev/null; then
    useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin systv
  fi
  [[ $(getent passwd systv | cut -d: -f6-7) == /nonexistent:/usr/sbin/nologin ]] || fail 'Conta de serviço divergente.'
  install -d -m 0750 -o root -g systv /etc/systv
  chown root:systv /etc/systv/systv.env
  chmod 0640 /etc/systv/systv.env
  mariadb <<SQL
CREATE DATABASE IF NOT EXISTS systv CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'systv'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON systv.* TO 'systv'@'127.0.0.1';
SQL
  # O responsável recebe o link após o provisionamento; não existe senha padrão.
  cat > /etc/systv/acesso-inicial.txt <<ACCESS
URL: $ORIGIN
Primeiro acesso por link de ativação, com validade de 24 horas.
O responsável define o próprio usuário e senha no navegador.
Para emitir outro link antes da ativação: systvctl activation-link.
ACCESS
  chmod 0600 /etc/systv/acesso-inicial.txt
else
  OLD_RELEASE=$(readlink -f /opt/systv/current)
  [[ $(cat "$OLD_RELEASE/VERSION") != "$VERSION" ]] || fail "A versão $VERSION já está ativa."
fi
# Mesmo perfil local nas instalações e atualizações; não altera SSH TCP ou a rede.
SERVER_ARGS=()
[[ $MODE != install ]] || SERVER_ARGS+=(--initial --origin "$ORIGIN")
[[ -z $SERVER_HOSTNAME ]] || SERVER_ARGS+=(--hostname "$SERVER_HOSTNAME")
[[ -z $SERVER_DOMAIN ]] || SERVER_ARGS+=(--domain "$SERVER_DOMAIN")
[[ -z $SERVER_TIMEZONE ]] || SERVER_ARGS+=(--timezone "$SERVER_TIMEZONE")
SYSTV_DEPLOY_LOCK_HELD=1 bash "$SOURCE/deploy/debian/configure-server.sh" "${SERVER_ARGS[@]}"
# O runtime pertence à release: atualização e rollback incluem a versão do Node.
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
NODE_FILE=$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$WORK/SHASUMS256.txt")
[[ -n $NODE_FILE && $NODE_FILE != *$'\n'* ]] || fail 'Não foi possível determinar Node.js 24.'
NODE_VERSION=${NODE_FILE%-linux-*}
NODE_VERSION=${NODE_VERSION#node-}
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE" -o "$WORK/$NODE_FILE"
(cd "$WORK"; awk -v file="$NODE_FILE" '$2 == file' SHASUMS256.txt | sha256sum --check --strict)
install -d -m 0755 /opt/systv/releases
RELEASE=/opt/systv/releases/v$VERSION-$(date -u +%Y%m%dT%H%M%SZ)-$$
install -d -m 0755 "$RELEASE"
rsync -r --chmod=D755,F644 "$SOURCE/src" "$SOURCE/public" "$SOURCE/database" "$SOURCE/scripts" "$RELEASE/"
install -m 0644 "$SOURCE/package.json" "$SOURCE/package-lock.json" "$SOURCE/server.js" "$SOURCE/VERSION" "$RELEASE/"
# Ferramentas pertencem à versão; rollback também recupera as ferramentas anteriores.
install -d -m 0755 "$RELEASE/deploy/debian"
rsync -r --chmod=D755,F644 "$SOURCE/deploy/debian/" "$RELEASE/deploy/debian/"
install -m 0755 "$SOURCE/install.sh" "$RELEASE/install.sh"
install -d -m 0755 "$RELEASE/node"
tar -xJf "$WORK/$NODE_FILE" --strip-components=1 -C "$RELEASE/node"
# UID isolado; nenhum arquivo de código/ferramenta root é gravável pela aplicação.
if ! getent passwd systv-build >/dev/null; then
  getent group systv-build >/dev/null && fail 'Grupo de build conflitante.'
  useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin systv-build
fi
[[ $(id -u systv-build) != 0 && $(id -u systv-build) != "$(id -u systv)" && $(id -Gn systv-build) == systv-build && $(getent passwd systv-build | cut -d: -f6-7) == /nonexistent:/usr/sbin/nologin ]] || fail 'Conta de build insegura.'
chmod 0711 "$WORK"
install -d -m 0700 -o systv-build -g systv-build "$WORK/build"
install -m 0644 -o systv-build -g systv-build "$SOURCE/package.json" "$SOURCE/package-lock.json" "$WORK/build/"
systemd-run --quiet --wait --pipe --collect --unit="systv-build-$$" \
  -p User=systv-build -p Group=systv-build -p "WorkingDirectory=$WORK/build" \
  -p KillMode=control-group -p NoNewPrivileges=true -p ProtectSystem=strict \
  -p ProtectHome=true -p "ReadWritePaths=$WORK/build" \
  --setenv="PATH=$RELEASE/node/bin:/usr/bin:/bin" --setenv="npm_config_cache=$WORK/build/.npm" \
  /bin/sh -ec 'npm ci --omit=dev --ignore-scripts; node --input-type=module -e '\''import sharp from "sharp"; await sharp({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer()'\'''
cp -a "$WORK/build/node_modules" "$RELEASE/"
chown -R root:root "$RELEASE"
chmod -R go+rX "$RELEASE"
if [[ $MODE == update ]]; then
  STOPPED=true
  systemctl stop systv
  /usr/local/sbin/systvctl backup
fi
if [[ $MODE == update ]]; then
  python3 "$SOURCE/deploy/debian/harden-web.py"
  systemctl reload nginx
fi
for script in migrate setup-production; do
  (cd "$RELEASE"; runuser -u systv -- "$RELEASE/node/bin/node" --env-file=/etc/systv/systv.env "scripts/$script.js")
done
install -m 0644 "$SOURCE/deploy/debian/systv.service" /etc/systemd/system/systv.service
# Mantém runtime das releases legadas para permitir rollback após a conversão.
if [[ -d /opt/systv/node && ! -L /opt/systv/node ]]; then
  [[ ! -e /opt/systv/node-legacy ]] || fail 'Runtime legado conflitante.'
  mv /opt/systv/node /opt/systv/node-legacy
  ln -s /opt/systv/node-legacy /opt/systv/node
  for previous in /opt/systv/releases/*; do
    [[ ! -d $previous || -e $previous/node ]] || ln -s /opt/systv/node-legacy "$previous/node"
  done
fi
ln -s "$RELEASE" /opt/systv/.current-new-$$
mv -Tf /opt/systv/.current-new-$$ /opt/systv/current
SWITCHED=true
ln -sfn /opt/systv/current/node /opt/systv/node
install -d -m 0755 /usr/local/sbin
ln -sfn /opt/systv/current/deploy/debian/systvctl /usr/local/sbin/systvctl
chmod 0755 "$RELEASE/deploy/debian/systvctl"
install -m 0644 "$SOURCE/deploy/debian/systv-backup.service" /etc/systemd/system/
install -m 0644 "$SOURCE/deploy/debian/systv-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now systv-backup.timer
systemctl enable systv nginx
systemctl reset-failed systv
systemctl restart systv
if [[ $MODE == install ]]; then
  WEB_ARGS=(--origin "$ORIGIN" --tls "$TLS_MODE")
  [[ -z $EMAIL ]] || WEB_ARGS+=(--email "$EMAIL")
  [[ -z $TLS_CERT ]] || WEB_ARGS+=(--tls-cert "$TLS_CERT")
  [[ -z $TLS_KEY ]] || WEB_ARGS+=(--tls-key "$TLS_KEY")
  SYSTV_DEPLOY_LOCK_HELD=1 bash "$SOURCE/deploy/debian/configure-web.sh" "${WEB_ARGS[@]}"
fi
for _attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health > /dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet systv
curl --fail --silent --show-error http://127.0.0.1:3000/api/health > /dev/null

python3 "$SOURCE/deploy/debian/configure-server.py" --refresh
if [[ -n $OLD_RELEASE ]]; then
  printf '%s\n' "$OLD_RELEASE" > /etc/systv/previous-release
fi
if [[ $MODE == install ]]; then
  if [[ $(mariadb -N -e 'SELECT COUNT(*) FROM systv.users') == 0 ]]; then
    (cd "$RELEASE"; /opt/systv/node/bin/node --env-file=/etc/systv/systv.env scripts/activation-link.js > /dev/null)
  fi
  rm -f /etc/systv/install-pending.json
fi
printf '\nSYSTV %s pronto.\nDiagnóstico: systvctl doctor\nLog: %s\n' "$VERSION" "$LOG_FILE"
if [[ $MODE == install ]]; then
  if [[ -t 3 ]]; then
    printf '\nEncaminhe este link ao responsável pela loja (uso único, válido por 24 horas):\n' >&3
    [[ ! -f /etc/systv/activation-link.txt ]] || cat /etc/systv/activation-link.txt >&3
  else
    echo 'Link de ativação salvo em /etc/systv/activation-link.txt (somente root); emita outro com systvctl activation-link.'
  fi
fi
