#!/usr/bin/env python3
"""Atualiza apenas o proxy gerenciado, preservando certificados e outros sites."""
import os
from pathlib import Path
import re
import subprocess
import tempfile

if os.geteuid() != 0:
    raise SystemExit('Execute como root.')
site = Path('/etc/nginx/sites-available/systv')
env = Path('/etc/systv/systv.env')
zone = Path('/etc/nginx/conf.d/systv-limits.conf')
paths = [site, env, zone]
snapshot = {path: (path.read_bytes(), path.stat()) if path.exists() else None for path in paths}

def replace(path, data, mode=0o644, uid=0, gid=0):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            os.fchown(output.fileno(), uid, gid)
            os.fchmod(output.fileno(), mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

try:
    text = site.read_text()
    pattern = r'location\s+/\s*\{[^{}]*proxy_pass\s+http://127\.0\.0\.1:3000;[^{}]*\}'
    proxy = '''location / {
        limit_req zone=systv_requests burst=100 nodelay;
        limit_req_status 429;
        limit_conn systv_connections 50;
        limit_conn_status 429;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }'''
    text, count = re.subn(pattern, lambda _: proxy, text)
    if count != 1:
        raise ValueError('Proxy não reconhecido. Configuração existente preservada.')
    replace(site, text.encode())
    replace(zone, b'limit_req_zone $binary_remote_addr zone=systv_requests:10m rate=20r/s;\nlimit_conn_zone $binary_remote_addr zone=systv_connections:10m;\n')
    lines = [line for line in env.read_text().splitlines() if not line.startswith('TRUST_PROXY=')]
    values = dict(line.split('=', 1) for line in lines if '=' in line)
    from urllib.parse import urlsplit
    origin = urlsplit(values.get('PUBLIC_ORIGIN', ''))
    if origin.scheme == 'http' and origin.hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise ValueError('Configure HTTPS com systvctl web antes de atualizar.')
    lines.append('TRUST_PROXY=loopback')
    meta = snapshot[env][1]
    replace(env, ('\n'.join(lines) + '\n').encode(), 0o640, meta.st_uid, meta.st_gid)
    subprocess.run(['nginx', '-t'], check=True)
except BaseException:
    for path, saved in snapshot.items():
        if saved is None:
            path.unlink(missing_ok=True)
        else:
            data, meta = saved
            replace(path, data, meta.st_mode & 0o777, meta.st_uid, meta.st_gid)
    raise
