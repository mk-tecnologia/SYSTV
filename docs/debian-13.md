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
já confiável pelo equipamento. HTTP de rede não é aceito pelo instalador. Não desative
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

### HTTPS obrigatório na rede

O instalador e a aplicação em produção recusam HTTP para hostnames e IPs de
rede. `http://127.0.0.1` e `http://localhost` são reservados a testes locais;
eles não são uma origem para acesso de TVs pela rede. O proxy continua falando
HTTP com o Node em loopback, enquanto clientes usam HTTPS.

Antes de atualizar uma instalação antiga que usa HTTP, configure sua origem
HTTPS e a confiança do certificado nos clientes:

```bash
systvctl web --origin https://tv.empresa.intranet --tls self-signed
```

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
senha administrativa existente, senha do banco, chave SMTP, usuários e dados. Se preferir
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
/etc/systv/activation-link.txt   link inicial, somente root
/etc/systv/acesso-inicial.txt    instruções de primeiro acesso
/etc/systv/tls/                  certificado e chave privada
/etc/systv/web-mode              modo de acesso configurado
/var/backups/systv/              backups locais protegidos
/var/log/systv/                  logs do provisionamento
```

O serviço roda como `systv`, sem shell, com código de root e somente leitura
para o processo. Usa `NODE_ENV=production` e escuta em `127.0.0.1:3000`, atrás
do Nginx, com buffering desativado para SSE. A senha do banco e a chave de
criptografia SMTP são geradas individualmente. O primeiro administrador define
a própria senha pela ativação no navegador. O catálogo começa
vazio, com uma TV. Produção não importa SQLite nem o banco de desenvolvimento.

O instalador não altera DNS ou firewall. Preserve a porta SSH. Permita acesso
web somente pela rede desejada; 3000 e 3306 não precisam ficar acessíveis às TVs.

```bash
systvctl doctor
systvctl version
journalctl -u systv -f
systemctl status systv nginx mariadb systv-backup.timer
```

Receba o link mostrado ao instalador, abra no navegador e defina o seu acesso.
Depois configure empresa/produtos pelo painel. Configure SMTP
para recuperação de senha e 2FA. `ADMIN_PASSWORD` não cria nem redefine contas em produção; preserve `MAIL_ENCRYPTION_KEY` para ler as credenciais SMTP.
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

## Nome curto mostrando “Welcome to nginx”

Use sempre a origem configurada, por exemplo `https://tv.empresa.intranet`.
A partir da versão 2.2.1, acessar `http://tv` redireciona ao endereço completo,
preservando o caminho e os parâmetros. O certificado continua valendo para
`tv.empresa.intranet`; acesso direto por `https://tv` pode mostrar erro de nome
no certificado. Não é necessário remover o site padrão global do Nginx.

Para aplicar o ajuste a uma instalação existente com certificado local, baixe
o instalador atual e execute `--configure-web --tls self-signed`. Um certificado
local válido para o mesmo nome é preservado. Banco e credenciais não são alterados.

## Ativação do primeiro administrador (2.3.0)

Instalações novas não têm senha administrativa gerada ou padrão. Ao terminar,
o instalador exibe no terminal um link exclusivo com validade de 24 horas.
Encaminhe-o ao responsável pela loja por um canal privado. No navegador ele
escolhe nome, usuário, e-mail opcional e senha, confirma e depois entra no painel.
Não é preciso que o responsável tenha acesso ao servidor.

Apenas um link fica válido por instalação. Para renovar antes da ativação:

```bash
systvctl activation-link
```

Esse comando local, executado por root, invalida imediatamente o link anterior,
salva o novo link em `/etc/systv/activation-link.txt` (0600) e o mostra na saída.
Não execute com saída encaminhada a logs públicos. A instalação automática sem
terminal não imprime o link; guarde e entregue o arquivo privado por um canal
adequado. Senha, token e link não aparecem no log de provisionamento.

