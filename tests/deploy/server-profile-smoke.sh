#!/usr/bin/env bash
# Apenas no Debian descartável já instalado; não modifica uma VM de produção.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y openssh-server
systemctl start ssh
SSH_PID=$(systemctl show ssh -p MainPID --value)
SSH_HASH=$(sha256sum /etc/ssh/sshd_config)
SYSTV_HASH=$(sha256sum /etc/systv/systv.env)
systvctl server --hostname srv-systv --domain mk.intranet --timezone America/Sao_Paulo
[[ $(hostnamectl --static) == srv-systv ]]
grep -qx '127.0.1.1 srv-systv.mk.intranet srv-systv' /etc/hosts
[[ $(readlink /etc/localtime) == /usr/share/zoneinfo/America/Sao_Paulo ]]
[[ $(readlink /etc/systemd/system-generators/systemd-ssh-generator) == /dev/null ]]
[[ $(sha256sum /etc/ssh/sshd_config) == "$SSH_HASH" ]]
[[ $(sha256sum /etc/systv/systv.env) == "$SYSTV_HASH" ]]
systemctl is-active --quiet ssh systv nginx mariadb
/usr/sbin/sshd -t
script -q -e -c '/sbin/agetty --show-issue' /var/tmp/systv-console-preview.txt >/dev/null
grep -q 'Hostname => srv-systv.mk.intranet' /var/tmp/systv-console-preview.txt
grep -q 'MK Tecnologia' /var/tmp/systv-console-preview.txt
grep -q 'Debian' /var/tmp/systv-console-preview.txt
if grep -Fq '\4' /var/tmp/systv-console-preview.txt; then
  echo 'Escape de IP não foi expandido pelo agetty.' >&2; exit 1
fi
PROFILE_HASH=$(sha256sum /etc/issue /etc/motd /etc/systv/server-profile.json /etc/hosts)
BEFORE=$(find /var/backups/systv -name 'server-profile-*.tar.gz' | wc -l)
systvctl server
[[ $(sha256sum /etc/issue /etc/motd /etc/systv/server-profile.json /etc/hosts) == "$PROFILE_HASH" ]]
[[ $(find /var/backups/systv -name 'server-profile-*.tar.gz' | wc -l) == "$BEFORE" ]]
# O generator local permanece mascarado após recarregar o systemd.
for _attempt in {1..3}; do systemctl daemon-reload; done
[[ $(readlink /etc/systemd/system-generators/systemd-ssh-generator) == /dev/null ]]
systemctl is-active --quiet ssh systv
[[ $(systemctl show ssh -p MainPID --value) == "$SSH_PID" ]]
# A alteração da origem atualiza o banner, sem renomear novamente o servidor.
systvctl web --origin http://LOCALHOST --tls none
grep -q 'http://localhost' /etc/issue
[[ $(hostnamectl --static) == srv-systv ]]
cat /var/tmp/systv-console-preview.txt
echo 'Perfil local, banner, IP dinâmico, idempotência e SSH preservado: OK'
