#!/usr/bin/env bash
# Simula runtime global de instalação antiga; apenas no container descartável.
set -Eeuo pipefail
OLD=$(readlink -f /opt/systv/current)
[[ -L /opt/systv/node && -d $OLD/node && ! -L $OLD/node ]]
systemctl stop systv
rm /opt/systv/node
mv "$OLD/node" /opt/systv/node
systemctl start systv
bash /var/tmp/systv-source/deploy/debian/install.sh --update
[[ -L /opt/systv/node ]]
[[ $(readlink "$OLD/node") == /opt/systv/node-legacy ]]
systvctl rollback
[[ $(readlink -f /opt/systv/current) == "$OLD" ]]
systvctl doctor
echo 'Atualização de runtime legado e rollback: OK'
