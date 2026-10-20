#!/usr/bin/env python3
"""Pacote de produção reproduzível, sem Git, DDEV, testes, dados ou segredos."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parent.parent
version = (ROOT / 'VERSION').read_text().strip()
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'VERSION inválido'
assert json.loads((ROOT / 'package.json').read_text())['version'] == version
assert json.loads((ROOT / 'package-lock.json').read_text())['version'] == version
out = ROOT / 'dist'
out.mkdir(exist_ok=True)
name = f'systv-v{version}.tar.gz'
paths = [ROOT / path for path in ['VERSION', 'package.json', 'package-lock.json', 'server.js', 'install.sh']]
for folder in ['src', 'public', 'database', 'scripts', 'deploy/debian']:
    paths.extend(p for p in (ROOT / folder).rglob('*') if p.is_file())
# Apenas scripts de runtime/deploy entram no pacote.
paths = [p for p in paths if p.name != 'build-release.py' and '__pycache__' not in p.parts]
with (out / name).open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for path in sorted(paths):
                assert not path.is_symlink(), f'Link não permitido: {path}'
                relative = path.relative_to(ROOT)
                assert not ({'.env', '.git', '.ddev', '.idea', 'data', 'backups', 'node_modules'} & set(relative.parts)), f'Caminho privado: {relative}'
                assert not any(part.startswith('.env') for part in relative.parts), f'Ambiente privado: {relative}'
                assert path.suffix.lower() not in {'.key', '.pem', '.crt', '.p12', '.pfx', '.sqlite'}, f'Arquivo privado: {relative}'
                content = path.read_bytes()
                info = tarfile.TarInfo(path.relative_to(ROOT).as_posix())
                info.size = len(content)
                info.mode = 0o755 if path.suffix == '.sh' or path.name == 'systvctl' else 0o644
                info.mtime = 0
                tar.addfile(info, io.BytesIO(content))
(out / 'install.sh').write_bytes((ROOT / 'install.sh').read_bytes())
checksums = ''.join(f'{hashlib.sha256((out / f).read_bytes()).hexdigest()}  {f}\n' for f in [name, 'install.sh'])
(out / 'SHA256SUMS').write_text(checksums)
print(out / name)
