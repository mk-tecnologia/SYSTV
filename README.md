# SYSTV

**Painel de preços para múltiplas TVs, desenvolvido pela MK Tecnologia.**

O SYSTV centraliza a gestão de produtos, preços e identidade visual de estabelecimentos comerciais. A administração é feita pelo navegador, com permissões por usuário e por TV. As alterações são transmitidas às telas em tempo real, sem recarregamento manual.

[Instalação](#instalação) · [Operação](#operação) · [Documentação](#documentação) · [Releases](https://github.com/mk-tecnologia/SYSTV/releases) · [Histórico de versões](CHANGELOG.md) · [Licença](#licença)

## Recursos

- **Múltiplas TVs:** catálogos independentes, com produtos, preços, unidades, ofertas e ordenação.
- **Atualização em tempo real:** distribuição das alterações por Server-Sent Events (SSE).
- **Identidade visual:** nome da empresa, logos e mensagem de rodapé configuráveis.
- **Controle de acesso:** administradores e operadores, com autorização de edição por TV.
- **Contas e autenticação:** recuperação de senha por e-mail e autenticação em dois fatores.
- **Operação do servidor:** diagnóstico, backups agendados, atualização e rollback por linha de comando.

## Requisitos

| Componente | Requisito |
| --- | --- |
| Sistema operacional | Debian GNU/Linux 13 dedicado |
| Arquitetura | `amd64` ou `arm64` |
| Gerenciamento de serviços | systemd em execução |
| Instalação | Acesso `root` e conexão à internet para baixar pacotes e releases |
| Clientes | Navegador com acesso ao servidor e confiança no certificado HTTPS |
| Rede | Nome ou IP acessível pelos computadores e pelas TVs |

O instalador provisiona Node.js 24, MariaDB, Nginx e os serviços systemd. Docker e DDEV são usados apenas no desenvolvimento; não são necessários no servidor de produção.

## Instalação

Em um Debian 13 dedicado, execute como `root`:

```bash
apt-get update && apt-get install -y curl ca-certificates
curl -fsSLo /tmp/systv-install.sh \
  https://github.com/mk-tecnologia/SYSTV/releases/latest/download/install.sh
bash /tmp/systv-install.sh
```

O assistente solicita nome do servidor, domínio local, fuso horário e URL de acesso. A última release estável é baixada e seu SHA-256 é verificado antes da instalação.

Para informar os parâmetros diretamente:

```bash
bash /tmp/systv-install.sh \
  --origin https://srv-systv.empresa.intranet \
  --hostname srv-systv \
  --domain empresa.intranet \
  --timezone America/Sao_Paulo \
  --interface ens18
```

Ajuste o domínio e a interface ao ambiente. O nome de acesso precisa resolver para o IP do servidor nos clientes. O instalador não configura o DNS da rede nem regras de firewall.

### Preparação do Debian

A instalação inicial incorpora o perfil Debian do [SCRIPTS-INI](https://github.com/mk-tecnologia/SCRIPTS-INI):

- Banner original MKTECNOLOGIA no console, com informações do sistema e IPv4 da interface.
- `vim`, `fastfetch`, MOTD, aliases do root e domínio do kernel.
- QEMU Guest Agent instalado; sua inicialização depende do canal disponibilizado pela VM.
- Ajuste `systemd.ssh_auto=no` no GRUB para desativar a autodetecção de sockets SSH AF_VSOCK.

**Acesso SSH:** o instalador cadastra no root a chave pública de `marcos@mktecnologia.net.br`, idêntica à do SCRIPTS-INI, preserva chaves existentes e exige autenticação por chave pública. Senha e autenticação interativa SSH são desativadas. A configuração é validada antes da aplicação.

Ao concluir, execute `systvctl doctor`. Reinicie o servidor para aplicar o parâmetro do GRUB.

## Primeiro acesso

A instalação cria um catálogo vazio com uma TV e emite um link de ativação para o primeiro administrador. Encaminhe esse link por um canal privado ao responsável, que definirá nome, usuário e senha no navegador.

O link é de uso único e tem validade de **24 horas**. Após a ativação, não pode ser utilizado para substituir uma conta existente. Não há senha administrativa padrão.

Para substituir um link expirado antes da ativação:

```bash
systvctl activation-link
```

A emissão invalida o link anterior. Em instalações sem terminal interativo, o link é salvo em `/etc/systv/activation-link.txt`, com leitura restrita ao root, e não é impresso nos logs de automação.

Após entrar na administração, configure a identidade da empresa e cadastre os produtos.

### Exibição e monitoramento das TVs

Selecione a TV no painel e use **Copiar link da TV**. Configure esse endereço uma vez no navegador ou no gerenciador que inicia as telas. A TV se registra automaticamente, sem login administrativo, códigos de pareamento ou aprovação presencial.

O mesmo link permanece válido após reinícios; o navegador recupera o monitoramento após quedas de rede ou expiração da credencial. Para trocar um link exposto, use **Configurar TV → Renovar link de exibição**. Isso invalida o endereço anterior e as autorizações somente daquela TV.

**Prévia da TV** abre uma visualização que não interfere no indicador online. O catálogo continua público para os dispositivos que alcançam o servidor; o link de exibição autoriza apenas o registro de presença e não permite administrar produtos ou usuários.

Dispositivos já autorizados continuam funcionando. TVs antigas abertas apenas com `/tv?screen=...`, sem uma credencial válida, precisam receber o link completo de exibição uma vez. Essa configuração pode ser feita pelo gerenciador das telas; não exige ler ou digitar códigos em cada aparelho.

## HTTPS e certificados

HTTPS é obrigatório para acesso de produção pela rede. Por padrão, o instalador gera um certificado autoassinado, adequado ao uso interno quando a confiança é configurada nos dispositivos clientes.

| Modo | Aplicação | Parâmetros |
| --- | --- | --- |
| Autoassinado | Rede interna sem autoridade certificadora própria | `--tls self-signed` |
| Certificado fornecido | Certificado corporativo ou emitido externamente | `--tls provided --tls-cert /root/fullchain.pem --tls-key /root/server.key` |
| Let's Encrypt | Domínio público com validação HTTP-01 e porta 80 acessível externamente | `--tls letsencrypt --email admin@exemplo.com.br` |
| HTTP em loopback | Testes locais no próprio servidor | `--origin http://127.0.0.1 --tls none` |

O certificado autoassinado precisa ser importado como confiável nos computadores e TVs. Sem essa etapa, os navegadores apresentam um alerta de segurança. Let's Encrypt não emite certificados para nomes internos como `.intranet` e `.local`.

Para alterar a configuração de um servidor instalado:

```bash
systvctl web --origin https://srv-systv.empresa.intranet --tls self-signed
```

Consulte o [guia de implantação](docs/debian-13.md) para certificados corporativos, emissão externa por DNS-01 e recuperação de instalações interrompidas.

## Operação

Execute os comandos administrativos como `root`:

| Comando | Finalidade |
| --- | --- |
| `systvctl doctor` | Verificar serviços, banco de dados, HTTPS e agendamento de backup |
| `systvctl version` | Consultar a versão instalada e o runtime Node.js |
| `systvctl backup` | Criar backup do banco e das configurações |
| `systvctl update` | Instalar a última release estável |
| `systvctl update --version vX.Y.Z` | Atualizar para uma versão específica |
| `systvctl rollback` | Reativar a release anterior |
| `systvctl web` | Ajustar URL e certificado de acesso |
| `systvctl server` | Reaplicar a preparação do Debian |
| `journalctl -u systv -f` | Acompanhar os logs da aplicação |

Os backups ficam em `/var/backups/systv`. O instalador habilita o agendamento diário; o procedimento de restauração está no [guia de implantação](docs/debian-13.md).

As atualizações preservam contas, catálogo e configurações e não reabrem a ativação inicial. A preparação completa de SSH e do root é aplicada na instalação inicial ou por `systvctl server`, não em atualizações comuns.

**Rollback de código não desfaz migrações do banco.** Consulte os procedimentos de backup e recuperação antes de reverter uma implantação.

## Segurança

A instalação e a aplicação incluem:

- SSH somente por chave pública, com configuração validada antes de entrar em vigor.
- Aplicação e MariaDB vinculados ao loopback; Nginx como ponto de acesso HTTP/HTTPS.
- Serviço da aplicação executado como usuário `systv`, sem permissão de escrita sobre código, runtime ou configurações.
- Senhas com hash scrypt, sessões persistentes e cookies `HttpOnly`, `SameSite=Strict` e `Secure` em HTTPS.
- Limitação de requisições e tentativas de autenticação, validação de origem e cabeçalhos de segurança.
- Gravação atômica dos arquivos systemd, verificação do Node extraído e sincronização em disco antes da conclusão da instalação.

A proteção da rede, as regras de firewall, a confiança dos certificados nos clientes e a integridade do armazenamento do hipervisor fazem parte da administração do ambiente.

Detalhes técnicos e limites das validações estão na [documentação de segurança](docs/security-hardening.md) e na [auditoria de segurança](docs/security-audit-2026-10-29.md).

## Documentação

| Referência | Conteúdo |
| --- | --- |
| [Implantação no Debian 13](docs/debian-13.md) | Instalação, certificados, atualização, backup e recuperação |
| [Desenvolvimento e funcionamento](docs/development.md) | Ambiente local, arquitetura, usuários, permissões e regras do sistema |
| [Diretrizes de interface](docs/layout.md) | Padrões compartilhados de layout e componentes |
| [Segurança](docs/security-hardening.md) | Controles implementados e escopo dos testes |
| [Revisão de exposição de segredos](docs/security-review.md) | Verificações de arquivos e informações públicas |
| [Histórico de versões](CHANGELOG.md) | Alterações por release |

## Desenvolvimento e distribuição

A aplicação utiliza Node.js 24, MariaDB e JavaScript no navegador. O ambiente local com DDEV e os comandos de desenvolvimento estão descritos no [guia de desenvolvimento](docs/development.md).

As releases seguem o formato `vX.Y.Z` e disponibilizam `install.sh`, `systv-vX.Y.Z.tar.gz` e `SHA256SUMS`. O pacote é reproduzível e exclui ambientes locais, testes, bancos de dados, certificados, backups e arquivos `.env`.

A integração contínua verifica sintaxe, dependências, segredos no histórico e testes da aplicação, além de instalação, atualização, rollback e recuperação em Debian 13 com systemd, por HTTP local e HTTPS.

## Licença

Copyright © 2026 MK Tecnologia.

O SYSTV é software livre, distribuído sob a **GNU General Public License, versão 3 ou posterior** (`GPL-3.0-or-later`). Você pode usar, estudar, modificar e redistribuir o sistema conforme os termos da licença.

O software é fornecido sem garantia, conforme previsto na GPL. Consulte o texto integral em [LICENSE](LICENSE). Componentes de terceiros mantêm suas respectivas licenças.
