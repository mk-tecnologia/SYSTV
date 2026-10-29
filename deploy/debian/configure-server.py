#!/usr/bin/env python3
"""Identidade e console Debian conforme a referência SCRIPTS-INI."""
import argparse
import datetime
import errno
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tarfile
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

HERE = Path(__file__).resolve().parent
LABEL = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z')

def identity(hostname, domain, timezone):
    hostname, domain = hostname.lower(), domain.lower()
    if not LABEL.fullmatch(hostname) or hostname.isdigit():
        raise ValueError('Hostname inválido: use um nome curto, como srv-systv.')
    if domain and (len(domain) > 190 or any(not LABEL.fullmatch(label) for label in domain.split('.'))):
        raise ValueError('Domínio inválido: use, por exemplo, mk.intranet.')
    if not re.fullmatch(r'[A-Za-z0-9_+/-]+', timezone) or '..' in timezone.split('/') or timezone.startswith('/'):
        raise ValueError('Fuso horário inválido.')
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError('Fuso horário desconhecido.') from error
    return hostname, domain, timezone

def origin_host(origin):
    parsed = urlsplit(origin)
    if parsed.scheme not in {'http','https'} or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {'','/'} or parsed.query or parsed.fragment or any(ord(c) < 32 for c in origin):
        raise ValueError('Origem do painel inválida.')
    return parsed.hostname

def local_hosts(text, hostname, domain):
    fqdn = hostname + ('.' + domain if domain else '')
    # Somente o registro local do host: preserva DNS, gateway e as demais entradas.
    lines = [line for line in text.splitlines() if not re.match(r'^\s*127\.0\.1\.1(?:\s|$)', line)]
    lines.append('127.0.1.1 ' + fqdn + (' ' + hostname if domain else ''))
    return '\n'.join(lines) + '\n'

def banners(hostname, domain, origin, version, interface):
    logo = (HERE / 'console-logo.txt').read_text()
    fqdn = hostname + ('.' + domain if domain else '')
    ipv4 = r'\4' + ('{' + interface + '}' if interface else '')
    issue = ('\n' + logo + '   marcos@mktecnologia.net.br\n   www.mktecnologia.net.br\n   Use linux :)\n\n'
             + r'   ## Based in => \S' + '\n' + r'   ## Kernel => \r on an \m' + '\n'
             + '   ## Hostname => ' + fqdn + '\n'
             + '   ## IPV4 ' + interface + ' => ' + ipv4 + '\n\n'
             + '   #################\n   # MK Tecnologia #\n   #################\n\n')
    return issue, ''

def apply(root, values, run=subprocess.run):
    """Escritas recuperáveis; root injetável somente na API dos testes, não na CLI."""
    hostname, domain, timezone = identity(values['hostname'], values['domain'], values['timezone'])
    origin_host(values['origin'])
    if not re.fullmatch(r'\d+\.\d+\.\d+', values['version']):
        raise ValueError('Versão inválida.')
    interface = values.get('interface', '')
    if interface and not re.fullmatch(r'[A-Za-z0-9_.:-]{1,15}', interface):
        raise ValueError('Interface inválida.')
    issue, motd = banners(hostname, domain, values['origin'], values['version'], interface)
    profile = dict(hostname=hostname, domain=domain, timezone=timezone, interface=interface)
    files = {
        'etc/issue': issue,
        'etc/motd': motd,
        'etc/hostname': hostname + '\n',
        'etc/hosts': local_hosts((root / 'etc/hosts').read_text(), hostname, domain),
        'etc/timezone': timezone + '\n',
        'etc/sysctl.d/60-systv-console.conf': '# Domínio local conforme SCRIPTS-INI.\nkernel.domainname = ' + domain + '\n',
        'etc/systemd/system/getty@.service.d/60-systv-console.conf': "[Service]\nExecStart=\nExecStart=-/sbin/agetty -o '-p -- \\\\u' %I $TERM\n",
        'etc/systv/server-profile.json': json.dumps(profile, ensure_ascii=False, indent=2) + '\n',
    }
    links = {
        'etc/localtime': '/usr/share/zoneinfo/' + timezone,
        'etc/systemd/system-generators/systemd-ssh-generator': '/dev/null',
    }
    paths = {name: root / name for name in files.keys() | links.keys()}
    before = {}
    for name, path in paths.items():
        if path.is_symlink(): before[name] = ('link', os.readlink(path), path.lstat().st_mode & 0o777)
        elif path.exists(): before[name] = ('file', path.read_bytes(), path.stat().st_mode & 0o777)
        else: before[name] = None
    changed = [name for name, text in files.items() if before[name] is None or before[name][:2] != ('file', text.encode())]
    changed += [name for name, target in links.items() if before[name] is None or before[name][:2] != ('link', target)]
    if not changed and values['previous_hostname'] == hostname:
        return None
    backup_dir = root / 'var/backups/systv'
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_dir / ('server-profile-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.tar.gz')
    with tarfile.open(backup, 'w:gz', dereference=False) as archive:
        for name in paths:
            if before[name] is not None: archive.add(paths[name], arcname=name, recursive=False)
    backup.chmod(0o600)
    def write(name, state):
        path = paths[name]
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        if state is None:
            path.unlink(missing_ok=True)
            return
        kind, content, mode = state
        temporary = path.with_name(path.name + '.systv-' + str(os.getpid()))
        try:
            if kind == 'link': temporary.symlink_to(content)
            else:
                temporary.write_bytes(content)
                temporary.chmod(mode)
            try:
                os.replace(temporary, path)
            except OSError as error:
                # /etc/hosts e /etc/hostname são bind mounts em contêineres.
                if error.errno != errno.EBUSY or kind != 'file' or path.is_symlink(): raise
                path.write_bytes(content)
                path.chmod(mode)
        finally:
            temporary.unlink(missing_ok=True)
    old_hostname = values['previous_hostname']
    # A referência protege /etc/issue; remove o atributo só durante a escrita.
    issue_path = str(root / 'etc/issue')
    if not values.get('container'): run(['chattr', '-i', issue_path], check=True)
    try:
        for name in changed:
            write(name, ('file', files[name].encode(), 0o644) if name in files else ('link', links[name], 0o777))
        if old_hostname != hostname:
            run(['hostnamectl', 'set-hostname', hostname], check=True)
        if not values.get('container'):
            run(['sysctl', '-p', '/etc/sysctl.d/60-systv-console.conf'], check=True)
        run(['systemctl', 'daemon-reload'], check=True)
        # Solicita redesenho apenas aos agettys que aguardam login, sem encerrar sessões.
        run(['agetty', '--reload'], check=True)
    except BaseException:
        for name in changed: write(name, before[name])
        if old_hostname != hostname: run(['hostnamectl', '--transient', 'set-hostname', old_hostname], check=False)
        # Restaura o domínio em memória, sem mudar arquivos de terceiros.
        if values.get('previous_domainname') and not values.get('container'):
            run(['sysctl', '-w', 'kernel.domainname=' + values['previous_domainname']], check=False)
        run(['systemctl', 'daemon-reload'], check=False)
        raise
    finally:
        if not values.get('container'): run(['chattr', '+i', issue_path], check=True)
    return backup

