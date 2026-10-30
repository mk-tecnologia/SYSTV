# Diretriz de layout do SYSTV

Esta é a referência para todas as alterações de interface. A implementação fica em
`public/style.css`. Não criar uma aparência própria para cada página nem acrescentar
correções no fim do arquivo: alterar o componente compartilhado e revisar seus usos.

## Identidade e estrutura

- Administração, login, recuperação, 2FA e ativação compartilham fonte, cores,
  campos, botões, bordas e mensagens. Fontes do sistema, sem depender de internet.
- Produtos, unidades, identidade, usuários e e-mails usam o mesmo eixo de conteúdo:
  máximo de 1440 px e margens laterais de 32 px; 24 px em tablet e 16 px em celular.
- Cada página tem um título principal, descrição e conteúdo. Cabeçalhos de painéis
  explicam a seção, sem repetir desnecessariamente o título da página.
- Espaço entre seções: 16 px. Rodapé compacto, separado por 16 px.
- A versão pertence à identidade do produto no cabeçalho. Tema, perfil e saída
  formam o grupo da conta. A navegação usa o mesmo alinhamento do conteúdo.

## Medidas compartilhadas

| Elemento | Padrão |
| --- | --- |
| Escala de espaçamento | 4, 8, 12, 16, 24, 32 e 48 px |
| Painéis e diálogos | Borda de 1 px, raio de 12 px |
| Preenchimento de painéis e diálogos | 16 px |
| Inputs, selects, botões, seletores e caixas internas | Raio de 8 px |
| Elementos internos de controles segmentados | Raio de 4 px, ajustado ao contorno externo |
| Marcadores e linhas da prévia | Raio de 6 px |
| Altura de controles | Mínimo de 40 px; 44 px no celular |
| Ações compactas em tabelas | 32 × 32 px; 40 × 40 px no celular |
| Ícones de interface | 18 × 18 px; 22 px em marcas de seção |
| Título da página | 24 px |
| Título de painel/diálogo | 18 px |
| Título de acesso (login/ativação) | 22 px |
| Texto/campo | 14 px; tabelas e botões 13 px |
| Rótulos, ajuda e metadados | 12 px; pequenos marcadores 10–11 px |
| Distância entre campos | 16 px; 12 px no editor de produtos |
| Distância entre rótulo e campo | 8 px |

Exceções têm função, não dependem da página: indicadores de presença são círculos;
logos preservam a proporção; a TV e suas prévias usam dimensões de exibição.

## Superfícies, cores e estados

Usar as variáveis semânticas de `:root`. O tema escuro substitui os valores das
mesmas variáveis, sem criar regras particulares para cada tela.

- `--bg`: fundo da aplicação; `--surface`: painel, diálogo e controle.
- `--surface-soft`: agrupamentos e cabeçalhos; `--surface-hover`: interação.
- `--line` e `--line-strong`: contornos de painéis e controles, ambos com 1 px.
- `--text` e `--muted`: texto principal e secundário.
- `--accent*`: ação, seleção e foco. Seleção não pode mudar o tamanho do componente.
- `--positive*`, `--negative*`, `--warning*`, `--info*`: estados com significado.
- Painéis não têm sombra decorativa. Diálogos usam uma única sombra de elevação.
- Botões secundários têm o mesmo contorno em qualquer página. Hover, foco,
  seleção e desabilitado precisam continuar legíveis nos dois temas.
- Nunca remover o indicador de foco. Não depender só de cor para comunicar estado.

## Formulários e diálogos

Formulários usam uma grade com 16 px entre os campos; o editor de produtos usa 12 px para manter as ações próximas do cadastro. Evitar combinar margens
individuais nos rótulos com espaçamento no formulário. Textos auxiliares ficam
junto do campo. Usar `.form-row` para campos relacionados; a grade se reorganiza
sem forçar largura mínima.

Diálogos compartilham raio, cabeçalho e preenchimento. Somente a largura varia:
480 px para unidade, 640 px para usuário e 880 px para configuração de TV. A altura
é limitada ao visor; rolagem vertical é permitida quando necessária. O diálogo de
TV distribui o preenchimento entre cabeçalho, corpo e ações, sem duplicá-lo.

Login, recuperação de senha, confirmação de 2FA e ativação usam o mesmo painel de
acesso e os mesmos controles. Não acrescentar gradientes, raios ou sombras próprios.

## Densidade do painel administrativo

- Priorizar seleção de TV, cadastro e catálogo antes de textos explicativos.
- A seleção usa um select nativo, com status nas opções e indicador da TV selecionada.
  O número de TVs não aumenta a altura da página; conferir também com 30 TVs.
