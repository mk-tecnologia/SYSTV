#!/usr/bin/env bash
# Publica o arquivo completo por rename e confirma a gravação via syncfs.
install_durable_file() {
  local source=$1 destination=$2 mode=${3:-0644} temporary
  [[ -s $source ]] || { echo "Arquivo de origem vazio: $source" >&2; return 1; }
  temporary=$(mktemp "${destination}.pending.XXXXXX") || return
  if ! install -m "$mode" "$source" "$temporary" || ! cmp -s "$source" "$temporary" || ! sync -f "$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! mv -Tf -- "$temporary" "$destination"; then
    rm -f -- "$temporary"
    return 1
  fi
  sync -f "$(dirname -- "$destination")"
}