O banco armazena somente SHA-256 do token aleatório de 256 bits e seu prazo.
A criação do administrador e o consumo do link ocorrem em uma transação, sob o
mesmo bloqueio das alterações de usuários. Requisições simultâneas não criam
administradores adicionais. Abrir/verificar o link não o consome; somente salvar
os dados conclui a ativação. O navegador remove o token da barra de endereço,
não o grava em armazenamento local e envia-o apenas no corpo da requisição.

Depois de concluído, a ativação fica fechada, inclusive se alguém remover as
contas manualmente no banco. Não há emissão pública de links. O e-mail informado
na ativação ainda depende da configuração SMTP para recuperação/2FA; ativar a
conta não envia mensagens nem habilita 2FA automaticamente.

Atualizações de servidores 2.2.x ou anteriores preservam usuários, senhas,
permissões e sessões. Se já existir qualquer conta, a migração fecha a ativação
e o comando de emissão recusa criar um link. Use o login/recuperação existente.
O parâmetro de senha administrativa por ambiente permanece apenas para o fluxo
de desenvolvimento, não para provisionar produção.

Se a URL for alterada antes de entregar o link, `systvctl web` atualiza a origem
do arquivo privado. Um link já encaminhado pode apontar para o endereço antigo;
emita e entregue outro para invalidá-lo e usar a nova origem.

### Versão no painel

O cabeçalho mostra a versão instalada e avisa quando há uma release estável mais recente no GitHub. A consulta parte do servidor para `api.github.com`, sem credenciais, com cache de cinco minutos. Em caso de falta de internet, a versão instalada continua visível e a verificação é indicada como indisponível, com nova tentativa após cinco minutos. O botão “Verificar agora” renova a consulta, com intervalo mínimo de 30 segundos entre chamadas ao GitHub. O horário da consulta aparece ao passar o mouse pelo status. O aviso abre as notas da versão; a atualização continua pelo comando `systvctl update` no servidor.

## Retomar instalação inicial e atualizar runtime

Nas instalações criadas pelo instalador corrigido, uma falha preserva o estado
privado em `/etc/systv/install-pending.json`. Corrija a causa e retome com o
mesmo pacote extraído: `bash deploy/debian/install.sh --resume`. O bootstrap
local também encaminha `--resume`; fixe a mesma versão com `--version` quando
ela estiver publicada. Não informe novamente origem ou certificados: os
parâmetros e segredos originais são preservados. Falhas anteriores à criação
desse estado não criam recursos da aplicação e permitem nova instalação normal.
Isso não autoriza reaproveitar bancos ou diretórios de outra instalação.

Cada release nova contém seu próprio Node.js 24, baixado da distribuição
oficial com verificação SHA-256 também nas atualizações. O rollback recupera
código e runtime juntos; a conversão preserva o runtime de releases legadas.
O build de dependências usa `systv-build`, com UID distinto de `systv`, em serviço
systemd isolado e sem acesso à configuração privada. Código e ferramentas de
root nunca são graváveis pelo usuário da aplicação.

## Autorizar a presença das TVs

No navegador de cada TV, entre no painel com uma conta autorizada para aquela
TV e abra o painel de exibição. Isso registra uma credencial de presença local;
depois, saia da administração. A credencial permanece no navegador, não na URL,
e o banco guarda somente seu hash. Ela vale por 90 dias de inatividade, com
renovação a cada heartbeat válido; há no máximo 100 dispositivos por TV.

Links antigos continuam exibindo o catálogo público, mas não podem informar
presença online até autorizar o dispositivo. Limpar os dados do navegador exige
nova autorização. Para revogar todos os dispositivos de uma TV:

```bash
systvctl revoke-devices tv01
```

A API autenticada também permite `DELETE /api/screens/tv01/devices`, respeitando
as permissões da conta. A revogação não apaga a TV nem seus produtos e não fecha
sessões administrativas. Saia das sessões que não devem autorizar novamente.
O catálogo público permanece apropriado à exibição; restrinja a rede caso seus
preços não devam ser consultados externamente.
