#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
[[ -f /etc/systv/systv.env ]] || { echo 'Instalação SYSTV não encontrada.' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for argument in "$@"; do
  case "$argument" in
    --help|-h|--validate|--refresh) exec python3 "$SCRIPT_DIR/configure-server.py" "$@" ;;
  esac
done
if [[ ${SYSTV_DEPLOY_LOCK_HELD:-} != 1 ]]; then
  exec 9>/run/lock/systv-deploy.lock
  flock -n 9 || { echo 'Outra manutenção está em andamento.' >&2; exit 1; }
fi
if [[ ! -f /usr/share/zoneinfo/Etc/UTC ]] || ! command -v ip >/dev/null || ! command -v sysctl >/dev/null || ! command -v chattr >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y tzdata iproute2 procps e2fsprogs
fi
python3 "$SCRIPT_DIR/configure-server.py" "$@"
# Atualizações e ajustes da URL apenas atualizam a identidade/console.
# A preparação completa ocorre na instalação ou em systvctl server.
if [[ ${SYSTV_SERVER_REFRESH_ONLY:-0} != 1 ]]; then
  bash "$SCRIPT_DIR/prepare-debian.sh"
fi
