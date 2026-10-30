# Verificação de layout — 2026-10-20

## Correção revisada

O seletor de TVs herdava `flex-direction: column` da regra comum de `label`.
O componente `.screen-option` agora define explicitamente a direção horizontal,
mantendo ícone, conteúdo e indicador de seleção na mesma linha.

## Validação visual

Prévia fictícia aberta no Chrome conectado: produtos em desktop de 1200 px
(tema escuro), tablet de 768 px (claro) e celular de 390 px (claro e escuro).
Cartões selecionados e não selecionados, inclusive nome longo, conferidos.
No desktop, a altura dos cartões passou de 213,5 para 129,5 px, sem excesso
horizontal do documento. A lista de usuários foi vista no desktop escuro.

Esta verificação cobre a correção do seletor. Ainda não representa aprovação
visual completa de todas as páginas, diálogos e estados da versão 2.5.0.

## Validação funcional

- `npm run check`: passou.
- `ddev test`: 28 testes passaram, nenhum falhou.
- `git diff --check`: passou.

## Entrega

A versão 2.5.0 ainda não foi publicada nesta revisão. As mudanças locais não
alteram a instalação 2.4.4 do servidor.


## Exclusão de produtos — 2026-10-30

Alteração: o editor de um produto existente mostra Excluir produto abaixo de
Salvar e atualizar TV, reutilizando os controles e estados de perigo existentes.
O cadastro de novo produto mantém a ação oculta. Nenhum CSS foi alterado.

Validação funcional: `npm run check`, 33 testes de integração em banco temporário
via `ddev test`, dois testes de empacotamento e `git diff --check` passaram.
A API existente continua verificando a permissão sobre a TV na exclusão.
No Safari, a confirmação identificou o produto e a TV; foi cancelada sem remover
produtos. A exclusão completa pelo novo botão não foi executada no banco real.

Validação visual: prévia fictícia no Safari, tema escuro, desktop de 1728 px e
celular de 390 px. O botão ficou legível e acessível sob Salvar; o indicador da
prévia mostrou excesso horizontal de 0 px nas duas larguras. A conferência de
tablet e tema claro não foi concluída por falha do serviço de captura da UI.


## Ordenação única — 2026-10-30

Validação funcional: testes em banco temporário cobrem inserção em posição
ocupada, movimento para cima e para baixo, edição sem mudança de posição,
transferência entre TVs, exclusão, duas inserções simultâneas e bloqueio direto
de duplicidade pelo banco. A migração foi exercitada com números repetidos e
posição no limite de inteiro, mantendo a sequência anterior dos produtos.

Validação visual: no Safari, a prévia fictícia de 390 px mostrou o novo aviso
sobre deslocamento e o editor, sem excesso horizontal. Não foi executada
reordenação de produtos no servidor real. CSS e componentes compartilhados não
foram alterados; as demais larguras e o tema claro não foram reconferidos nesta
etapa. A prévia visual não substitui os testes de persistência da API.


## Reordenação com mouse — 2026-10-30

Validação funcional: 36 testes de integração passaram. A rota dedicada à posição
foi testada com usuário sem sessão, operador sem permissão, posição inválida,
TV divergente e tentativa de enviar nome/preço junto da ordem. A movimentação
não alterou esses campos. A sequência continua protegida pelo índice único.

Na prévia fictícia do Safari, o botão Descer salvou em memória e o produto passou
da posição 0 para 1 com mensagem de confirmação. Nenhum produto real foi movido.
A tentativa de validar o gesto de arraste falhou duas vezes no controle nativo
com `noWindowsAvailable`, inclusive após retomar a janela. O atalho Alt+seta não
teve movimentação confirmada nessa sessão. Esses dois fluxos permanecem para
validação manual no navegador. A API e a validação visual não os substituem.

