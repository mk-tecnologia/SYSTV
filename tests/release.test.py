"""Valida o contrato do pacote entregue ao instalador, sem dependências externas."""
import hashlib
import pathlib
import subprocess
import tarfile
import unittest
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

class ProductionRelease(unittest.TestCase):
    def test_reproducible_and_no_local_data(self):
        def build():
            subprocess.run(['python3', 'scripts/build-release.py'], cwd=ROOT, check=True, capture_output=True)
            version = (ROOT / 'VERSION').read_text().strip()
            return (ROOT / 'dist' / f'systv-v{version}.tar.gz').read_bytes()
        first = build()
        self.assertEqual(first, build())
        archive_path = ROOT / 'dist' / f'systv-v{(ROOT / "VERSION").read_text().strip()}.tar.gz'
        with tarfile.open(archive_path) as archive:
            paths = set(archive.getnames())
            self.assertTrue({'LICENSE', 'README.md', 'VERSION', 'install.sh', 'server.js', 'scripts/setup-production.js',
                             'deploy/debian/systv.service', 'deploy/debian/systvctl',
                             'deploy/debian/configure-server.sh', 'deploy/debian/configure-server.py',
                             'deploy/debian/console-logo.txt', 'deploy/debian/prepare-debian.sh', 'public/activate.html',
                             'public/activate.js', 'public/tv-pagination.js', 'public/tv-presence.js', 'database/migrations/012_screen_display_links.sql', 'scripts/activation-link.js', 'database/migrations/009_initial_activation.sql'} <= paths)
            for name in paths:
                parts = pathlib.PurePosixPath(name).parts
                self.assertFalse({'.ddev', '.git', '.idea', 'data', 'backups', 'node_modules', 'tests'} & set(parts), name)
                self.assertFalse(any(part.startswith('.env') for part in parts), name)
            self.assertTrue(all(member.isfile() for member in archive.getmembers()))
            self.assertEqual(archive.extractfile('LICENSE').read(), (ROOT/'LICENSE').read_bytes())
        for line in (ROOT / 'dist/SHA256SUMS').read_text().splitlines():
            checksum, filename = line.split()
            self.assertEqual(checksum, hashlib.sha256((ROOT / 'dist' / filename).read_bytes()).hexdigest())

    def test_rejects_private_key_inside_runtime_tree(self):
        with tempfile.NamedTemporaryFile(dir=ROOT / 'src', suffix='.key'):
            result = subprocess.run(['python3', 'scripts/build-release.py'], cwd=ROOT, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'Arquivo privado', result.stderr)
        subprocess.run(['python3', 'scripts/build-release.py'], cwd=ROOT, check=True, capture_output=True)

if __name__ == '__main__':
    unittest.main()
