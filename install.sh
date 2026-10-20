#!/usr/bin/env bash
# Bootstrap público/privado: baixa uma release publicada, verifica e instala.
set -Eeuo pipefail
umask 077
REPOSITORY=mk-tecnologia/systv
RELEASE_VERSION=latest
ARGS=()
usage() {
  cat <<'HELP'
SYSTV — instalação de produção no Debian 13
Uso: bash install.sh [--version v2.1.0] [--origin https://tv.exemplo.com] [--email admin@exemplo.com]
     bash install.sh --update [--version v2.1.0]
Sem --origin, o assistente solicita os dados no terminal.
Repositório privado: exporte GITHUB_TOKEN com permissão de leitura de conteúdo.
HELP
}
while (($#)); do
  case $1 in
    --version) [[ $# -ge 2 ]] || { echo 'Falta a versão.' >&2; exit 1; }; RELEASE_VERSION=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[[ $EUID == 0 ]] || { echo 'Execute como root: sudo bash install.sh' >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == debian && ${VERSION_ID%%.*} == 13 ]] || { echo 'É necessário Debian 13.' >&2; exit 1; }
[[ $RELEASE_VERSION == latest || $RELEASE_VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use latest ou uma tag vX.Y.Z.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl python3
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
CURL_CONFIG=$WORK/curl.conf
printf 'fail\nsilent\nshow-error\nlocation\nretry = 3\nconnect-timeout = 20\nproto = "=https"\nproto-redir = "=https"\n' > "$CURL_CONFIG"
if [[ -n ${GITHUB_TOKEN:-} ]]; then
  [[ $GITHUB_TOKEN =~ ^[a-zA-Z0-9_.+/=-]+$ ]] || { echo 'Formato de GITHUB_TOKEN inválido.' >&2; exit 1; }
  printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" >> "$CURL_CONFIG"
fi
API=https://api.github.com/repos/$REPOSITORY
ENDPOINT=$API/releases/latest
[[ $RELEASE_VERSION == latest ]] || ENDPOINT=$API/releases/tags/$RELEASE_VERSION
if ! curl --config "$CURL_CONFIG" "$ENDPOINT" -o "$WORK/release.json"; then
  echo 'Não foi possível consultar a release. Em repositório privado, informe GITHUB_TOKEN com Contents: read.' >&2
  exit 1
fi
# IDs dos assets vêm da API; nenhum link arbitrário do JSON recebe o token.
python3 - "$WORK/release.json" "$WORK" "$RELEASE_VERSION" <<'PY'
import json, pathlib, re, sys
release = json.loads(pathlib.Path(sys.argv[1]).read_text())
tag = release['tag_name']
if not re.fullmatch(r'v\d+\.\d+\.\d+', tag) or release['draft'] or release['prerelease']:
    raise SystemExit('Release estável inválida.')
if sys.argv[3] != 'latest' and tag != sys.argv[3]:
    raise SystemExit('Tag inesperada.')
root = pathlib.Path(sys.argv[2])
(root / 'tag').write_text(tag)
for filename, output in [('systv-' + tag + '.tar.gz', 'archive-id'), ('SHA256SUMS', 'checksums-id')]:
    assets = [a for a in release['assets'] if a['name'] == filename]
    if len(assets) != 1 or not isinstance(assets[0]['id'], int):
        raise SystemExit('Asset ausente ou duplicado: ' + filename)
    (root / output).write_text(str(assets[0]['id']))
PY
TAG=$(cat "$WORK/tag")
ARCHIVE=systv-$TAG.tar.gz
for asset in archive checksums; do
  ASSET_ID=$(cat "$WORK/$asset-id")
  OUTPUT=$ARCHIVE
  [[ $asset != checksums ]] || OUTPUT=SHA256SUMS
  curl --config "$CURL_CONFIG" -H 'Accept: application/octet-stream' "$API/releases/assets/$ASSET_ID" -o "$WORK/$OUTPUT"
done
(cd "$WORK"; awk -v file="$ARCHIVE" '$2 == file {print}' SHA256SUMS > archive.sha256; [[ $(wc -l < archive.sha256) == 1 ]]; sha256sum --check --strict archive.sha256)
# Só extrai arquivos e diretórios regulares dentro do diretório de destino.
python3 - "$WORK/$ARCHIVE" "$WORK/source" <<'PY'
import pathlib, sys, tarfile
root = pathlib.Path(sys.argv[2])
root.mkdir()
with tarfile.open(sys.argv[1]) as archive:
    members = archive.getmembers()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Caminho ou tipo inválido no pacote.')
    archive.extractall(root, members=members, filter='data')
PY
[[ $(cat "$WORK/source/VERSION") == "${TAG#v}" ]] || { echo 'Versão do pacote divergente.' >&2; exit 1; }
# Token só é usado para baixar; não é persistido nem enviado ao instalador.
unset GITHUB_TOKEN
bash "$WORK/source/deploy/debian/install.sh" "${ARGS[@]}"
