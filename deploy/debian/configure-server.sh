#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
[[ -f /etc/systv/systv.env ]] || { echo 'Instalação SYSTV não encontrada.' >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ ${SYSTV_DEPLOY_LOCK_HELD:-} != 1 ]]; then
  exec 9>/run/lock/systv-deploy.lock
  flock -n 9 || { echo 'Outra manutenção está em andamento.' >&2; exit 1; }
fi
if [[ ! -f /usr/share/zoneinfo/Etc/UTC ]] || ! command -v ip >/dev/null || ! command -v sysctl >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y tzdata iproute2 procps
fi
exec python3 "$SCRIPT_DIR/configure-server.py" "$@"
