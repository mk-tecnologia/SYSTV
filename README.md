# SYSTV — produção no Debian 13

Painel de preços para múltiplas TVs, com administração, usuários, permissões,
logos e atualização dos preços em tempo real. Este repositório distribui o
sistema e seu instalador de produção.

O instalador configura Node.js 24, MariaDB, Nginx, serviço systemd,
HTTPS opcional com renovação, senhas aleatórias, backups diários e releases
com atualização e rollback. O catálogo de produção começa vazio, com uma TV.
Não depende de Docker, DDEV, Git ou npm previamente instalados no servidor.

## Instalação

Use Debian 13 amd64/arm64 com systemd, acesso root, internet e servidor
dedicado. Para HTTPS, tenha um domínio apontando ao servidor e libere as
portas 80 e 443. Na rede local, também é possível usar HTTP pelo IP fixo.

**Distribuição privada:** este repositório exige acesso de leitura no GitHub.
No servidor, como root:

```bash
apt-get update && apt-get install -y gh ca-certificates
gh auth login
install -d -m 700 /usr/local/src/systv-installer
gh release download --repo mk-tecnologia/systv \
  --pattern install.sh --clobber --dir /usr/local/src/systv-installer
GITHUB_TOKEN="$(gh auth token)" bash /usr/local/src/systv-installer/install.sh
```

O assistente pede a URL e, para HTTPS, o e-mail do certificado. Ele baixa a
última release estável, confere o checksum e provisiona o servidor. O token
é usado apenas durante o download e não é persistido pela instalação.
O login feito pelo `gh auth login` é mantido pelo próprio GitHub CLI.

**Link de instalação para distribuição pública:** se o proprietário tornar o
repositório público, o comando sem autenticação será:

```bash
apt-get update && apt-get install -y curl ca-certificates
curl -fsSL https://github.com/mk-tecnologia/systv/releases/latest/download/install.sh \
  -o /tmp/systv-install.sh && bash /tmp/systv-install.sh
```

Esse link não funciona anonimamente enquanto o repositório for privado.
Para instalações sem perguntas:

```bash
# Acrescente GITHUB_TOKEN ao ambiente quando a distribuição for privada.
bash /usr/local/src/systv-installer/install.sh \
  --origin https://tv.exemplo.com.br --email admin@exemplo.com.br
```

## Primeiro acesso e operação

```bash
cat /etc/systv/acesso-inicial.txt
systvctl doctor
systvctl version
```

Entre na URL configurada com as credenciais geradas e troque a senha.
Cadastre a empresa e os produtos; o link da primeira TV é `/tv?screen=tv01`.

```bash
systvctl backup
systvctl update                     # última release estável
systvctl update --version v2.1.2    # versão específica
systvctl rollback                  # código anterior, sem reverter o banco
journalctl -u systv -f
```

Para atualizações privadas, prefixe o comando com
`GITHUB_TOKEN="$(gh auth token)"`. As configurações e os dados são preservados;
a atualização faz backup antes de aplicar migrações.

[Guia completo de produção, backup e recuperação](docs/debian-13.md).
[Documentação funcional e desenvolvimento](docs/development.md).

## Releases

As versões estáveis usam tags `vX.Y.Z`. Cada release contém `install.sh`,
`systv-vX.Y.Z.tar.gz` e `SHA256SUMS`. O pacote é reproduzível e não contém
DDEV, dependências locais, testes, bancos, certificados, backups ou `.env`.
A CI verifica o pacote e testa instalação, autenticação, atualização e rollback
em Debian 13 descartável com systemd. Certificados públicos dependem do DNS
e precisam ser conferidos no servidor de destino.
