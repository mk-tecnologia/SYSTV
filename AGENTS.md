# Diretrizes do projeto

## Interface e layout

Antes de alterar HTML, CSS ou componentes de interface, leia [docs/layout.md](docs/layout.md).
Essa é a referência comum para administração, acesso, diálogos, TVs e prévias.

- Reutilize os tokens e os componentes de `public/style.css`.
- Corrija a definição do componente, sem empilhar sobrescritas específicas no fim do CSS.
- Revise todos os usos de um componente quando alterar medida, borda, cor ou estado.
- Preserve a ausência de rolagem horizontal e a acessibilidade das ações e tabelas.
- Registre a validação funcional e visual separadamente; não declare aparência validada
  com base apenas em testes de API ou sintaxe.
- Mudanças intencionais no padrão devem atualizar a diretriz junto com a implementação.