Validação visual: desktop de 1728 px, tema escuro, instrução de arraste e botões
do editor exibidos, sem excesso horizontal. Os rótulos foram abreviados para
Subir/Descer após a conferência para evitar quebra em duas linhas, preservando
nomes acessíveis completos. A versão final desses rótulos, tema claro e larguras
de tablet/celular não foram reconferidos. A sintaxe CSS passou no tinycss2.


## Links de exibição automáticos — 2026-10-30

Validação funcional: teste em MariaDB temporário registrou 30 dispositivos sem
sessão administrativa, confirmou presença de todos e verificou estabilidade da
assinatura após reiniciar a aplicação. Cobertos link incorreto, uso em outra TV,
permissões de operador, renovação isolada, revogação e impossibilidade de usar a
credencial do dispositivo como sessão administrativa. Testes do cliente cobrem
reabertura, queda de rede, expiração, URL sem assinatura, compatibilidade legada,
prévia sem armazenamento/presença, fechamento de abas e rajadas de eventos.

Validação visual no Safari com dados fictícios: diálogo Configurar TV em desktop
1685 px/tema escuro e celular 390 px/tema claro, com endereço somente para leitura
e ação de renovação legíveis. O endereço completo permaneceu dentro do input.
A exibição por link fictício carregou produtos e preços sem login e sem aviso
de monitoramento. A prévia administrativa foi exercitada separadamente. Depois
da conferência, o aviso foi movido para o componente compartilhado de conexão e
a identificação de prévia passou para o marcador da TV, preservando o rodapé.
Esses dois ajustes finais não foram reconferidos visualmente, nem tablet.
Não foram renovadas credenciais ou alteradas TVs reais; copiar para a área de
transferência e a confirmação de renovação não foram executados nessa sessão.
CSS não foi alterado na implementação final.

## Painel compacto — 2026-10-30

Validação visual no Safari, com dados fictícios e 30 TVs, sem alterar o servidor:

- Notebook 1366 × 768: catálogo começa em y=344 px. O formulário termina em
  y=700 px no cadastro e y=752 px na edição, incluindo salvar, excluir e setas
  de ordenação. Controles visíveis na altura inicial, sem rolagem horizontal.
- Conferidos temas claro e escuro; tablet de 768 px e celular de 390 px, com
  quebra natural das barras de ações e rolagem vertical para conteúdo longo.
  Excesso horizontal medido de 0 px, inclusive na lista de produtos.
- Conferidos seleção de 30 TVs, catálogo vazio, prévia e lista, editor, configuração
  da TV, unidades, identidade, usuários com textos longos, e-mails e login.
- Diálogos e catálogos extensos continuam permitindo rolagem vertical. Não foi
  feito teste em Edge/Chrome nem em dispositivos físicos nesta revisão.

Validação funcional, separada da visual:

- Troca de TV limpa a edição e atualiza produtos, contadores e status. Seleção
  de TV vazia e alternância prévia/lista verificadas no navegador.
- Abertura do editor e botão Descer verificados na prévia: posição 1 passou a 2,
  com confirmação de salvamento. A alteração existe somente na memória da fixture.
- `npm run check`, 45 testes via `ddev test`, dois testes de release e parser CSS
  aprovados. Não foi repetido o teste de arraste nesta revisão de layout.
- Produção e GitHub não foram atualizados nesta etapa.

## Status de todas as TVs — 2026-10-30 (local)

Validação visual concluída no Chrome, com a prévia fictícia:

- Quatro TVs em 1366 × 768: nomes, estados e totais visíveis sem abrir o seletor.
  Trinta TVs também conferidas, distribuídas em linhas compactas sem ocultação.
- Conferidos temas claro e escuro, tablet de 768 px e celular de 390 px; nomes
  longos quebram linha. Excesso horizontal medido de 0 px nas três larguras.
- A relação de status usa espaço adicional: com quatro TVs, o catálogo começa
  em y=432 px no notebook. Não se promete mais que todo o editor caiba sem rolagem.