def main():
    parser = argparse.ArgumentParser(description='Perfil local do servidor SYSTV')
    for name in ['origin', 'hostname', 'domain', 'timezone', 'interface']: parser.add_argument('--' + name)
    parser.add_argument('--validate', action='store_true')
    parser.add_argument('--initial', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    if args.validate:
        identity(args.hostname or 'srv-systv', args.domain or '', args.timezone or 'America/Sao_Paulo')
        return
    if os.geteuid() != 0: parser.error('Execute como root.')
    root = Path('/')
    os_release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if os_release.get('ID', '').strip('"') != 'debian' or os_release.get('VERSION_ID', '').strip('"').split('.')[0] != '13': parser.error('É necessário Debian 13.')
    state = root / 'etc/systv/server-profile.json'
    if args.refresh and not state.exists(): return
    previous = json.loads(state.read_text()) if state.exists() else {}
    env = dict(line.split('=', 1) for line in Path('/etc/systv/systv.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    origin = args.origin or env.get('PUBLIC_ORIGIN', '')
    host = origin_host(origin)
    try: ipaddress.ip_address(host); named = False
    except ValueError: named = '.' in host
    current_hostname = socket.gethostname()
    hostname = args.hostname or previous.get('hostname') or (host.split('.')[0] if args.initial and named else current_hostname.split('.')[0])
    domain = args.domain if args.domain is not None else previous.get('domain', host.split('.', 1)[1] if named else 'mk.intranet')
    timezone_file = root / 'etc/timezone'
    current_timezone = timezone_file.read_text().strip() if timezone_file.exists() else 'Etc/UTC'
    timezone = args.timezone or previous.get('timezone') or ('America/Sao_Paulo' if args.initial else current_timezone)
    route = subprocess.run(['ip', '-4', 'route', 'show', 'default'], check=True, capture_output=True, text=True).stdout
    match = re.search(r'\bdev\s+([^\s]+)', route)
    interfaces = [line.split(':', 2)[1].strip().split('@')[0] for line in subprocess.run(
        ['ip', '-o', 'link', 'show'], check=True, capture_output=True, text=True).stdout.splitlines()]
    interfaces = [name for name in interfaces if name != 'lo']
    interface = args.interface or previous.get('interface', '')
    if not interface:
        if len(interfaces) > 1 and not args.refresh and sys.stdin.isatty():
            for index, name in enumerate(interfaces, 1): print(f'{index}) {name}')
            while True:
                choice = input('Selecione a interface usada no /etc/issue: ')
                if choice.isdigit() and 1 <= int(choice) <= len(interfaces):
                    interface = interfaces[int(choice)-1]
                    break
        else:
            interface = match[1] if match else (interfaces[0] if interfaces else '')
    if interface not in interfaces: raise ValueError('Interface de rede inexistente.')
    active_version = root / 'opt/systv/current/VERSION'
    version_file = active_version if active_version.is_file() else (HERE / '../../VERSION').resolve()
    values = dict(hostname=hostname, domain=domain, timezone=timezone, origin=origin,
                  version=version_file.read_text().strip(), interface=interface,
                  previous_hostname=current_hostname, previous_domainname=Path('/proc/sys/kernel/domainname').read_text().strip(),
                  container=subprocess.run(['systemd-detect-virt', '--container', '--quiet'], check=False).returncode == 0)
    backup = apply(root, values)
    print('Perfil local configurado: ' + hostname + ('.' + domain if domain else '') + ' | ' + timezone)
    if backup: print('Configuração anterior: ' + str(backup))

if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Falha no perfil local: ' + str(error), file=sys.stderr)
        sys.exit(1)
