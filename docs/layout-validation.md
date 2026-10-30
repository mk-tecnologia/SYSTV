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