- Evidência visual local: `/private/tmp/systv-status-tvs.png` (dados fictícios).

Validação funcional, separada da visual:

- Clicar na etiqueta da TV offline altera o catálogo e a seleção, preservando
  todos os indicadores visíveis. Catálogo vazio exibido corretamente.
- Interrompido apenas o servidor da prévia local: os quatro estados mudaram para
  “Sem confirmação” e o resumo passou a 0 online, 0 offline, 4 sem confirmação.
  Ao restaurar a prévia, voltaram automaticamente a 1 online e 3 offline, sem
  recarregar a página. Não foram desligadas TVs nem serviços de produção.
- `npm run check`, 45 testes via `ddev test`, dois testes de release, parser CSS
  e `git diff --check` aprovados na implementação. Nenhuma alteração de código
  adicional foi necessária após a conferência no Chrome.
- A conexão do Chrome, inicialmente indisponível, foi restabelecida após o usuário
  habilitá-la. Conferência visual concluída; bloqueio anterior resolvido.
- GitHub e produção continuam na versão 2.7.4 publicada anteriormente.

## Seis novas paletas de TV — 2026-10-30 (local)

- Acrescentadas Noturno, Bordô, Café, Gelo, Sálvia e Pêssego, preservando as seis
  opções anteriores. Seleção, prévia administrativa e TV usam o mesmo módulo.
- Referência: WCAG 2.2 SC 1.4.6, contraste reforçado. O teste calcula luminância
  relativa sRGB e exige ao menos 7:1 para texto/fundo, texto/linha, oferta/linha,
  rodapé/fundo e texto branco/marcador das novas paletas. Não é uma declaração
  de conformidade AAA do sistema inteiro.
- Validação funcional: 46 testes via `ddev test`, incluindo contraste e gravação/
  leitura das doze opções na API, além de `npm run check` e dois testes de release,
  aprovados. Não houve mudança no CSS nesta etapa.
- Validação visual pendente: a conexão do Chrome estava indisponível e o controle
  nativo falhou duas vezes ao iniciar. Não foram validadas aparência, navegação
  por teclado nem distribuição das doze opções em desktop/celular nesta revisão.
- A fixture permite trocar a paleta em memória para conferir prévia e TV sem
  tocar no banco real. Reiniciar descarta a escolha; demais gravações bloqueadas,
  exceto a reordenação já existente.
- Alterações locais: GitHub e produção permanecem em 2.7.5.

## Destaque de ofertas nas doze paletas — 2026-10-30 (local)

- Revisão da implementação: a TV aplica `highlighted` ao artigo inteiro; a prévia
  do catálogo aplica a mesma classe ao produto; a configuração usa a cor de oferta
  na amostra e a cor regular na linha `preview-normal`. Todas usam `accent` da
  paleta escolhida, distinguindo nomes, preços e unidades das ofertas.
- Teste com MariaDB: em cada uma das doze paletas, salvar produto com destaque
  ativado e desativado preserva a paleta e retorna o estado correto (1/0) na API.
- Teste de contraste ampliado para todas as paletas: texto regular, ofertas,
  rodapé e marcador atendem ao mínimo AA de 4,5:1. Ofertas sobre a linha variam
  de 6,88:1 (Marfim) a 13,96:1 (Café); as seis novas continuam atendendo a 7:1.
- Resultado final: 47 testes aprovados via `ddev test`, incluindo os dois testes
  de paletas; sintaxe, testes de release e `git diff --check` aprovados.
- Conferência visual permanece pendente: Chrome indisponível no conector e falha
  ao iniciar o controle nativo. Nenhuma aparência foi declarada validada com base
  somente na revisão de código ou nos testes de API.
- Alterações continuam locais, sem publicação ou mudança na produção.

## Balanceamento automático de páginas — 2026-10-30 (local)

Validação funcional:

