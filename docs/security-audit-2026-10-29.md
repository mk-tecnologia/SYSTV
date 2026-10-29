# Revisão de segurança e instalador — 29/10/2026

Versão revisada: 2.5.0. Revisão de código, dependências e testes locais.
Este é o registro dos achados antes das correções. A implementação local e sua
validação estão descritas em [Correções de segurança](security-hardening.md).
Nenhuma configuração de produção foi alterada.

## Resultado

Há problemas a corrigir antes de considerar o instalador e a exposição pública
aprovados. As severidades abaixo consideram o impacto e as condições necessárias;
não significam que houve exploração no servidor.

### 1. Alta, condicionada: usuário do serviço pode adulterar ferramentas de root durante atualização

Referências: `deploy/debian/install.sh:171–178,194–195,221`.

O instalador entrega toda a nova release ao usuário `systv` durante `npm ci` e o
teste do sharp. A aplicação antiga só é parada depois dessa etapa. Um processo
já comprometido com essa identidade pode alterar `deploy/debian/systvctl`, os
scripts de ativação e suas dependências. O `chown` posterior não restaura o
conteúdo original. As ferramentas adulteradas passam a integrar a release e
podem ser executadas como root, inclusive pelo timer de backup.

Pré-requisito: execução de código como `systv` e coincidência com uma atualização;
não foi encontrada nesta revisão uma entrada remota que por si só forneça essa
execução. Confirmado por análise do fluxo e das permissões, sem exploração root.
O sandbox do serviço reduz a capacidade do processo principal de escrever no
filesystem, mas não torna seguro confiar a esse UID arquivos executados por root
em outros contextos.

Correção: construir dependências com uma identidade isolada da aplicação, em
staging privado; manter scripts e código usados por root fora da área gravável;
publicar somente depois de remover permissões de escrita e validar o conteúdo.

### 2. Moderada: Nodemailer vulnerável no lockfile

Referência: `package-lock.json:706`, versão 10.0.15.

`npm audit --omit=dev --json` consultado nesta revisão encontrou uma dependência
moderada, com três avisos de parsing de destinatários:

- https://github.com/advisories/GHSA-8c8m-p3m8-cjg8
- https://github.com/advisories/GHSA-m943-m63m-w62w
- https://github.com/advisories/GHSA-85x2-q946-cp5h

A versão corrigida indicada é 10.1.4. Atualizar o lockfile, testar envio SMTP,
recuperação e 2FA. A presença da biblioteca vulnerável foi confirmada; não foi
demonstrado desvio de destinatário nos fluxos do SYSTV. A validação local de e-mail
restringe parte dos formatos descritos nos avisos.

### 3. Moderada: limite de autenticação compartilhado por todos atrás do Nginx

Referências: `src/auth.js:14–19`; `deploy/debian/configure-web.sh:160–166`.

O limite usa `req.socket.remoteAddress`, que na instalação gerenciada representa
o proxy local. Onze POSTs de login, mesmo com login sintaticamente inválido,
esgotam a cota de dez tentativas e impedem outros usuários de entrar na mesma
janela de um minuto. Repetir o tráfego mantém a indisponibilidade. Outros fluxos
de autenticação também compartilham cotas por escopo.

Reprodução isolada do módulo confirmou HTTP 429 na 11ª chamada, antes de acessar
o banco. Correção: aplicar limites por cliente no Nginx e por conta na aplicação,
com limite global adicional. Qualquer IP encaminhado deve ser sobrescrito pelo
proxy confiável e aceito somente quando a conexão vier desse proxy.

### 4. Moderada: presença de TV pode ser falsificada e gerar escrita ilimitada

Referências: `src/app.js`, rota pública `/api/screens/:id/heartbeat`;
`src/presence.js:5–12,22`.

Não é necessário autenticar nem comprovar vínculo com uma TV. IDs de telas são
públicos em `/api/state`; qualquer cliente pode gerar identificadores de dispositivo
e inserir presenças, inflando o contador e produzindo registros que ficam até um
dia. Não há cota de dispositivos ou taxa no fluxo revisado. A remoção de presença
também aceita apenas esses identificadores.

Reprodução isolada confirmou três escritas para três IDs inventados. Correção:
vincular dispositivos a credenciais de TV e limitar taxa e quantidade de registros.
Se a exibição continuar pública, documentar que o indicador de presença não é
uma confirmação confiável da identidade do equipamento.

### 5. Moderada: alteração de e-mail de recuperação sem senha atual

Referências: `src/auth.js:140–158`, comparado com `updateEmail`.

Quando o 2FA está desligado, `/api/account/profile` permite alterar o e-mail
usando apenas a sessão; a senha atual só é verificada se uma nova senha também
for enviada. Já `/api/account/email` exige senha. Uma sessão roubada pode mudar
o destino da recuperação e, se SMTP estiver habilitado, facilitar a tomada
persistente da conta. É necessário ter uma sessão válida; não é acesso anônimo.

