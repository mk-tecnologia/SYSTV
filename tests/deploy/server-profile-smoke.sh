#!/usr/bin/env bash
# Apenas no Debian descartável já instalado; não modifica uma VM de produção.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y openssh-server
systemctl start ssh
SYSTV_HASH=$(sha256sum /etc/systv/systv.env)
systvctl server --hostname srv-systv --domain mk.intranet --timezone America/Sao_Paulo
[[ $(hostnamectl --static) == srv-systv ]]
grep -qx '127.0.1.1 srv-systv.mk.intranet srv-systv' /etc/hosts
[[ $(readlink /etc/localtime) == /usr/share/zoneinfo/America/Sao_Paulo ]]
[[ $(readlink /etc/systemd/system-generators/systemd-ssh-generator) == /dev/null ]]
SSH_EFFECTIVE=$(sshd -T)
grep -qx 'passwordauthentication no' <<< "$SSH_EFFECTIVE"
grep -qx 'kbdinteractiveauthentication no' <<< "$SSH_EFFECTIVE"
grep -qx 'pubkeyauthentication yes' <<< "$SSH_EFFECTIVE"
grep -qx 'permitrootlogin without-password' <<< "$SSH_EFFECTIVE"
grep -q 'marcos@mktecnologia.net.br' /root/.ssh/authorized_keys
[[ $(grep -c 'AAAAC3NzaC1lZDI1NTE5AAAAIKR5RW8eXT3nFrUjFBohZbMARFHB9VMASxomQIDR09SM' /root/.ssh/authorized_keys) == 1 ]]
grep -q fastfetch /etc/update-motd.d/10-uname
[[ ! -s /etc/motd ]]
grep -q "alias rm='rm -i'" /root/.bashrc
for package in vim fastfetch qemu-guest-agent; do dpkg-query -W -f='${Status}\n' "$package" | grep -qx 'install ok installed'; done
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
# Alterar a origem preserva o banner original e a identidade.
systvctl web --origin http://LOCALHOST --tls none
grep -q 'marcos@mktecnologia.net.br' /etc/issue
[[ $(hostnamectl --static) == srv-systv ]]
cat /var/tmp/systv-console-preview.txt
echo 'Preparação Debian SCRIPTS-INI, banner, IP dinâmico e SSH por chave: OK'
