# SYSTV em produção — Debian 13

O [README](../README.md) contém o comando de instalação por link. Execute como
root em Debian 13 amd64/arm64 dedicado, com systemd e internet para baixar os
pacotes. O acesso das TVs pode ser exclusivamente pela intranet.

## Intranet e certificados

Uma URL HTTPS não significa que o servidor está exposto na internet. A partir
da versão 2.2.0, HTTPS gera certificado local por padrão. Certbot só é executado
com `--tls letsencrypt` explícito.

### Certificado local

```bash
bash /tmp/systv-install.sh --origin https://tv.empresa.intranet
```

O certificado tem SAN para o hostname ou IP, chave privada aleatória e validade
de um ano. A aplicação usa cookies seguros. Arquivos:

- `/etc/systv/tls/server.crt`: certificado público a distribuir aos clientes;
- `/etc/systv/tls/server.key`: chave privada, permissão 0600, somente root.

O navegador não confia automaticamente nesse certificado. Distribua somente
`server.crt` por um canal confiável e instale a confiança nos computadores e TVs.
Confira a impressão digital no servidor antes da distribuição:

```bash
openssl x509 -in /etc/systv/tls/server.crt -noout -fingerprint -sha256 -enddate
```

A instalação de confiança depende do sistema e do navegador de cada TV.
Algumas TVs não permitem importar certificados; nesse caso, prefira uma CA
já confiável pelo equipamento ou avalie HTTP na rede controlada. Não desative
a verificação de certificados globalmente nos navegadores.

Executar `systvctl web --tls self-signed` preserva um certificado local válido
para o mesmo nome com mais de 30 dias restantes. Para renovar explicitamente:

```bash
systvctl web --tls self-signed --renew-certificate
```

Uma renovação de certificado autoassinado exige redistribuir a confiança.
Não há renovação automática nesse modo. Para uma frota administrada, prefira
certificado emitido pela CA da empresa, cujo certificado raiz já esteja
instalado nos clientes.

### Certificado da empresa ou emitido fora do servidor

```bash
bash /tmp/systv-install.sh --origin https://tv.empresa.intranet --tls provided \
  --tls-cert /root/fullchain.pem --tls-key /root/server.key
```

Forneça PEM com o certificado e a cadeia, e a chave privada correspondente sem
senha, protegida no servidor. O instalador valida validade, hostname/IP e
correspondência entre chave e certificado antes de mudar a configuração.
A CA precisa ser confiável nos clientes. Para substituir/renovar depois:

```bash
systvctl web --tls provided --tls-cert /root/fullchain.pem --tls-key /root/server.key
```

As cópias ficam em `/etc/systv/tls`; a origem não é monitorada automaticamente.
A empresa deve renovar o certificado, copiar a nova versão e executar o comando.

### HTTP na intranet

```bash
bash /tmp/systv-install.sh --origin http://tv.empresa.intranet --tls none
# Em instalação existente:
systvctl web --origin http://tv.empresa.intranet --tls none
```

Não exige certificados. Cookies são configurados para HTTP. Credenciais e dados
trafegam sem criptografia; use somente quando esse risco for aceitável na rede.
Não há troca automática de HTTPS para HTTP em caso de falha.

### Domínio público e Let's Encrypt

```bash
bash /tmp/systv-install.sh --origin https://tv.exemplo.com.br \
  --tls letsencrypt --email admin@exemplo.com.br
```

Este modo usa HTTP-01: domínio público e porta 80 acessível ao Let's Encrypt.
O contato informado aceita os termos da autoridade certificadora. Certbot
configura TLS e renovação automática. Nomes internos conhecidos, IPs e nomes
curtos são recusados antes de provisionar; DNS sem endereços públicos é
recusado antes de chamar Certbot.

Um servidor privado com um subdomínio de um domínio público pode ter certificado
válido sem abrir portas, usando DNS-01. Como depende do provedor DNS e de suas
credenciais, emita/renove em ferramenta apropriada e use o modo `provided` para
instalá-lo. Não use HTTP-01 para o servidor que continuará restrito à intranet.

