#!/usr/bin/env bash
# Preparação Debian adaptada de mk-tecnologia/SCRIPTS-INI, setup-debian13.sh v1.4.8.
# Identidade, interface e /etc/issue são gerenciados por configure-server.py.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Execute como root.' >&2; exit 1; }
BACKUP_DIR="/var/backups/systv/debian-setup-$(date -u +%Y%m%dT%H%M%S)-$$"
PUBLIC_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKR5RW8eXT3nFrUjFBohZbMARFHB9VMASxomQIDR09SM marcos@mktecnologia.net.br'
log() { printf '\n==> %s\n' "$*"; }
die() { printf 'Erro: %s\n' "$*" >&2; exit 1; }
backup_file() {
    local file=$1
    if [[ -e "$file" || -L "$file" ]]; then
        mkdir -p "$BACKUP_DIR$(dirname "$file")"
        cp -a "$file" "$BACKUP_DIR$file"
    fi
}
mkdir -p "$BACKUP_DIR"
CONTAINER=false
if systemd-detect-virt --container --quiet; then
    CONTAINER=true
else
    command -v update-grub >/dev/null || die 'update-grub não encontrado'
    grep -Eq '^GRUB_CMDLINE_LINUX_DEFAULT="[^"]*"$' /etc/default/grub \
        || die 'formato de GRUB_CMDLINE_LINUX_DEFAULT não reconhecido'
fi
log 'Instalando vim, qemu-guest-agent e fastfetch'
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y vim qemu-guest-agent fastfetch openssh-server e2fsprogs

log 'Cadastrando a chave pública SSH para o usuário root'
mkdir -p /root/.ssh
chmod 0700 /root/.ssh
backup_file /root/.ssh/authorized_keys
touch /root/.ssh/authorized_keys
chmod 0600 /root/.ssh/authorized_keys
if ! grep -qxF "$PUBLIC_KEY" /root/.ssh/authorized_keys; then
    printf '%s\n' "$PUBLIC_KEY" >> /root/.ssh/authorized_keys
fi

log 'Desativando autenticação SSH por senha e habilitando chave pública'
backup_file /etc/ssh/sshd_config
if [[ -e /etc/ssh/sshd_config.d/99-mktecnologia.conf ]]; then
    backup_file /etc/ssh/sshd_config.d/99-mktecnologia.conf
    rm -f /etc/ssh/sshd_config.d/99-mktecnologia.conf
fi