- Indicadores ficam em uma linha flexível, sem cartões individuais. Cabeçalho e
  descrição da página podem compartilhar a linha e quebram naturalmente no celular.
- Preço, unidade e ordem compartilham uma linha; mover produtos fica no cabeçalho
  do editor, com nomes acessíveis e dicas nos botões de seta.
- Ajuda detalhada fica em um disclosure nativo, acessível por teclado. Excluir TV
  pertence à configuração da TV; excluir produto permanece no editor.
- Em 1366 × 768, manter formulário e primeiras linhas do catálogo visíveis sem
  rolagem inicial. Catálogos longos continuam usando a rolagem normal da página.
  Não reduzir fontes de campos nem criar barras internas para forçar tudo a caber.

## Listas e responsividade

- Não deve haver rolagem horizontal da página nem de tabelas administrativas.
- Tabelas usam preenchimento de 12 px e colunas proporcionais, nunca `min-width`
  para forçar espaço. Textos longos quebram linha sem cortar dados.
- Quando o painel tiver até 700 px, cada linha se reorganiza em campos identificados.
  Produtos, unidades e usuários usam a mesma transformação, inclusive quando a
  tabela está ao lado do editor. A referência é a largura do painel, não só a janela.
- Cada célula renderizada tem `data-label`; manter os papéis e cabeçalhos acessíveis.
- A ordenação de produtos oferece arraste na prévia e na lista, com estados de
  origem e destino baseados nos tokens semânticos. Manter alternativas por
  teclado e pelos botões Subir/Descer do editor, sem depender do arraste em telas
  de toque. A ordem é salva automaticamente, sem alterar os demais campos.
- Ações usam `.row-actions` com botões de ícone e nome acessível/dica. Podem quebrar
  linha. Nunca esconder a ação ou deixar um botão invadir a coluna vizinha.
- Não usar `overflow-x: hidden` no documento para disfarçar elementos largos.
- Reservar o espaço da barra de rolagem vertical para não deslocar o layout ao
  alternar páginas. Rolagem vertical é normal para conteúdo maior que a tela.

## TVs e prévias

A exibição de preços tem uma finalidade diferente da administração. A grade e as
fontes se ajustam ao visor para manter os preços completos e legíveis. Preservar
as variáveis `--tv-*`, `--preview-*`, `--price-font`, `--name-font`, `--rows` e
`--columns`. As seis paletas devem ser refletidas na prévia e no painel real.
O botão Copiar link da TV entrega o endereço para exibição e monitoramento
sem login no aparelho. Prévia da TV não altera a presença. A configuração oferece
o endereço somente para leitura e renovação explícita com confirmação. Não
introduzir pareamento por códigos ou login obrigatório em cada tela.
Usar os mesmos raios de componentes pequenos e a mesma família de estados no
aviso de conexão. Alertas participam do layout e não cobrem produtos.

## Revisão e verificação

Ao alterar um componente, conferir todos os seus usos, e não só a página da tarefa.
Revisar desktop, tablet e celular; tema claro e escuro; nomes/e-mails longos,
listas vazias, muitas linhas, estados desabilitados, seleção e foco por teclado.

A prévia é reproduzível sem tocar no banco real:

```sh
node tests/fixtures/layout-preview.js
```

- Desktop: `http://127.0.0.1:4178/preview/admin`
- Notebook (1366 × 768): `http://127.0.0.1:4178/preview/laptop`
- Tablet (768 px): `http://127.0.0.1:4178/preview/tablet`
- Celular (390 px): `http://127.0.0.1:4178/preview/mobile`
- Login: `http://127.0.0.1:4178/preview/login`
- Ativação: `/activate#token=` seguido de 64 zeros (somente na prévia fictícia).
- TV: `/tv?screen=tv01`; tablet/celular aceitam `?page=tv` ou `?page=activate`.

A marca da prévia mostra a largura e o excesso horizontal medido pelo navegador.
Ela só existe no servidor de testes. Esse servidor escuta apenas em `127.0.0.1`,
não usa credenciais, não grava alterações em disco e não faz parte do pacote de produção.

Executar `npm run check`, `ddev test` e `python3 tests/release.test.py`. Validar a
sintaxe CSS com um parser. Testes de API e sintaxe não substituem conferência
visual: registrar separadamente o que foi visto no navegador e o que ficou bloqueado.

A reordenação da prévia fictícia pode ser exercitada em memória e é descartada
ao reiniciar o servidor de testes. As demais alterações continuam bloqueadas.