- Módulo compartilhado por TV, prévia, abas, busca e indicação de página no editor.
  Mantém a ordem, a quantidade mínima de páginas e diferença máxima de um produto
  entre páginas. Capacidade de 34 produtos em duas colunas e 17 em uma coluna.
- Casos explícitos: 35 → 18/17; 36 → 18/18; 69 → 23/23/23; 70 → 24/23/23;
  em uma coluna, 18 → 9/9 e 35 → 12/12/11.
- Testados totais de 0 a 300 nas duas capacidades: sem perda, duplicação ou troca
  de ordem; identificação de página coerente e recálculo nas fronteiras de inclusão
  e exclusão. Não foi alterada a ordenação persistida dos produtos.
- 50 testes via `ddev test`, `npm run check`, dois testes de release e
  `git diff --check` aprovados. Verificada entrega HTTP do novo módulo e inclusão
  no pacote de produção.

Validação visual:

- Pendente: tentativa de controle do Chrome falhou ao iniciar. Não foram conferidos
  visualmente troca de página, arraste, pesquisa ou layout após o balanceamento.
- Fixture aceita `SYSTV_LAYOUT_PRODUCTS=35` (até 300) para reproduzir catálogos
  maiores sem modificar dados reais. Nenhuma atualização de GitHub ou produção.

### Revisão do limite: 16 linhas por coluna

- Limite compartilhado `TV_MAX_ROWS=16`; capacidade horizontal de 32 produtos,
  vertical de 16. Substitui o limite de 17 linhas/34 produtos da revisão anterior.
- TV, painel, fronteiras de páginas e fallback CSS atualizados. O balanceamento
  preserva a ordem; 33 produtos horizontais ficam em 17/16 produtos (até 9 linhas
  por coluna), 64 em 32/32 e 65 em 22/22/21.
- Testes de 0 a 300 produtos conferem explicitamente que nenhuma página ultrapassa
  16 linhas por coluna. 50 testes via `ddev test`, sintaxe, dois testes de release,
  parser CSS e diff aprovados.
- Validação visual continua pendente pela indisponibilidade já registrada do
  controle do navegador. Alteração local, sem atualização do GitHub ou produção.

## Implantação local no servidor 192.168.160.18 — 2026-10-30

- Pacote 2.7.7 gerado diretamente do workspace e transferido por SSH, sem commit,
  tag, push ou publicação no GitHub. SHA-256 do pacote:
  `068416211529cdde023e8750d0a5a82795f5b789bf457565c38e3b6c4e2a88eb`.
- Aplicado pelo instalador em modo `--update`, executado por uma unidade temporária
  do systemd. Backup: `/var/backups/systv/20261030T193506Z-3513`.
- Release ativa: `/opt/systv/releases/v2.7.7-20261030T193502Z-3401`.
  Anterior preservada: `/opt/systv/releases/v2.7.6-20261030T190834Z-2807`.
- `systvctl doctor` aprovado: SYSTV, nginx, MariaDB e timer de backup ativos;
  nginx válido; saúde local e HTTPS com certificado verificado respondendo.
- HTTP 200 no painel, TV em modo prévia e scripts. Novo módulo entregue por HTTPS
  confirma `TV_MAX_ROWS=16` e capacidade horizontal de 32 produtos.
- Comparação antes/depois preservou os 60 produtos (incluindo preço, ordem e
  destaque), 5 TVs e 2 usuários; sem entradas de erro do SYSTV após a atualização.
- Isso é validação funcional da implantação, não validação visual. Navegadores
  que já estavam abertos precisam recarregar para receber o novo JavaScript.

### Aprovação para publicação da 2.7.7

O usuário aprovou o resultado no servidor (“ficou legal”) e autorizou versionar
esta mesma versão no GitHub. Isso registra a aprovação em uso real, sem ampliar
as verificações automatizadas ou declarar testes visuais em outras resoluções.
