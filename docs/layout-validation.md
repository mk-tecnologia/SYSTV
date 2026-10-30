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