Correção: exigir senha atual também para mudanças de e-mail e confirmar posse
do novo endereço antes de torná-lo destino de recuperação.

### 6. Moderada: atualização da aplicação não atualiza o Node.js

Referência: `deploy/debian/install.sh:109–123`.

O Node é baixado somente em instalação nova. `systvctl update` substitui a
aplicação, mas preserva indefinidamente `/opt/systv/node`. Assim, correções de
segurança do runtime não chegam por esse mecanismo nem pelo gerenciador APT.
Não foi inspecionada a versão do Node de nenhum servidor de produção.

Correção: incluir manutenção do runtime, com versão validada, teste de saúde e
recuperação, ou documentar e fornecer uma rotina própria de atualização.

### 7. Moderada, operacional: primeira instalação não pode ser retomada após falha parcial

Referências: `deploy/debian/install.sh:58–64,93–104,122–158`.

Uma falha depois de criar `/opt/systv`, usuário ou banco deixa o estado parcial.
O tratamento de erro recupera apenas atualizações com release anterior; uma nova
execução em modo instalação recusa os caminhos existentes, e `--update` exige
`current` e ambiente já válidos. Isso pode exigir intervenção manual, inclusive
quando a falha é temporária de download ou instalação de dependências.

Correção: registrar etapas e permitir retomada verificada, preservando dados;
testar falhas em npm, migração e configuração web. Não remover automaticamente
banco ou arquivos preexistentes sem comprovar sua origem.

## Riscos dependentes da implantação e melhorias

- HTTP é aceito explicitamente e resulta em cookie sem `Secure`. Nesse modo,
  senhas, sessão e tokens trafegam sem proteção de transporte. Preferir HTTPS
  também na rede interna, com confiança do certificado configurada nas TVs.
- Catálogo completo, telas e eventos são públicos. Isso pode ser adequado à TV,
  mas a exposição à internet deve ser uma decisão explícita.
- SSE não tem cota de clientes na aplicação e o proxy gerado não contém
  `limit_conn`/`limit_req`. Existem limites de recursos da infraestrutura, porém
  falta controle específico para reduzir abuso de conexões e consultas públicas.
- Snapshots `web-*.tar.gz` não entram na retenção dos backups agendados e podem
  crescer com manutenções sucessivas.
- Não há Content-Security-Policy nem HSTS na configuração gerada. São melhorias
  de defesa em profundidade, sem XSS demonstrado por esta revisão.
- SHA-256 do pacote confere integridade frente ao manifesto baixado, mas não
  protege contra comprometimento da conta/release que fornece ambos. Considerar
  assinatura ou atestação verificada com confiança independente.

## Controles positivos encontrados

- Senhas com scrypt, sal aleatório e comparação de tempo constante.
- Sessões aleatórias com hash no banco, expiração, HttpOnly e SameSite=Strict.
- Consultas parametrizadas e revalidação de permissões nas escritas revisadas.
- Ativação com token aleatório, hash no banco, expiração e consumo transacional.
- Credenciais SMTP cifradas com AES-256-GCM; ausência de senha padrão em produção.
- Upload restrito a imagens, limite de tamanho/pixels e recodificação para PNG.
- Serviço sem root, restrições systemd, código final pertencente a root e
  configuração fora da release com acesso restrito.
- Bootstrap com HTTPS, checksum e validação de caminhos/tipos do tar.
- Backup antes de migração de atualização, troca de symlink e tentativa de
  recuperação do código anterior. Rollback não desfaz migrações, como documentado.

## Validação executada

- `ddev test`: **28 testes aprovados**, MariaDB real, incluindo ativação,
  autorização por TV, sessões, logos, SMTP, recuperação e 2FA.
- `npm run check`: aprovado.
- `python3 tests/release.test.py`: **2 testes aprovados**, reprodução do pacote,
  exclusão de dados locais e rejeição de chave privada no diretório de runtime.
- `bash -n` no bootstrap, instalador, configuração web, funções web e systvctl:
  aprovado. ShellCheck não foi executado nesta revisão.
- Auditoria npm online: **1 dependência moderada, 3 avisos**; nenhuma alta ou
  crítica reportada pelo registro nessa consulta.
- Provas isoladas, sem escrita em produção: cota de login e presença fictícia.

A primeira tentativa de testes no macOS falhou por binário sharp incompatível e
restrição de abertura de porta. A execução posterior no DDEV passou integralmente.
Não foi executada uma instalação completa em Debian 13 descartável nesta revisão;
os testes desse fluxo existem na CI, mas seus resultados remotos não foram
consultados. Não foram inspecionados servidor de produção, firewall, certificados
dos clientes, restauração real de backup ou histórico completo de segredos.
Validação visual não realizada; não houve alterações de interface.
