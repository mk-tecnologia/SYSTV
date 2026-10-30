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