SSHD_CONFIG_TEMP=$(mktemp /tmp/sshd_config.XXXXXX)
awk '
    function print_root_login_config() {
        print "# PermitRootLogin yes"
        print "PermitRootLogin prohibit-password"
    }
    BEGIN {
        global = 1
        configured = 0
        # O primeiro valor global prevalece, inclusive antes dos Includes.
        print "PasswordAuthentication no"
        print "KbdInteractiveAuthentication no"
        print "PubkeyAuthentication yes"
    }
    {
        normalized = tolower($0)
        sub(/^[[:space:]]+/, "", normalized)

        if (global && normalized ~ /^match[[:space:]]/) {
            if (!configured) {
                print_root_login_config()
                print ""
                configured = 1
            }
            global = 0
        }

        candidate = normalized
        sub(/^#[[:space:]]*/, "", candidate)
        if (global && candidate ~ /^(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|pubkeyauthentication)[[:space:]]+/) next
        if (global && candidate ~ /^permitrootlogin[[:space:]]+/) {
            if (!configured) {
                print_root_login_config()
                configured = 1
            }
            next
        }

        print
    }
    END {
        if (global && !configured) {
            print ""
            print "# Gerenciado por setup-debian13.sh"
            print_root_login_config()
        }
    }
' /etc/ssh/sshd_config > "$SSHD_CONFIG_TEMP"
cat "$SSHD_CONFIG_TEMP" > /etc/ssh/sshd_config
rm -f "$SSHD_CONFIG_TEMP"

restore_ssh_on_error() {
    cp -a "$BACKUP_DIR/etc/ssh/sshd_config" /etc/ssh/sshd_config
    if [[ -f $BACKUP_DIR/etc/ssh/sshd_config.d/99-mktecnologia.conf ]]; then
        cp -a "$BACKUP_DIR/etc/ssh/sshd_config.d/99-mktecnologia.conf" /etc/ssh/sshd_config.d/
    fi
}
trap restore_ssh_on_error EXIT
sshd -t
EFFECTIVE_SSH_AUTH=$(sshd -T)
EFFECTIVE_ROOT_LOGIN=$(awk '$1 == "permitrootlogin" {print $2}' <<< "$EFFECTIVE_SSH_AUTH")
[[ $EFFECTIVE_ROOT_LOGIN == without-password || $EFFECTIVE_ROOT_LOGIN == prohibit-password ]] \
    || die "configuração SSH efetiva inesperada: PermitRootLogin $EFFECTIVE_ROOT_LOGIN"
for EXPECTED_SSH_AUTH in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'pubkeyauthentication yes'; do
    grep -qxF "$EXPECTED_SSH_AUTH" <<< "$EFFECTIVE_SSH_AUTH" \
        || die "configuração SSH efetiva inesperada; esperado: $EXPECTED_SSH_AUTH"
done
systemctl restart ssh
trap - EXIT

log 'Configurando fastfetch no MOTD dinâmico'
backup_file /etc/update-motd.d/10-uname
cat > /etc/update-motd.d/10-uname <<'EOF'
#!/bin/sh
echo ""
fastfetch
EOF
chmod 0755 /etc/update-motd.d/10-uname

log 'Limpando /etc/motd'
backup_file /etc/motd
: > /etc/motd

log 'Configurando /root/.bashrc'
backup_file /root/.bashrc
cat > /root/.bashrc <<'EOF'
# ~/.bashrc: executed by bash(1) for non-login shells.
export LS_OPTIONS='--color=auto'
eval "$(dircolors)"
alias ls='ls $LS_OPTIONS'
alias ll='ls $LS_OPTIONS -l'
alias l='ls $LS_OPTIONS -lA'

# Aliases interativos para evitar alterações acidentais.
alias rm='rm -i'
alias cp='cp -i'
alias mv='mv -i'
EOF

log 'Desativando os sockets SSH automáticos AF_VSOCK no GRUB'
if [[ $CONTAINER == false ]]; then
command -v update-grub >/dev/null || die 'update-grub não encontrado'
backup_file /etc/default/grub
if grep -Eq '^GRUB_CMDLINE_LINUX_DEFAULT="[^"]*"$' /etc/default/grub; then
    GRUB_DEFAULT_ARGS=$(sed -n -E 's/^GRUB_CMDLINE_LINUX_DEFAULT="([^"]*)"$/\1/p' /etc/default/grub)
    if [[ " $GRUB_DEFAULT_ARGS " != *' systemd.ssh_auto=no '* ]]; then
        if [[ -n $GRUB_DEFAULT_ARGS ]]; then
            sed -i -E 's/^(GRUB_CMDLINE_LINUX_DEFAULT="[^"]*)"$/\1 systemd.ssh_auto=no"/' /etc/default/grub
        else
            sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=""$/GRUB_CMDLINE_LINUX_DEFAULT="systemd.ssh_auto=no"/' /etc/default/grub
        fi
    fi
else
    die 'formato de GRUB_CMDLINE_LINUX_DEFAULT não reconhecido em /etc/default/grub'
fi
update-grub
else
    log 'Contêiner detectado: GRUB não se aplica; generator local permanece desativado'
fi

log 'Ativando o qemu-guest-agent'
systemctl enable qemu-guest-agent
if [[ -e /dev/virtio-ports/org.qemu.guest_agent.0 ]]; then
    systemctl start qemu-guest-agent
else
    log 'Agente instalado; será iniciado quando o canal QEMU Guest Agent estiver disponível na VM'
fi

printf '\nPreparação Debian concluída. Backups: %s\n' "$BACKUP_DIR"
printf 'Reinicie o servidor para aplicar systemd.ssh_auto=no no boot.\n'
