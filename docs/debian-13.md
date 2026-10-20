# Instalação no Debian 13

Instalação inicial em servidor Debian 13 com systemd e acesso à internet, nas arquiteturas amd64 ou arm64. Execute com root/sudo. O instalador usa os pacotes MariaDB e Nginx do Debian e baixa a atualização atual do Node.js 24 do site oficial, conferindo SHA-256 via HTTPS. O runtime fica isolado em `/opt/systv/node`; a versão exata pode ser consultada com `/opt/systv/node/bin/node --version`.

Use um servidor dedicado, sem banco/usuário `systv` ou instalações anteriores em `/opt/systv` e `/etc/systv`. O instalador recusa substituir esses recursos. Outros sites Nginx são preservados; confira conflitos de domínio/porta antes de instalar. O instalador não altera o firewall. Libere a porta 80 para as TVs e, com HTTPS, também a 443. A porta 3000 da aplicação escuta somente em loopback.

## Instalar

Copie ou clone o projeto no servidor, entre na pasta e revise o script antes de executá-lo. O instalador não copia `.env`, bancos locais, backups ou dependências do computador de desenvolvimento.

Para rede local, substitua o IP pelo endereço fixo do servidor:

```sh
sudo bash deploy/debian/install.sh --origin http://192.168.1.10
```

HTTP transmite credenciais sem criptografia; use HTTPS em redes sem confiança. Para HTTPS automático, configure antes um domínio público apontando ao servidor, com portas 80 e 443 acessíveis pela internet:

```sh
sudo bash deploy/debian/install.sh \
  --origin https://tv.exemplo.com.br \
  --email admin@exemplo.com.br
```

O Certbot solicita um certificado Let's Encrypt, configura redirecionamento para HTTPS e habilita renovação automática. Esse comando aceita os termos do Let's Encrypt para o e-mail informado. IPs privados não podem usar esse fluxo de certificado público. A origem não deve conter porta, caminho ou barra final.

Ao terminar:

```sh
sudo cat /etc/systv/acesso-inicial.txt
sudo systemctl status systv
curl --fail http://192.168.1.10/api/health
```

Acesse a URL informada, entre como `admin` com a senha gerada e altere a senha no cadastro. A TV inicial está em `/tv?screen=tv01`. O banco começa com o catálogo de demonstração, que pode ser editado pela administração. O instalador não importa automaticamente o SQLite ou o MariaDB de desenvolvimento.

## Arquivos e operação

- `/opt/systv/app`: código e dependências, pertencentes a root.
- `/opt/systv/node`: runtime Node.js 24.
- `/etc/systv/systv.env`: configuração e segredos, leitura restrita a root e grupo systv.
- `/etc/systv/acesso-inicial.txt`: senha inicial, legível apenas por root; não reflete trocas posteriores.
- `/etc/systemd/system/systv.service`: aplicação executada pelo usuário sem privilégios `systv`.
- `/etc/nginx/sites-available/systv`: proxy, com buffering desativado para atualizações SSE.
- MariaDB: banco `systv`, usuário exclusivo com acesso apenas a esse banco. Não é necessário expor 3306 na rede.

```sh
sudo journalctl -u systv -f
sudo systemctl restart systv
sudo nginx -t
sudo certbot renew --dry-run  # apenas nas instalações HTTPS
```

Depois de editar `/etc/systv/systv.env`, reinicie `systv`. `PUBLIC_ORIGIN` deve coincidir com a URL usada pelos usuários. HTTPS exige `COOKIE_SECURE=true`. Alterar `ADMIN_PASSWORD` não redefine um administrador já criado. Preserve `MAIL_ENCRYPTION_KEY`: ela é necessária para recuperar as credenciais SMTP armazenadas no banco.

## Backup e restauração

O banco contém produtos, TVs, usuários, sessões e logos. Guarde também `/etc/systv` em armazenamento protegido, pois contém senhas e a chave de criptografia SMTP.

```sh
sudo install -d -m 0700 /var/backups/systv
sudo bash -o pipefail -c 'umask 077; mariadb-dump --single-transaction --routines --triggers systv | gzip > /var/backups/systv/systv.sql.gz'
sudo tar -czf /var/backups/systv/config.tar.gz -C /etc systv
```

Copie os backups para outro equipamento com acesso restrito. Para restaurar, pare a aplicação e use um backup conferido; a importação substitui dados conforme as instruções SQL do dump:

```sh
sudo systemctl stop systv
sudo bash -o pipefail -c 'gzip -dc /var/backups/systv/systv.sql.gz | mariadb systv'
# Restaure também o systv.env correspondente, principalmente MAIL_ENCRYPTION_KEY.
sudo systemctl start systv
```

## Atualizações e falhas

Este script é para instalação inicial e não oferece atualização ou rollback automático. Antes de atualizar, faça backup do banco e da configuração, pare o serviço, preserve a versão anterior de `/opt/systv/app`, copie o novo código e instale as dependências no servidor com o runtime de `/opt/systv/node`. Aplique as migrações antes de reiniciar:

```sh
sudo systemctl stop systv
cd /opt/systv/app
sudo -u systv /opt/systv/node/bin/node --env-file=/etc/systv/systv.env scripts/migrate.js
sudo systemctl start systv
```

Não execute `npm ci` como root em código não revisado. O instalador desativa scripts de dependências com `--ignore-scripts`; o sharp utiliza os binários distribuídos nos pacotes opcionais. Instale dependências com usuário temporariamente autorizado a escrever na pasta e devolva o código a root antes de iniciar o serviço. Atualize também Node.js 24 e os pacotes Debian regularmente.

Se a instalação for interrompida, os recursos já criados permanecem para diagnóstico; não rode novamente apagando arquivos ou bancos sem conferi-los. Veja `journalctl -u systv`, `nginx -t` e a linha informada pelo instalador. Em falha de emissão do certificado, corrija DNS/firewall e execute novamente apenas o comando Certbot; não reinstale o banco. O modo HTTPS mantém cookies seguros desde o início.

## Verificação

A CI verifica sintaxe JavaScript e Bash, ShellCheck e testes da aplicação com MariaDB. A instalação completa, inicialização após reboot, acesso por TVs físicas e emissão de certificado precisam ser homologados em uma VM Debian 13 antes de uso em produção.

Referências: [pacote MariaDB no Debian 13](https://packages.debian.org/trixie/mariadb-server), [distribuição oficial Node.js 24](https://nodejs.org/dist/latest-v24.x/).
