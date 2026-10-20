#!/usr/bin/env bash
# Provisionamento e publicação de uma release de produção.
set -Eeuo pipefail
umask 027
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ORIGIN=''
EMAIL=''
MODE=install
usage() {
  cat <<'HELP'
SYSTV — Debian 13
Uso: install.sh [--origin http://IP-ou-host | --origin https://dominio --email contato@dominio]
     install.sh --update
Sem parâmetros, solicita a URL de acesso. Instala releases em /opt/systv/releases.
HELP
}
fail() { echo "Erro: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --origin|--email)
      (($# >= 2)) || fail "Falta valor para $1"
      if [[ $1 == --origin ]]; then ORIGIN=$2; else EMAIL=$2; fi
      shift 2 ;;
    --update) MODE=update; shift ;;
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
  [[ $ORIGIN =~ ^(http|https)://([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)$ ]] || fail 'URL inválida: use http://IP-ou-host ou https://dominio, sem porta/caminho/barra final.'
  SCHEME=${BASH_REMATCH[1]}
  SITE_HOST=${BASH_REMATCH[2]}
  if [[ $SCHEME == https ]]; then
    if [[ -z $EMAIL ]]; then read -r -p 'E-mail para certificado HTTPS: ' EMAIL < /dev/tty; fi
    [[ $EMAIL =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'HTTPS exige e-mail válido.'
  fi
else
  [[ -L /opt/systv/current && -f /etc/systv/systv.env ]] || fail 'Instalação por releases não encontrada.'
  [[ -z $ORIGIN && -z $EMAIL ]] || fail 'Atualização preserva a URL e configuração existentes.'
fi
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) fail 'Arquiteturas suportadas: amd64 e arm64.' ;;
esac
install -d -m 0750 /var/log/systv
LOG_FILE=/var/log/systv/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$$.log
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
  ADMIN_PASSWORD=$(openssl rand -hex 16)
  MAIL_KEY=$(openssl rand -hex 32)
  COOKIE_SECURE=false
  [[ $SCHEME != https ]] || COOKIE_SECURE=true
  cat > /etc/systv/systv.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=$ORIGIN
COOKIE_SECURE=$COOKIE_SECURE
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
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
  # Credenciais disponíveis mesmo se TLS falhar; nunca são escritas no log.
  cat > /etc/systv/acesso-inicial.txt <<ACCESS
URL: $ORIGIN
Usuário: admin
Senha inicial: $ADMIN_PASSWORD
Troque a senha na administração; este arquivo não acompanha trocas posteriores.
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
  cat > /etc/nginx/sites-available/systv <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SITE_HOST;
    client_max_body_size 8m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
NGINX
  ln -s /etc/nginx/sites-available/systv /etc/nginx/sites-enabled/systv
  nginx -t
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
systemctl restart systv
if [[ $MODE == install ]]; then
  systemctl start nginx
  systemctl reload nginx
  if [[ $SCHEME == https ]]; then
    apt-get install -y certbot python3-certbot-nginx
    certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" -d "$SITE_HOST"
    systemctl enable --now certbot.timer
  fi
fi
for _attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health > /dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet systv
curl --fail --silent --show-error http://127.0.0.1:3000/api/health > /dev/null
if [[ $MODE == install ]]; then
  SITE_PORT=80
  [[ $SCHEME != https ]] || SITE_PORT=443
  curl --fail --silent --show-error --resolve "$SITE_HOST:$SITE_PORT:127.0.0.1" "$ORIGIN/api/health" > /dev/null
fi
if [[ -n $OLD_RELEASE ]]; then
  printf '%s\n' "$OLD_RELEASE" > /etc/systv/previous-release
fi
printf '\nSYSTV %s pronto.\nCredenciais: cat /etc/systv/acesso-inicial.txt\nDiagnóstico: systvctl doctor\nLog: %s\n' "$VERSION" "$LOG_FILE"
