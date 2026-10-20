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

O assistente pede a URL de acesso e baixa a última release estável, verificando
o SHA-256. Na intranet, por exemplo:

```bash
bash /tmp/systv-install.sh --origin https://tv.empresa.intranet
```

HTTPS usa **certificado local por padrão**, sem contatar Let's Encrypt e sem
precisar expor o servidor na internet. Distribua o certificado gerado aos
computadores e TVs e configure a confiança nesses dispositivos; caso contrário,
o navegador mostrará um alerta. Se a empresa tem uma CA, prefira um certificado
dela. Veja as opções de certificado abaixo.

A instalação configura Node.js 24, MariaDB, Nginx, serviço systemd, senhas
aleatórias, backups diários e releases com atualização/rollback. O catálogo
começa vazio, com uma TV.

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
| HTTP | Rede local em que se aceita tráfego sem criptografia | `--origin http://tv.empresa.intranet --tls none` |
| Let's Encrypt HTTP-01 | Domínio público com porta 80 acessível externamente | `--origin https://tv.exemplo.com.br --tls letsencrypt --email admin@exemplo.com.br` |

Let’s Encrypt não emite para nomes `.intranet`, `.local` ou outros nomes
internos. Para um domínio público em um servidor privado, é possível emitir
por DNS-01 fora do instalador e importar o certificado com `provided`; não é
necessário publicar o servidor na internet para esse fluxo.

Na versão atual, altere a configuração existente usando as mesmas opções:

```bash
systvctl web --tls self-signed
systvctl web --origin http://tv.empresa.intranet --tls none
```

O instalador não abre portas no firewall nem configura o DNS da rede.

## Primeiro acesso e operação

```bash
cat /etc/systv/acesso-inicial.txt
systvctl doctor
systvctl version
```

Entre com as credenciais geradas e troque a senha. Cadastre empresa e produtos;
o link da primeira TV é `/tv?screen=tv01`.

```bash
systvctl backup
systvctl update
systvctl update --version v2.2.0
systvctl rollback
journalctl -u systv -f
```

[Guia de produção, certificados, backup e recuperação](docs/debian-13.md).
[Revisão da exposição pública de segredos](docs/security-review.md).
[Documentação funcional e desenvolvimento](docs/development.md).

## Releases e verificação

Tags estáveis: `vX.Y.Z`. Cada release contém `install.sh`,
`systv-vX.Y.Z.tar.gz` e `SHA256SUMS`. O pacote é reproduzível e exclui DDEV,
dependências locais, testes, bancos, certificados, backups e `.env`.
A CI executa Gitleaks em todo o histórico e testa a aplicação e o instalador
em Debian 13 descartável com systemd real, tanto por HTTP quanto por HTTPS local.