Referências: [nomes locais e certificados próprios](https://letsencrypt.org/docs/certificates-for-localhost/),
[HTTP-01 e DNS-01](https://letsencrypt.org/docs/challenge-types/).

## Recuperar a falha de Certbot das versões 2.1.x

O banco e a aplicação já foram criados quando o instalador chegou ao Certbot.
Não remova `/opt/systv`, `/etc/systv`, contas ou bancos para executar novamente.
Baixe o instalador atual e corrija apenas o proxy, a origem e os cookies:

```bash
curl -fsSL https://github.com/mk-tecnologia/systv/releases/latest/download/install.sh \
  -o /tmp/systv-install.sh
bash /tmp/systv-install.sh --configure-web --tls self-signed
```

A URL existente é lida de `/etc/systv/systv.env`. O comando não depende de já
haver `systvctl web` instalado, funciona sobre a versão anterior e preserva
senha administrativa, senha do banco, chave SMTP, usuários e dados. Se preferir
HTTP, especifique explicitamente a nova URL e `--tls none`.

A configuração anterior é guardada em `/var/backups/systv/web-*.tar.gz`, com
acesso restrito a root. Se a validação Nginx ou a verificação da nova URL falhar,
o comando restaura a configuração anterior e tenta reiniciar os serviços.
Após corrigir o acesso, atualize o código:

```bash
systvctl update
systvctl doctor
```

## Estrutura e operação

```text
/opt/systv/node/                 Node.js 24 isolado
/opt/systv/current -> releases/  versão ativa
/opt/systv/releases/             versões do código e dependências
/etc/systv/systv.env             configuração e segredos persistentes
/etc/systv/acesso-inicial.txt    credenciais iniciais, somente root
/etc/systv/tls/                  certificado e chave privada
/etc/systv/web-mode              modo de acesso configurado
/var/backups/systv/              backups locais protegidos
/var/log/systv/                  logs do provisionamento
```

O serviço roda como `systv`, sem shell, com código de root e somente leitura
para o processo. Usa `NODE_ENV=production` e escuta em `127.0.0.1:3000`, atrás
do Nginx, com buffering desativado para SSE. Banco, administrador e chave de
criptografia SMTP têm segredos gerados individualmente. O catálogo começa
vazio, com uma TV. Produção não importa SQLite nem o banco de desenvolvimento.

O instalador não altera DNS ou firewall. Preserve a porta SSH. Permita acesso
web somente pela rede desejada; 3000 e 3306 não precisam ficar acessíveis às TVs.

```bash
cat /etc/systv/acesso-inicial.txt
systvctl doctor
systvctl version
journalctl -u systv -f
systemctl status systv nginx mariadb systv-backup.timer
```

Troque a senha inicial e configure empresa/produtos pelo painel. Configure SMTP
para recuperação de senha e 2FA. Alterar `ADMIN_PASSWORD` não redefine contas
existentes; preserve `MAIL_ENCRYPTION_KEY` para ler as credenciais SMTP.
Reinicie o serviço após editar o ambiente.

## Atualização e rollback

```bash
systvctl update
systvctl update --version v2.2.0
systvctl rollback
ls -1 /opt/systv/releases
```

O bootstrap usa apenas releases estáveis e confere SHA-256. É uma verificação
de integridade da mesma origem HTTPS, não uma assinatura independente.
Atualizar instala dependências em outra pasta, testa sharp, para a aplicação,
faz backup e aplica migrações. A troca de `current` é atômica; existe uma pausa
durante backup/migração/reinício. Dados e configuração web são preservados.
Em erro após parar/ativar, tenta reativar o código anterior.

Rollback troca apenas o código e faz backup antes; não desfaz migrações.
Migrações futuras precisam preservar compatibilidade com a versão anterior.
Se for necessário reverter dados, restaure backup compatível em manutenção.
Releases anteriores são preservadas; remova apenas versões que não sejam a
atual ou a anterior e após verificar backups.

Instalações antigas com `/opt/systv/app`, sem link `current`, não são atualizadas
automaticamente. A instalação 2.1.x com `current` é compatível com este fluxo.

## Backup e restauração

```bash
systvctl backup
systemctl list-timers systv-backup.timer
```

O backup diário ocorre às 03:15 (horário do servidor), com atraso aleatório de
até dez minutos e retenção de 14 dias. Cada diretório contém `database.sql.gz`,
`config.tar.gz`, `VERSION` e `SHA256SUMS`. Inclui banco, configuração e chaves
TLS/SMTP. Somente root pode ler. Remoção de backups expirados ocorre após um
novo backup bem-sucedido. Snapshots `web-*.tar.gz` não são removidos por essa
retenção; gerencie-os junto aos seus backups protegidos.

Não há cópia externa automática: transfira os backups para outro equipamento
protegido. Nunca envie backups, `.env` ou chaves privadas ao GitHub.

Para restaurar um backup verificado durante manutenção:

```bash
cd /var/backups/systv/NOME-DO-BACKUP
sha256sum --check SHA256SUMS
systemctl stop systv
bash -o pipefail -c 'gzip -dc database.sql.gz | mariadb systv'
tar -xzf config.tar.gz -C /etc
systemctl start systv
systvctl doctor
```

Use código e configuração compatíveis. Em outro servidor, ajuste também as
contas MariaDB: o dump do banco não recria o usuário do servidor MariaDB. O
backup de `/etc/systv` inclui certificados, mas não inclui o site Nginx ou o
estado global do Certbot; reconfigure a camada web após recuperação completa.

Mantenha Debian e Node.js 24 atualizados. A atualização do código não substitui
o runtime Node: faça sua atualização em manutenção, teste e reinicie.

## Verificação e acesso privado opcional

A CI verifica a aplicação, o pacote e o histórico com Gitleaks, e testa HTTP,
HTTPS local, certificados de CA, recuperação, credenciais preservadas, backup,
atualização, rollback e reinício dos serviços em Debian 13 com systemd real.
DNS, confiança dos certificados em cada TV, firewall e reboot do servidor devem
ser conferidos no destino.

Se um fork for privado, o bootstrap aceita `GITHUB_TOKEN` com leitura de conteúdo
para os downloads. O token não é persistido nem passado à aplicação.
