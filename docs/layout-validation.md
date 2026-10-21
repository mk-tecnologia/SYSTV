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
