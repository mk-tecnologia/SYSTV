"""Validação e recuperação do perfil local, sem modificar o computador de testes."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('server_profile', ROOT / 'deploy/debian/configure-server.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)

class ServerProfile(unittest.TestCase):
    def test_untrusted_identity_is_rejected(self):
        for hostname, domain, timezone in [('srv;id','mk.intranet','Etc/UTC'), ('-srv','mk.intranet','Etc/UTC'), ('srv','mk..intranet','Etc/UTC'), ('srv','mk.intranet','../../etc/passwd'), ('srv','mk.intranet','not/a-zone')]:
            with self.assertRaises(ValueError): profile.identity(hostname,domain,timezone)
        self.assertEqual(profile.identity('SRV-SYSTV','MK.INTRANET','America/Sao_Paulo'), ('srv-systv','mk.intranet','America/Sao_Paulo'))

    def test_banner_uses_real_kernel_and_dynamic_address_not_nis(self):
        issue, motd = profile.banners('srv-systv','mk.intranet','https://tv.mk.intranet','2.6.0','ens18')
        self.assertIn(r'\S',issue); self.assertIn(r'\r',issue); self.assertIn(r'\4{ens18}',issue)
        self.assertIn('srv-systv.mk.intranet',issue); self.assertNotIn(r'\o',issue)
        self.assertEqual(motd, '')
        self.assertIn('marcos@mktecnologia.net.br',issue)
        self.assertIn('██╔████╔██║',issue)

    def test_failure_restores_files_and_success_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'etc').mkdir()
            (root/'etc/hosts').write_text('127.0.0.1 localhost\n127.0.1.1 old\n10.0.0.8 keep.me\n')
            (root/'etc/issue').write_text('Original console\n')
            values=dict(hostname='srv-systv',domain='mk.intranet',timezone='Etc/UTC',origin='https://tv.mk.intranet',version='2.6.0',interface='eth0',previous_hostname='old',previous_domainname='(none)')
            old_hosts=(root/'etc/hosts').read_bytes()
            def failed(command, **kwargs):
                if command==['systemctl','daemon-reload'] and kwargs.get('check'): raise subprocess.CalledProcessError(1,command)
            with self.assertRaises(subprocess.CalledProcessError): profile.apply(root,values,failed)
            self.assertEqual((root/'etc/hosts').read_bytes(),old_hosts)
            self.assertEqual((root/'etc/issue').read_text(),'Original console\n')
            self.assertFalse((root/'etc/systemd/system-generators/systemd-ssh-generator').is_symlink())
            self.assertFalse((root/'etc/systv/server-profile.json').exists())
            calls=[]
            backup=profile.apply(root,values,lambda command,**kwargs:calls.append(command))
            self.assertTrue(backup.exists()); self.assertIn('10.0.0.8 keep.me',(root/'etc/hosts').read_text())
            self.assertEqual((root/'etc/systemd/system-generators/systemd-ssh-generator').readlink(),Path('/dev/null'))
            self.assertFalse(any('ssh.service' in command for command in calls))
            self.assertIn('kernel.domainname = mk.intranet',(root/'etc/sysctl.d/60-systv-console.conf').read_text())
            self.assertNotIn('kernel.printk',(root/'etc/sysctl.d/60-systv-console.conf').read_text())
            self.assertIsNone(profile.apply(root,dict(values,previous_hostname='srv-systv'),lambda command,**kwargs:self.fail('Reaplicação alterou serviços.')))

class DurableFiles(unittest.TestCase):
    def test_failed_flush_and_empty_source_preserve_previous_unit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/'new.service'; destination=root/'existing.service'
            destination.write_text('previous complete unit\n')
            source.write_text('[Unit]\nDescription=New unit\n')
            command='source "$1"; sync() { return 1; }; install_durable_file "$2" "$3"'
            args=['bash','-c',command,'test',str(ROOT/'deploy/debian/install-files.sh'),str(source),str(destination)]
            self.assertNotEqual(subprocess.run(args,capture_output=True).returncode,0)
            self.assertEqual(destination.read_text(),'previous complete unit\n')
            self.assertEqual(list(root.glob('*.pending.*')),[])
            source.write_text('')
            self.assertNotEqual(subprocess.run(args,capture_output=True).returncode,0)
            self.assertEqual(destination.read_text(),'previous complete unit\n')

class DebianPreparation(unittest.TestCase):
    def test_grub_preserves_arguments_and_does_not_duplicate_flag(self):
        script=(ROOT/'deploy/debian/prepare-debian.sh').read_text()
        block=script[script.index("backup_file /etc/default/grub"):script.index("\nelse\n    log 'Contêiner detectado")]
        with tempfile.TemporaryDirectory() as directory:
            grub=Path(directory)/'grub'
            command="set -Eeuo pipefail\nbackup_file() { :; }\ndie() { exit 1; }\nupdate-grub() { :; }\n"+block.replace('/etc/default/grub',str(grub)).replace('sed -i ', 'sed -i.bak ')
            for original in ['', 'quiet console=tty0', 'quiet systemd.ssh_auto=no']:
                grub.write_text('GRUB_CMDLINE_LINUX_DEFAULT="'+original+'"\n')
                subprocess.run(['bash','-c',command],check=True)
                first=grub.read_text()
                self.assertEqual(first.count('systemd.ssh_auto=no'),1)
                self.assertIn(original,first)
                subprocess.run(['bash','-c',command],check=True)
                self.assertEqual(grub.read_text(),first)
            grub.write_text('unsupported format\n')
            self.assertNotEqual(subprocess.run(['bash','-c',command],capture_output=True).returncode,0)
            self.assertEqual(grub.read_text(),'unsupported format\n')

if __name__=='__main__': unittest.main()
