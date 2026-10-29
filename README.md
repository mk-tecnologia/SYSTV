# SYSTV — produção no Debian 13

Painel de preços para múltiplas TVs, com administração, usuários, permissões,
logos e atualização dos preços em tempo real. Instalador para Debian 13 amd64
ou arm64 com systemd, sem depender de Docker/DDEV no servidor.

## Instalação por link

Como root, em um Debian 13 dedicado com acesso à internet para baixar os pacotes:

```bash
apt-get update && apt-get install -y curl ca-certificates
curl -fsSL https://github.com/mk-tecnologia/systv/releases/latest/download/install.sh \
  -o /tmp/systv-install.sh
bash /tmp/systv-install.sh
```

O assistente pede hostname, domínio local, fuso e URL de acesso, e baixa a última release estável, verificando
o SHA-256. Na intranet, por exemplo:

```bash
bash /tmp/systv-install.sh --origin https://tv.empresa.intranet
```

HTTPS usa **certificado local por padrão**, sem contatar Let's Encrypt e sem
precisar expor o servidor na internet. Distribua o certificado gerado aos
computadores e TVs e configure a confiança nesses dispositivos; caso contrário,
o navegador mostrará um alerta. Se a empresa tem uma CA, prefira um certificado
dela. Veja as opções de certificado abaixo.

A instalação configura Node.js 24, MariaDB, Nginx, serviço systemd, ativação do
primeiro administrador por link, backups diários e releases com atualização/rollback.
O catálogo começa vazio, com uma TV. O servidor recebe identificação da MK Tecnologia
no console, com o banner original do SCRIPTS-INI, sistema, kernel, hostname e IP.
Instala vim, qemu-guest-agent e fastfetch; configura MOTD, aliases do root e domínio
do kernel. Cadastra a chave pública do administrador do SCRIPTS-INI e desativa
a autenticação SSH por senha. O GRUB recebe `systemd.ssh_auto=no`.

Para configurar o perfil em uma instalação atualizada:

```bash
systvctl server --hostname srv-systv --domain mk.intranet --timezone America/Sao_Paulo
```

## Corrigir uma instalação interrompida no Certbot

Não apague o banco nem reinstale. Baixe o instalador atual pelo comando acima e execute:

```bash
bash /tmp/systv-install.sh --configure-web --tls self-signed
```

O comando lê a URL já configurada e instala HTTPS local. Preserva o banco,
as contas, a senha administrativa e a chave SMTP; salva uma cópia privada da
configuração anterior. Também funciona para instalações das releases 2.1.x.
Depois, `systvctl update` instala a versão mais nova do código e das ferramentas.

## Escolher o modo de acesso

| Modo | Quando usar | Opções |
|---|---|---|
| HTTPS local | Intranet sem CA; exige configurar confiança nos clientes | `--origin https://tv.empresa.intranet --tls self-signed` |
| HTTPS com CA da empresa | Intranet com certificados corporativos | `--origin https://tv.empresa.intranet --tls provided --tls-cert /root/fullchain.pem --tls-key /root/server.key` |
| HTTP local | Somente testes em loopback | `--origin http://127.0.0.1 --tls none` |
| Let's Encrypt HTTP-01 | Domínio público com porta 80 acessível externamente | `--origin https://tv.exemplo.com.br --tls letsencrypt --email admin@exemplo.com.br` |

Let’s Encrypt não emite para nomes `.intranet`, `.local` ou outros nomes
internos. Para um domínio público em um servidor privado, é possível emitir
por DNS-01 fora do instalador e importar o certificado com `provided`; não é
necessário publicar o servidor na internet para esse fluxo.

Na versão atual, altere a configuração existente usando as mesmas opções:

```bash
systvctl web --tls self-signed
systvctl web --origin https://tv.empresa.intranet --tls self-signed
```

O instalador não abre portas no firewall nem configura o DNS da rede.

## Primeiro acesso por link

No final da instalação em um terminal, o instalador mostra um link exclusivo.
Quem instala encaminha esse link ao responsável pela loja, que abre no navegador
e escolhe **nome, usuário e senha**. O usuário não precisa entrar no servidor,
consultar arquivos ou receber uma senha padrão.

- O link vale por **24 horas**, sobrevive ao reinício e só pode ser usado uma vez.
- A senha é definida pelo próprio responsável e armazenada com hash scrypt.
- Depois da ativação, o primeiro acesso é encerrado definitivamente.
- Instalações que já possuem contas mantêm seus usuários, senhas e sessões.
- O token fica no fragmento do link (`#token=...`), não na URL enviada ao Nginx.

Se o link expirar ou precisar ser substituído antes da ativação, o instalador
pode emitir outro no servidor:

```bash
systvctl activation-link
```

Isso invalida o link anterior. Não há emissão de links pela tela pública.
O responsável recebe apenas o link: não precisa de acesso ao terminal.
O link deve ser encaminhado por um canal privado para a pessoa que assumirá a
administração; quem tiver o link válido poderá criar o primeiro administrador.

Em execução sem terminal interativo, o instalador salva o link em
`/etc/systv/activation-link.txt`, legível somente por root, e não o imprime em
logs de automação. Um operador autorizado pode consultar esse arquivo ou emitir
outro link para entregar ao usuário.

## Operação

Depois de ativar, entre no painel com o usuário e a senha escolhidos. Cadastre
empresa e produtos; o link da primeira TV é `/tv?screen=tv01`.

```bash
systvctl doctor
systvctl version
systvctl backup
systvctl update
systvctl rollback
journalctl -u systv -f
```

Em servidor já instalado, `systvctl update` preserva as contas e não reabre a
ativação. Para esquecimento de senha, use a recuperação por e-mail configurado.
O link inicial não serve para substituir um administrador existente.

[Guia de produção, certificados, backup e recuperação](docs/debian-13.md).
[Revisão da exposição pública de segredos](docs/security-review.md).
[Documentação funcional e desenvolvimento](docs/development.md).

## Releases e verificação

Tags estáveis: `vX.Y.Z`. Cada release contém `install.sh`,
`systv-vX.Y.Z.tar.gz` e `SHA256SUMS`. O pacote é reproduzível e exclui DDEV,
dependências locais, testes, bancos, certificados, backups e `.env`.
A CI executa Gitleaks em todo o histórico e testa a aplicação e o instalador
em Debian 13 descartável com systemd real, tanto por HTTP quanto por HTTPS local.

## Segurança na versão 2.6.0

Veja as [correções e o roteiro de testes](docs/security-hardening.md). O acesso de produção
pela rede passa a exigir HTTPS. A presença online das TVs exige autorização
inicial do navegador por uma sessão com permissão para aquela TV.
