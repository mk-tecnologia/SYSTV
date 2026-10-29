# Correções de segurança — versão 2.6.0

Correções preparadas e validadas em 29/10/2026, sobre a versão 2.5.0, para a
versão 2.6.0. A publicação no GitHub não implanta a atualização em produção. O relatório
[original](security-audit-2026-10-29.md) registra o estado anterior às correções.

## Implementação

| Achado | Correção |
| --- | --- |
| Release gravável pelo UID da aplicação durante build | Código e ferramentas permanecem de root. Dependências são preparadas por `systv-build`, com UID/grupo separados, sandbox systemd e encerramento dos descendentes antes da cópia. |
| Nodemailer vulnerável | Atualizado para 10.3.1, com lockfile; auditoria npm também adicionada à CI. |
| Cota compartilhada atrás do proxy | IP aceito somente de proxy em loopback com opt-in. Nginx sobrescreve `X-Real-IP`; há limites por IP, conta e escopo global, com memória limitada. |
| Presença anônima de TV | Credencial aleatória vinculada ao dispositivo e à TV, hash no banco, autorização por conta com permissão, expiração, revogação, limite de 100 registros por TV e de taxa por credencial. Presenças legadas sem credencial não contam. |
| Troca de e-mail com sessão roubada | Perfil exige senha atual também para mudar/remover o e-mail, preserva e-mail omitido e rejeita alterações concorrentes sem reautenticação. A interface informa a nova exigência. |
| Runtime sem atualização | Node.js 24 obtido e verificado também nas atualizações, armazenado por release. Rollback inclui runtime e preserva compatibilidade com instalações legadas. |
| Instalação inicial interrompida | Estado privado e credenciais são publicados juntos; `--resume` reaproveita parâmetros e segredos. Erros na atualização recuperam código/runtime e aguardam saúde antes de terminar. |
| Abuso de conexões e consultas | Limites na API e no Nginx; cotas de SSE por cliente e global, com liberação correta ao desconectar. |
| Transporte e cabeçalhos | Produção exige origem canônica, HTTPS na rede e cookie Secure. CSP, HSTS e Referrer-Policy adicionados. HTTP restrito a origens em loopback para testes. |
| Snapshots web sem retenção | Backup agendado também remove snapshots web com mais de 14 dias, após backup bem-sucedido. |

A aplicação continua servindo o catálogo publicamente para as TVs. Credenciais de
presença não autorizam administração. Alterar o e-mail exige senha; confirmação
separada de posse do endereço não foi acrescentada nesta alteração. Assinatura de
releases com uma raiz de confiança independente também permanece uma melhoria
possível: os downloads continuam confiando nos fornecedores HTTPS e no checksum.

## Validação funcional executada

- **33 testes aprovados** no DDEV com MariaDB, incluindo regressões de IP
  encaminhado, isolamento das cotas, limites de SSE, HTTPS, troca de e-mail,
  credenciais de TV, isolamento entre telas, expiração, revogação e quota.
- Auditoria npm online: **zero vulnerabilidades conhecidas** reportadas para
  as dependências de produção na consulta desta revisão.
- `npm run check`, `bash -n`, ShellCheck 0.10.0 e `git diff --check`: aprovados.
- Dois testes de empacotamento aprovados: pacote reproduzível, dados locais
  excluídos e rejeição de arquivos privados na árvore de runtime.
- Debian 13 arm64 descartável, com systemd/MariaDB/Nginx reais: instalação HTTP
  em loopback e HTTPS local, ativação, backup, atualização, rollback e reinício.
- Certificado local e de CA de teste: validação de nome/chave, preservação das
  credenciais, rejeição de certificado incompatível e restauração após erro Nginx.
- Falha real de npm provocada com lockfile inválido: retomada concluída sem
  trocar valores do ambiente ou gerar novas senhas/chaves.
- Falha real de SQL durante atualização: código/runtime anteriores restaurados
  e saúde confirmada antes do retorno.
- Simulação de runtime global legado: atualização e rollback aprovados.
- Nginx real: cabeçalho `X-Real-IP` enviado pelo cliente não burla a cota;
  esgotar um IP não bloqueia outro. Permissões de escrita e isolamento da
  configuração privada entre serviço e build conferidos.

Os erros deliberados de npm, SQL e Nginx fazem parte dos testes de recuperação.
Não são falhas remanescentes no resultado final. Os testes Debian locais foram executados
em arm64; a matriz amd64 também está definida na CI do GitHub.
Não foram testados Let's Encrypt com domínio público, reboot completo do host ou
restauração de um backup em outro servidor.

## Validação visual

Concluída no Safari após autorização do responsável, em aba separada e com
prévia fictícia. O escopo conferido foi:

| Tela | Evidência visual e interação |
| --- | --- |
| Perfil em desktop (1728 px), claro e escuro | Campos, ajuda da senha atual, botões e foco legíveis; sem cortes horizontais. |
| Perfil em celular (390 px), claro | Texto auxiliar quebra corretamente, campos cabem e botão Salvar permanece acessível. Indicador da prévia: excesso horizontal 0 px. |
| Perfil em tablet (768 px), escuro | Diálogo e controles preservados. Indicador da prévia: excesso horizontal 0 px. |
| Troca de e-mail fictício sem senha | Safari impede o envio, foca Senha atual e mostra “Preencha este campo”. Nenhum e-mail foi alterado. |
| TV em desktop | Conferidas a prévia fictícia e a TV real do DDEV; produtos, preços e rodapé carregam sem cortes observados. |
| Aplicação real em HTTPS no DDEV | Login e tela de recuperação carregam; nenhum link de recuperação foi enviado. |

Foi encontrado um Bad Gateway no DDEV: o processo Node em modo watch havia
parado durante a reinstalação de dependências. O serviço
`webextradaemons:systv` foi reiniciado e seu retorno foi confirmado no Safari.
Isso não alterou configuração ou dados de produção. Também foi corrigido o
charset do HTML da prévia de celular/tablet, cujo título aparecia com acentos
incorretos; essa prévia não entra no pacote de produção.

A prévia usa APIs fictícias: seus indicadores de presença não substituem os
testes funcionais de credenciais das TVs. Não foi feito login com credenciais
reais nem alterados usuários, senhas ou produtos pelo navegador. Testes em
aparelhos físicos e a validação de confiança dos certificados em cada TV
continuam sendo verificações da implantação.

## Roteiro para teste manual antes da publicação

Use o DDEV local em `https://systv.ddev.site`. A migração aditiva de credenciais
foi aplicada nesse ambiente, preservando usuários e catálogos. A versão preparada para publicação é
2.6.0. A implantação no servidor continua sendo uma operação separada.

1. Entre como administrador e operador; confira as permissões de cada TV.
2. No próprio perfil, altere somente o nome. Depois tente trocar o e-mail sem
   senha e com senha correta; confira que a primeira tentativa é recusada.
3. Teste recuperação e 2FA com um SMTP de teste. Confira também envio de logos,
   atualização de produtos e reconexão das TVs.
4. No navegador de cada TV, entre no painel com uma conta autorizada e abra a
   exibição. Saia da administração e recarregue a TV; a presença deve continuar
   online. Navegadores sem autorização podem exibir preços, mas não contam como
   dispositivos online. A credencial expira após 90 dias de inatividade.
5. Confira o formulário de perfil em desktop/celular e nos dois temas.

Para produção, instalações antigas em HTTP precisarão de HTTPS e da confiança
do certificado nos clientes antes da atualização. Consulte o
[procedimento Debian](debian-13.md). A implantação em produção depende da
aprovação posterior do responsável e não é feita automaticamente pela publicação.
