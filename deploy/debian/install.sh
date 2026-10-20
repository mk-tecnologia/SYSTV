#!/usr/bin/env bash
# Provisionamento e publicação de uma release de produção.
set -Eeuo pipefail
umask 027
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ORIGIN=''
EMAIL=''
MODE=install
TLS_MODE=''
TLS_CERT=''
TLS_KEY=''
usage() {
  cat <<'HELP'
SYSTV — Debian 13
Uso: install.sh [--origin http://IP-ou-host | --origin https://host --tls self-signed]
     install.sh --update
     install.sh --configure-web [--origin URL] [--tls self-signed|none|provided|letsencrypt]
HTTPS local é padrão; use --tls letsencrypt apenas em servidor público.
Sem parâmetros, solicita a URL de acesso. Instala releases em /opt/systv/releases.
HELP
}
fail() { echo "Erro: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --origin|--email|--tls|--tls-cert|--tls-key)
      (($# >= 2)) || fail "Falta valor para $1"
      case $1 in
        --origin) ORIGIN=$2 ;; --email) EMAIL=$2 ;; --tls) TLS_MODE=$2 ;;
        --tls-cert) TLS_CERT=$2 ;; --tls-key) TLS_KEY=$2 ;;
      esac
      shift 2 ;;
    --update) [[ $MODE == install ]] || fail "Escolha uma operação."; MODE=update; shift ;;
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
if [[ $MODE == install ]]; then
  for target in /opt/systv /etc/systv /etc/systemd/system/systv.service /etc/nginx/sites-available/systv /etc/nginx/sites-enabled/systv; do
    [[ ! -e $target && ! -L $target ]] || fail "$target já existe. Use systvctl update para uma instalação gerenciada por releases."
  done
  getent passwd systv >/dev/null && fail 'Usuário systv já existe.'
  getent group systv >/dev/null && fail 'Grupo systv já existe.'
  if [[ -z $ORIGIN ]]; then
    [[ -t 0 || -r /dev/tty ]] || fail 'Informe --origin para instalação sem terminal.'
    read -r -p 'URL de acesso (ex.: https://tv.exemplo.com ou http://192.168.1.10): ' ORIGIN < /dev/tty
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
cleanup() { rm -rf -- "$WORK"; }
on_error() {
  local status=$? line=$1
  trap - ERR
  echo "Falha na linha $line. Log: $LOG_FILE" >&2
  if [[ -n $OLD_RELEASE && ( $SWITCHED == true || $STOPPED == true ) ]]; then
    ln -s "$OLD_RELEASE" /opt/systv/.current-recovery-$$
    mv -Tf /opt/systv/.current-recovery-$$ /opt/systv/current
    systemctl reset-failed systv || true
    systemctl restart systv || true
    echo 'Código anterior reativado. Migrações não são desfeitas; confira o banco e o backup.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'on_error "$LINENO"' ERR
export DEBIAN_FRONTEND=noninteractive
if [[ $MODE == install ]]; then
  apt-get update
  apt-get install -y ca-certificates curl xz-utils openssl mariadb-server nginx rsync python3
  systemctl enable --now mariadb
  [[ $(mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='systv'") == 0 ]] || fail 'Banco systv já existe; preservado.'
  [[ $(mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM mysql.user WHERE User='systv'") == 0 ]] || fail 'Usuário MariaDB systv já existe; preservado.'
  curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
  NODE_FILE=$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$WORK/SHASUMS256.txt")
  [[ -n $NODE_FILE && $NODE_FILE != *$'\n'* ]] || fail 'Não foi possível determinar Node.js 24.'
  NODE_VERSION=${NODE_FILE%-linux-*}
  NODE_VERSION=${NODE_VERSION#node-}
  curl --fail --silent --show-error --location "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE" -o "$WORK/$NODE_FILE"
  (cd "$WORK"; awk -v file="$NODE_FILE" '$2 == file' SHASUMS256.txt | sha256sum --check --strict)
  install -d -m 0755 /opt/systv/node /opt/systv/releases
  tar -xJf "$WORK/$NODE_FILE" --strip-components=1 -C /opt/systv/node
  useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin systv
  install -d -m 0750 -o root -g systv /etc/systv
  DB_PASSWORD=$(openssl rand -hex 32)
  MAIL_KEY=$(openssl rand -hex 32)
  COOKIE_SECURE=false
  [[ $SCHEME != https ]] || COOKIE_SECURE=true
  cat > /etc/systv/systv.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=$ORIGIN
COOKIE_SECURE=$COOKIE_SECURE
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=systv
DB_USER=systv
DB_PASSWORD=$DB_PASSWORD
DB_POOL_SIZE=10
MAIL_ENCRYPTION_KEY=$MAIL_KEY
ENV
  chown root:systv /etc/systv/systv.env
  chmod 0640 /etc/systv/systv.env
  mariadb <<SQL
CREATE DATABASE systv CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'systv'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
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
RELEASE=/opt/systv/releases/v$VERSION-$(date -u +%Y%m%dT%H%M%SZ)-$$
install -d -m 0755 "$RELEASE"
rsync -r --chmod=D755,F644 "$SOURCE/src" "$SOURCE/public" "$SOURCE/database" "$SOURCE/scripts" "$RELEASE/"
install -m 0644 "$SOURCE/package.json" "$SOURCE/package-lock.json" "$SOURCE/server.js" "$SOURCE/VERSION" "$RELEASE/"
# Ferramentas pertencem à versão; rollback também recupera as ferramentas anteriores.
install -d -m 0755 "$RELEASE/deploy/debian"
rsync -r --chmod=D755,F644 "$SOURCE/deploy/debian/" "$RELEASE/deploy/debian/"
install -m 0755 "$SOURCE/install.sh" "$RELEASE/install.sh"
chown -R systv:systv "$RELEASE"
chmod 0755 "$WORK"
install -d -m 0700 -o systv -g systv "$WORK/npm-cache"
(cd "$RELEASE"; runuser -u systv -- env PATH=/opt/systv/node/bin:/usr/bin:/bin npm_config_cache="$WORK/npm-cache" npm ci --omit=dev --ignore-scripts)
# Falha antes de parar o serviço se binários nativos estiverem indisponíveis.
(cd "$RELEASE"; runuser -u systv -- /opt/systv/node/bin/node --input-type=module -e 'import sharp from "sharp"; await sharp({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer()')
chown -R root:root "$RELEASE"
chmod -R go+rX "$RELEASE"
if [[ $MODE == update ]]; then
  systemctl stop systv
  STOPPED=true
  /usr/local/sbin/systvctl backup
fi
for script in migrate setup-production; do
  (cd "$RELEASE"; runuser -u systv -- /opt/systv/node/bin/node --env-file=/etc/systv/systv.env "scripts/$script.js")
done
if [[ $MODE == install ]]; then
  install -m 0644 "$SOURCE/deploy/debian/systv.service" /etc/systemd/system/systv.service
fi
ln -s "$RELEASE" /opt/systv/.current-new-$$
mv -Tf /opt/systv/.current-new-$$ /opt/systv/current
SWITCHED=true
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

if [[ -n $OLD_RELEASE ]]; then
  printf '%s\n' "$OLD_RELEASE" > /etc/systv/previous-release
fi
if [[ $MODE == install ]]; then
  (cd "$RELEASE"; /opt/systv/node/bin/node --env-file=/etc/systv/systv.env scripts/activation-link.js > /dev/null)
fi
printf '\nSYSTV %s pronto.\nDiagnóstico: systvctl doctor\nLog: %s\n' "$VERSION" "$LOG_FILE"
if [[ $MODE == install ]]; then
  if [[ -t 3 ]]; then
    printf '\nEncaminhe este link ao responsável pela loja (uso único, válido por 24 horas):\n' >&3
    cat /etc/systv/activation-link.txt >&3
  else
    echo 'Link de ativação salvo em /etc/systv/activation-link.txt (somente root); emita outro com systvctl activation-link.'
  fi
fi
