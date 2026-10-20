#!/usr/bin/env bash
# Instalação inicial em Debian 13 dedicado. Execute a partir de um checkout confiável.
set -Eeuo pipefail
umask 027
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ORIGIN=''
EMAIL=''
usage() {
  cat <<'HELP'
Uso: sudo bash deploy/debian/install.sh --origin http://IP-OU-HOST
     sudo bash deploy/debian/install.sh --origin https://dominio --email admin@dominio
Instala Node.js 24, MariaDB, Nginx e serviço systemd em /opt/systv.
HTTPS requer domínio público apontando ao servidor e portas 80/443 acessíveis.
Somente instalação inicial; não substitui uma instalação existente.
HELP
}
fail() { echo "Erro: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --origin|--email)
      (($# >= 2)) || fail "Falta valor para $1"
      if [[ $1 == --origin ]]; then ORIGIN=$2; else EMAIL=$2; fi
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Opção desconhecida: $1" ;;
  esac
done
[[ $EUID == 0 ]] || fail 'Execute com sudo ou como root.'
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == debian && ${VERSION_ID%%.*} == 13 ]] || fail 'Este instalador exige Debian 13.'
[[ $ORIGIN =~ ^(http|https)://([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)$ ]] || fail 'Informe --origin http://IP-ou-host ou https://dominio, sem porta, caminho ou barra final.'
SCHEME=${BASH_REMATCH[1]}
SITE_HOST=${BASH_REMATCH[2]}
if [[ $SCHEME == https ]]; then
  [[ $EMAIL =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'HTTPS exige --email válido para o certificado.'
fi
[[ -d /run/systemd/system ]] || fail 'É necessário systemd em execução.'
[[ -f $SOURCE/package-lock.json && -f $SOURCE/server.js ]] || fail 'Checkout incompleto.'
for target in /opt/systv /etc/systv /etc/systemd/system/systv.service /etc/nginx/sites-available/systv /etc/nginx/sites-enabled/systv; do
  [[ ! -e $target && ! -L $target ]] || fail "$target já existe. Consulte docs/debian-13.md para manutenção."
done
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) fail 'Arquiteturas suportadas: amd64 e arm64.' ;;
esac
getent passwd systv >/dev/null && fail 'Usuário systv já existe.'
getent group systv >/dev/null && fail 'Grupo systv já existe.'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils openssl mariadb-server nginx rsync
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
trap 'echo "Instalação interrompida na linha $LINENO. Consulte docs/debian-13.md antes de tentar novamente." >&2' ERR
# Resolve a atualização atual da linha 24 e verifica o arquivo pelo checksum oficial via HTTPS.
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
NODE_FILE=$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$WORK/SHASUMS256.txt")
[[ -n $NODE_FILE && $NODE_FILE != *$'\n'* ]] || fail 'Não foi possível determinar a versão Node.js 24.'
NODE_VERSION=${NODE_FILE%-linux-*}
NODE_VERSION=${NODE_VERSION#node-}
curl --fail --silent --show-error --location "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE" -o "$WORK/$NODE_FILE"
(cd "$WORK"; awk -v file="$NODE_FILE" '$2 == file' SHASUMS256.txt | sha256sum --check --strict)
install -d -m 0755 /opt/systv /opt/systv/node /opt/systv/app
# Runtime isolado, sem substituir o Node.js de outros serviços.
tar -xJf "$WORK/$NODE_FILE" --strip-components=1 -C /opt/systv/node
useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin systv
rsync -r --chmod=D755,F644 "$SOURCE/src" "$SOURCE/public" "$SOURCE/database" "$SOURCE/scripts" /opt/systv/app/
install -m 0644 "$SOURCE/package.json" "$SOURCE/package-lock.json" "$SOURCE/server.js" /opt/systv/app/
# Dependências como usuário sem privilégios; código volta a ser somente leitura após instalar.
chown -R systv:systv /opt/systv/app
chmod 0755 "$WORK"
install -d -m 0700 -o systv -g systv "$WORK/npm-cache"
runuser -u systv -- env PATH=/opt/systv/node/bin:/usr/bin:/bin npm_config_cache="$WORK/npm-cache" \
  /bin/sh -c 'cd /opt/systv/app && npm ci --omit=dev --ignore-scripts'
chown -R root:root /opt/systv/app
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
systemctl enable --now mariadb
# Não altera bancos ou usuários que já existam.
[[ $(mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='systv'") == 0 ]] || fail 'Banco systv já existe; preservado.'
[[ $(mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM mysql.user WHERE User='systv'") == 0 ]] || fail 'Usuário MariaDB systv já existe; preservado.'
mariadb <<SQL
CREATE DATABASE systv CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'systv'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON systv.* TO 'systv'@'127.0.0.1';
SQL
# .env não é interpretado como shell. Node lê o arquivo de ambiente diretamente.
for script in migrate seed; do
  (cd /opt/systv/app; runuser -u systv -- /opt/systv/node/bin/node --env-file=/etc/systv/systv.env "scripts/$script.js")
done
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
systemctl daemon-reload
systemctl enable --now systv nginx
systemctl reload nginx
if [[ $SCHEME == https ]]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" -d "$SITE_HOST"
  systemctl enable --now certbot.timer
fi
for _attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health > /dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:3000/api/health > /dev/null
SITE_PORT=80
[[ $SCHEME != https ]] || SITE_PORT=443
curl --fail --silent --show-error --resolve "$SITE_HOST:$SITE_PORT:127.0.0.1" "$ORIGIN/api/health" > /dev/null
cat > /etc/systv/acesso-inicial.txt <<ACCESS
URL: $ORIGIN
Usuário: admin
Senha inicial: $ADMIN_PASSWORD
Troque a senha pela administração. Este arquivo não acompanha alterações posteriores.
ACCESS
chmod 0600 /etc/systv/acesso-inicial.txt
printf '\nSYSTV instalado: %s\nCredenciais: sudo cat /etc/systv/acesso-inicial.txt\nLogs: sudo journalctl -u systv -f\n' "$ORIGIN"
