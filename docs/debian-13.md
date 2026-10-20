# SYSTV em produção — Debian 13

Consulte o [README](../README.md) para baixar e executar o instalador por link
ou pelo GitHub CLI quando o repositório for privado. Execute como root.

## Requisitos e assistente

- Debian 13 amd64 ou arm64, com systemd e acesso à internet.
- Servidor dedicado, sem banco/usuário `systv` ou instalação anterior.
- Porta 80 acessível pelas TVs; para HTTPS, também 443 e domínio público
  com DNS apontando ao servidor.
- Acesso de leitura ao GitHub se o repositório continuar privado.

O assistente solicita uma URL, como `http://192.168.1.10` para rede local ou
`https://tv.exemplo.com.br`. Para HTTPS, solicita o e-mail do Certbot e aceita
os termos do Let's Encrypt. Não use caminho, porta ou barra final na URL.
O modo não interativo aceita `--origin` e `--email`.

HTTP transmite credenciais sem criptografia. Use HTTPS em redes sem confiança.
IPs privados não podem usar o fluxo público do Let's Encrypt. O instalador
não altera o firewall: preserve a porta de administração SSH e libere apenas
80/443 para o serviço web. Não exponha 3000 ou MariaDB para as TVs.

O bootstrap baixa apenas uma **release estável**, nunca a branch `main`.
`--version vX.Y.Z` fixa a versão. O checksum SHA-256 é obtido da mesma release
via HTTPS: verifica integridade, mas não é uma assinatura independente.
Para maior controle, revise o instalador e o conteúdo da release antes de executar.
Em repositórios privados, use token de leitura de conteúdo restrito ao SYSTV;
o token não é gravado pelo bootstrap nem pelo serviço.

## Estrutura instalada

```text
/opt/systv/
├── node/                      Node.js 24 isolado
├── current -> releases/...    versão ativa
└── releases/                  código e dependências por versão
/etc/systv/
├── systv.env                  configuração de produção e segredos
├── acesso-inicial.txt         credenciais geradas, somente root
└── previous-release           referência para rollback
/var/backups/systv/            backups locais protegidos
/var/log/systv/                logs de instalação e atualização
/usr/local/sbin/systvctl       operação e diagnóstico
```

O serviço roda como `systv`, sem shell, com código pertencente a root e somente
leitura para o processo. `NODE_ENV=production`; aplicação escuta apenas em
`127.0.0.1:3000`, atrás do Nginx. SSE tem buffering desativado. O banco utiliza
usuário exclusivo e senha aleatória. O administrador inicial também tem senha
aleatória. A chave AES das credenciais SMTP é gerada individualmente.
O catálogo inicial contém uma TV e nenhum produto de demonstração.

```bash
cat /etc/systv/acesso-inicial.txt
systvctl version
systvctl doctor
journalctl -u systv -f
systemctl status systv nginx mariadb systv-backup.timer
```

Ajuste empresa, produtos e senha pelo painel. Configure SMTP para recuperação
de senha e 2FA. Alterar `ADMIN_PASSWORD` no ambiente não redefine uma conta já
criada. Preserve `MAIL_ENCRYPTION_KEY` para recuperar as credenciais SMTP.
Após editar `systv.env`, reinicie `systv`.

## Atualização

```bash
systvctl update
systvctl update --version v2.1.1
# Para repositório privado, por exemplo:
GITHUB_TOKEN="$(gh auth token)" systvctl update
```

A atualização baixa e verifica o pacote, instala dependências em outra pasta,
verifica sharp, para a aplicação, faz backup e aplica migrações. A troca do link
`current` é atômica. A aplicação fica indisponível durante backup/migrações e
reinicialização; as TVs mantêm os últimos dados recebidos.

Se houver falha após parar ou ativar a nova versão, o instalador tenta reativar
o código anterior. Não restaura nem desfaz migrações automaticamente.
Migrações futuras devem preservar compatibilidade com a versão anterior.

Instalações da primeira versão do instalador, com `/opt/systv/app` e sem
`current`, são recusadas. Faça backup e planeje a migração para releases em um
novo servidor; os dados não serão sobrescritos por este instalador.

## Rollback

```bash
systvctl rollback
ls -1 /opt/systv/releases
systvctl rollback v2.1.1-20261020T120000Z-1234
```

O rollback cria backup e troca somente o código. Se a versão anterior não
aceitar o schema atual, será necessário restaurar um backup compatível durante
uma manutenção. Releases antigas são preservadas; remova manualmente apenas
as que não forem `current` ou `previous-release` e após conferir backups.

## Backup e restauração

```bash
systvctl backup
systemctl list-timers systv-backup.timer
```

O backup diário ocorre às 03:15, com atraso aleatório de até dez minutos e
retenção de 14 dias. Cada diretório em `/var/backups/systv` contém:

- `database.sql.gz`: banco com usuários, produtos, TVs, sessões e logos;
- `config.tar.gz`: `/etc/systv`, incluindo chave SMTP e credenciais;
- `VERSION` e `SHA256SUMS` para conferência.

Os diretórios são acessíveis somente a root. O agendamento remove backups
expirados apenas após um novo backup bem-sucedido. Não há cópia externa automática:
transfira os backups regularmente para outro equipamento protegido.

Para restaurar um backup conferido, durante manutenção:

```bash
cd /var/backups/systv/NOME-DO-BACKUP
sha256sum --check SHA256SUMS
systemctl stop systv
# A importação substitui os dados conforme o SQL do dump.
bash -o pipefail -c 'gzip -dc database.sql.gz | mariadb systv'
tar -xzf config.tar.gz -C /etc
systemctl start systv
systvctl doctor
```

Use configuração e código compatíveis com o backup. Uma restauração de banco
em outro servidor requer ajustar também o usuário/senha MariaDB desse servidor.
O dump do banco `systv` não recria as contas do servidor MariaDB.

## Falhas e segurança operacional

A instalação inicial recusa recursos existentes para preservar dados. Uma
falha parcial deixa arquivos para diagnóstico e não pode ser resolvida apagando
bancos ou configuração indiscriminadamente. Confira o log indicado e
`journalctl -u systv -u mariadb -u nginx`.

Em falha de certificado, ajuste DNS/firewall e execute apenas:

```bash
certbot --nginx --non-interactive --agree-tos --redirect \
  --email admin@exemplo.com.br -d tv.exemplo.com.br
certbot renew --dry-run
```

Se o certificado falhar, o modo HTTPS mantém cookies seguros; não use login
por HTTP como substituição. Depois de corrigir TLS, execute `systvctl doctor`
e confira a URL HTTPS no navegador.

Mantenha os pacotes Debian e o runtime Node.js 24 atualizados. O runtime é
isolado e não é substituído pela atualização do código: atualizações de Node
requerem manutenção separada, teste e reinício do serviço.

A CI testa o provisionamento com systemd dentro de Debian 13 descartável,
incluindo autenticação, permissões, backup, atualização, rollback e reinício
dos serviços. Isso não substitui homologação de DNS/HTTPS, firewall, reboot do
servidor e funcionamento das TVs físicas no ambiente final.
