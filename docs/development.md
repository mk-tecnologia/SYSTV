# SYSTV

Painel de preços para múltiplas TVs, com administração protegida por usuário e senha e atualizações por Server-Sent Events (SSE). Backend em Node.js 24, banco MariaDB 11.8 e ambiente de desenvolvimento DDEV.

## Instalação no Debian 13

O [guia de instalação](debian-13.md) inclui o instalador automático com Node.js 24, MariaDB, Nginx, systemd e HTTPS opcional.

## Desenvolvimento com DDEV

A configuração DDEV pertence somente ao ambiente local e não é distribuída
no repositório de produção. Os comandos abaixo são referência para o ambiente
local já configurado.

Pré-requisitos: Docker em execução e DDEV 1.24.3 ou superior.

```sh
# Apenas no primeiro checkout; este ambiente já possui .env configurado.
cp .env.example .env
# No .env local, ajuste NODE_ENV=development e defina ADMIN_PASSWORD.
ddev start
```

- Administração: https://systv.ddev.site
- TV inicial: https://systv.ddev.site/tv?screen=tv01
- Saúde da aplicação e do banco: https://systv.ddev.site/api/health

O DDEV configura a conexão com MariaDB usando `DB_HOST=db`, banco `db`, usuário `db` e senha `db`. Essas variáveis do container têm prioridade sobre o `.env`. No primeiro acesso, o sistema cria o administrador com `ADMIN_USERNAME` (padrão `admin`) e `ADMIN_PASSWORD` do `.env`, que não deve ser versionado. Consulte o `.env` local para as credenciais de desenvolvimento. Depois de criado, o usuário e sua senha são gerenciados pela área de usuários; alterar o `.env` não redefine contas existentes. Troque a senha para uso fora do desenvolvimento.

Na inicialização, o daemon instala as dependências quando o lockfile muda, aplica migrações pendentes, importa o SQLite antigo se existir e o MariaDB estiver vazio, e cria o catálogo de demonstração somente se o banco ainda não estiver inicializado. Os dados existentes são preservados. O processo Node.js roda sob Supervisor com `--watch`, reiniciando quando o backend muda. Alterações em `public/` aparecem após recarregar a página.

```sh
ddev stop                          # Para containers e mantém os dados
ddev restart                       # Reaplica a configuração do ambiente
ddev logs -s web --tail=100         # Logs da aplicação e inicialização
ddev exec supervisorctl restart webextradaemons:systv
ddev npm run db:migrate            # Aplica migrações pendentes
ddev test                          # Testes de integração no MariaDB real
ddev npm run check                 # Verificação de sintaxe
ddev mysql                         # Console do MariaDB
```

`ddev test` cria um banco temporário com nome aleatório, usa exclusivamente esse banco e o remove ao terminar. O catálogo do projeto não é alterado. Os testes verificam autenticação, proteção de origem, preços em centavos, caracteres Unicode, duas TVs recebendo o mesmo evento, persistência após reiniciar, catálogos independentes, exclusão em cascata e proteção contra excluir a última TV em requisições simultâneas.

## Organização

```text
.ddev/                  Ambiente, daemon e comandos DDEV
src/config.js           Configuração por variáveis de ambiente
src/database.js         Pool de conexões e transações
src/migrations.js       Execução e controle de migrações
src/repository.js       Consultas e regras de integridade do catálogo
src/auth.js             Autenticação e sessões persistentes
src/users.js            Usuários, perfis e permissões por TV
src/passwords.js        Hash e verificação de senhas com scrypt
src/logos.js            Validação, redimensionamento e armazenamento de logos
src/events.js           Conexões e atualização das TVs por SSE
src/app.js              Rotas HTTP e tratamento de erros
server.js               Inicialização e encerramento do servidor
public/                 Administração e painel de TV
scripts/                Migração, importação e verificação
database/migrations/   Schema versionado
database/demo.js       Catálogo inicial
tests/                 Testes de integração
```

O driver `mysql2` usa consultas parametrizadas e um pool de conexões. As tabelas usam InnoDB e UTF-8 completo (`utf8mb4`). Os preços são armazenados como centavos inteiros; não há arredondamento em campos de ponto flutuante. Produtos têm chave estrangeira para a TV e índice por TV, ordem e identificador. Escritas usam transações; a exclusão da última TV é protegida também contra concorrência.

As senhas dos usuários usam scrypt com salt aleatório e nunca são retornadas pela API. Sessões duram 12 horas e ficam no MariaDB, vinculadas ao usuário, com apenas o hash do token armazenado. Cookies são `HttpOnly`, `SameSite=Strict` e `Secure` no HTTPS do DDEV. Reiniciar o Node.js não encerra a sessão. Há limitação de tentativas de login por endereço no processo e limpeza periódica das sessões expiradas. Erros internos do banco não são expostos ao navegador.

## Usuários e permissões

Na área **Usuários e permissões**, administradores podem criar, editar, desativar e excluir usuários, redefinir senhas e escolher as TVs que cada operador pode alterar.

- **Administrador:** gerencia todas as TVs, usuários, nome da empresa e logos.
- **Operador:** cria, edita e exclui produtos somente nas TVs autorizadas. Não altera usuários, identidade nem cadastro de TVs.
- Um operador sem TVs selecionadas não pode alterar produtos. Novas TVs precisam ser autorizadas explicitamente.

As permissões são verificadas na API dentro da transação de escrita. Ao editar um produto, a autorização é exigida tanto na TV de origem quanto na de destino. O catálogo de exibição continua público para as TVs; permissões controlam edição.

Login tem de 3 a 64 caracteres (letras sem acentos, números, ponto, hífen ou sublinhado). Senhas têm de 8 a 128 caracteres. Ao editar um usuário, deixe a senha em branco para manter a atual. Alterações de usuário revogam suas sessões, e as permissões passam a valer imediatamente na API; a administração verifica a sessão periodicamente e ao recuperar foco. Não é permitido excluir, desativar ou rebaixar o próprio administrador, e deve existir pelo menos um administrador ativo.

A migração `002_users_and_branding.sql` revoga as sessões antigas, que não eram vinculadas a usuários. Entre novamente com o login `admin` e a senha configurada localmente; o catálogo e as TVs são preservados.

## Identidade da empresa e logos

Na área **Identidade da empresa**, altere o nome que aparece no centro do cabeçalho e a mensagem do rodapé. Envie separadamente a **logo da esquerda** e a **logo da direita**. As alterações são enviadas a todas as TVs por SSE.

O upload aceita PNG, JPEG e WebP estáticos de até 5 MB e 25 megapixels. O conteúdo real é validado e a imagem é convertida para PNG, com no máximo **640 × 320 pixels**, mantendo proporção, transparência e sem ampliar imagens pequenas. No painel, cada logo ocupa uma área de **14% da largura da tela × 10% da altura**, com `object-fit: contain`; uma imagem grande não altera a altura do cabeçalho nem invade os preços. Sem imagem, aparece um monograma com as iniciais da empresa.

As duas imagens são armazenadas no MariaDB, na tabela `logos`, e fazem parte do backup do banco. As URLs usam uma versão derivada do conteúdo para que a TV carregue a imagem nova após cada troca. Somente administradores podem enviar ou remover logos.

## Migrações e importação do projeto anterior

Crie novas migrações SQL com prefixo numérico em `database/migrations/`; não edite migrações já aplicadas. O executor registra versão, checksum e data, e usa um bloqueio no MariaDB para impedir duas execuções simultâneas. Como DDL no MariaDB faz commit implícito, escreva migrações recuperáveis e idempotentes quando houver várias instruções.

O SQLite em `data/prices.sqlite` e seus arquivos auxiliares são preservados. A importação mantém IDs, TVs, nomes, preços, unidades, ofertas, ordem e identidade do estabelecimento. Todas as inserções ocorrem em uma única transação no MariaDB. O sistema não usa SQLite após a migração; `node:sqlite` é carregado somente pelo importador.

Para importar manualmente em um MariaDB recém-criado, antes de executar o seed:

```sh
ddev npm run db:migrate
ddev npm run db:import-sqlite -- data/prices.sqlite
```

O importador recusa sobrescrever um banco já inicializado. Não apague o SQLite original até conferir a migração e ter um backup do MariaDB.

## Backup

```sh
mkdir -p backups
ddev export-db --file=backups/systv.sql.gz
```

Para restaurar um backup, `ddev import-db --file=backups/systv.sql.gz` substitui o banco local atual. Depois, reinicie o daemon para que o estado enviado às TVs seja recarregado. A pasta `backups/` não é versionada.

## TVs e comportamento do painel

Cada TV tem um nome de localização, um catálogo próprio e um link disponibilizado pelo administrador. Use nomes como “Balcão do açougue”, “Entrada da loja” ou “Setor de ofertas”. O botão **Configurar TV** ao lado da tela selecionada altera o nome nos cartões, nas permissões e no painel, preservando o link e os produtos. Nomes repetidos e nomes compostos apenas por “TV” e um número são recusados para evitar confusão. A tela inicial se chama “Balcão principal”; nomes personalizados existentes são preservados. Várias TVs físicas podem abrir o mesmo link para compartilhar produtos. Use o botão de tela cheia ou F11. O painel exibe até 32 produtos por página em duas colunas, alterna páginas no intervalo configurado para essa TV (padrão de 15 segundos) e destaca ofertas na cor da paleta escolhida. Em janelas com menos de 900 pixels de largura, usa uma coluna e até 16 produtos por página. Quando há várias páginas, os produtos são distribuídos de maneira equilibrada, sem mudar a ordem: 35 produtos em duas colunas ficam em 18 + 17; 69 ficam em 23 + 23 + 23. A diferença entre páginas é de no máximo um produto. A prévia, a busca e a indicação de página no editor usam a mesma divisão horizontal de 32 produtos de capacidade. Em uma coluna, o balanceamento respeita a capacidade de 16. Com poucos produtos, as linhas mantêm uma altura limitada e ficam alinhadas no topo, inclusive na última página; o espaço restante fica livre. O tamanho dos nomes, preços e unidades se ajusta à largura e à altura reais da linha, inclusive após carregar fontes, redimensionar a janela ou entrar em tela cheia, para evitar cortes.

Ao salvar no administrador, o servidor confirma a gravação no MariaDB e envia o catálogo atualizado às conexões SSE. Se a rede cair, a TV mantém o último catálogo e exibe um aviso visível acima dos produtos, com a hora dos últimos preços recebidos e uma contagem para a próxima tentativa. O aviso informa que os preços podem estar desatualizados e desaparece quando a sincronização em tempo real é restabelecida. A leitura do catálogo é pública; todas as edições exigem autenticação.

O domínio `systv.ddev.site` é destinado ao desenvolvimento no computador local. Para TVs físicas na rede, publique o servidor em um endereço acessível às TVs; o domínio local do DDEV não identifica automaticamente esse computador em outros dispositivos. A configuração não expõe serviços para toda a rede local por padrão.

### Perda de conexão e recuperação

A TV detecta erros de rede e verifica sinais de atividade do servidor. A API envia um evento de heartbeat a cada 20 segundos, após verificar a conexão com o MariaDB; se informar falha, a TV inicia a recuperação. Um watchdog verifica a conexão a cada 5 segundos e detecta canais sem atividade por mais de 45 segundos, mesmo quando o navegador não dispara um erro.

As tentativas automáticas usam espera crescente de 2, 4, 8, 16 e no máximo 30 segundos. Antes de reabrir a conexão em tempo real, a TV consulta `/api/state`, com timeout de 8 segundos, e recebe o catálogo atual. Se essa consulta funcionar e a conexão em tempo real continuar indisponível, o aviso muda para **Atualização periódica**; a TV continua buscando os preços nas tentativas seguintes, sem anunciar que está “ao vivo”.

O botão **Tentar novamente** antecipa a recuperação. O evento de retorno da rede do navegador também dispara uma tentativa imediata. Respostas de conexões antigas são ignoradas para impedir que dados atrasados substituam o catálogo novo. A troca de páginas continua funcionando com os últimos dados durante a perda de conexão.

O catálogo e sua data de recebimento são guardados no navegador quando o armazenamento local está disponível. Isso não substitui os arquivos da aplicação: para abrir a página do zero sem rede, HTML, JavaScript e CSS precisam estar disponíveis no navegador; não há service worker para instalação offline completa.

### Tempo de troca de páginas

Em **Configurar TV**, defina **Tempo entre páginas (segundos)**, de 5 a 300 segundos. A configuração é independente por TV e pode ser definida também no cadastro. Ao salvar, a TV recebe o novo intervalo por SSE, sem precisar recarregar. O temporizador funciona somente quando há mais de uma página e é pausado quando todos os produtos cabem em uma página. Atualizações de preços não reiniciam o contador; mudar o intervalo inicia uma nova contagem com o tempo escolhido.

## Execução fora do DDEV

Use Node.js 24 ou superior e MariaDB 11.8. Crie um banco UTF-8 e um usuário com permissões no banco da aplicação, copie `.env.example` para `.env` e configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` e `ADMIN_PASSWORD`.

```sh
npm ci
npm run db:migrate
# Se estiver migrando o sistema antigo, importe antes do seed.
npm run db:seed
npm start
```

Em produção, configure `NODE_ENV=production`, `PUBLIC_ORIGIN=https://seu-dominio` e `COOKIE_SECURE=true`, além de uma senha forte. Use HTTPS no proxy reverso e mantenha a aplicação sob um gerenciador de processos. Em produção, o primeiro administrador é criado pelo link de ativação descrito no guia de instalação; contas existentes continuam autenticadas pelo banco. `ADMIN_PASSWORD` é usado somente no ambiente de desenvolvimento. Os dados de acesso padrão do DDEV são exclusivos do desenvolvimento.

No Nginx, desative buffering para os eventos e mantenha o restante das rotas apontando para o Node.js:

```nginx
location /api/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

Uma instância atende várias TVs com catálogos independentes. O MariaDB e as sessões persistentes preparam a base para expansão; ao executar várias instâncias Node.js, será necessário distribuir os eventos entre elas (por exemplo, com Redis) e compartilhar o controle de tentativas de login. Atualmente, atualizações SSE são distribuídas pelas conexões da instância que recebeu a edição. Edições manuais no banco não emitem eventos; use a administração/API ou reinicie a aplicação após manutenção direta.

Referências: [redimensionamento de imagens com sharp](https://sharp.pixelplumbing.com/api-resize/), [Node.js no DDEV](https://docs.ddev.com/en/stable/users/quickstart/#nodejs), [daemons e portas no DDEV](https://docs.ddev.com/en/stable/users/extend/customization-extendibility/), [pool de conexões mysql2](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool).

Os cartões de seleção de TV mostram **Online** em verde ou **Offline** em vermelho. Cada painel aberto envia presença a cada 15 segundos; sem resposta por 45 segundos, a TV fica offline. O painel administrativo consulta o status a cada 5 segundos. Se vários painéis usam a mesma TV cadastrada, ela permanece online enquanto pelo menos um responde. Na falta de comunicação do administrador com a API, o indicador mostra “Verificando conexão”.

Administradores gerenciam siglas e descrições no menu **Unidades**. As unidades são globais, armazenadas no MariaDB e disponíveis para todas as TVs e operadores. As opções iniciais KG, UN, G, L, PCT e CX são preservadas pela migração. Alterar uma sigla atualiza os produtos vinculados e os painéis em tempo real. A exclusão é bloqueada enquanto houver produtos usando a unidade; mantenha ao menos uma unidade cadastrada.

### E-mails, recuperação de senha e 2FA

Administradores configuram o remetente no menu **E-mails**. Salve e use **Enviar e-mail de teste** antes de orientar os usuários a ativar o 2FA. A configuração atende SMTP com senha, relay sem autenticação, Gmail e Microsoft; o envio permanece desligado até ser configurado. As credenciais são criptografadas com AES-256-GCM e nunca retornam pela API. Campos secretos vazios preservam os valores da mesma conta; ao trocar conta, provedor ou método de autenticação, preencha as novas credenciais.

`MAIL_ENCRYPTION_KEY` deve conter 64 caracteres hexadecimais (32 bytes). Gere com `openssl rand -hex 32`, salve no `.env` ou no gerenciador de segredos do servidor e mantenha uma cópia protegida junto do backup. Não troque a chave sem recadastrar as credenciais. O ambiente de desenvolvimento já possui uma chave local; produção deve usar sua própria chave. `PUBLIC_ORIGIN` deve ser a URL pública confiável do sistema, de preferência HTTPS; links de recuperação usam essa URL, nunca o cabeçalho Host da requisição.

- **SMTP personalizado:** configure host, porta e autenticação do seu serviço. Porta 587 costuma usar STARTTLS e 465 usa TLS direto. O usuário SMTP pode ser um identificador ou e-mail. Sem TLS só é permitido para relay sem autenticação.
- **Gmail / Google Workspace:** `smtp.gmail.com`. Use uma senha de aplicativo disponibilizada pela conta Google com verificação em duas etapas, ou OAuth com Client ID, segredo e refresh token. A senha normal da conta não é utilizada. Algumas contas ou políticas Workspace não disponibilizam senhas de aplicativo. Em OAuth, registre o aplicativo Google, autorize `https://mail.google.com/` e obtenha um refresh token com acesso offline. [Senhas de aplicativo do Google](https://support.google.com/mail/answer/185833), [OAuth SMTP do Gmail](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol).
- **Microsoft 365 empresarial:** `smtp.office365.com:587` com STARTTLS e OAuth. Para consentimento de usuário, use `offline_access` e `https://outlook.office.com/SMTP.Send`, Client ID, segredo, Tenant ID e refresh token. Para autenticação do aplicativo, cadastre as permissões SMTP no Entra/Exchange, autorize a caixa postal e use o Tenant ID empresarial, Client ID e segredo; tokens usam `https://outlook.office365.com/.default`. SMTP AUTH deve estar permitido para a caixa postal. O consentimento e as permissões precisam ser configurados no provedor; esta tela recebe as credenciais e renova tokens, sem realizar um assistente de consentimento externo. [Documentação Microsoft de OAuth SMTP](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).
- **Outlook.com / Hotmail pessoal:** selecione o tipo pessoal, que configura `smtp-mail.outlook.com:587`, OAuth por consentimento do usuário e Tenant ID `consumers`. Autenticação apenas por aplicativo não se aplica a contas pessoais. [Configurações Outlook.com](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com).
- **DDEV / Mailpit:** para testar localmente, use SMTP personalizado, host `127.0.0.1`, porta `1025`, relay sem TLS e sem autenticação. Consulte `ddev describe` para a URL do Mailpit. As mensagens ficam no ambiente local, sem envio externo.

O cadastro de usuários tem e-mail único opcional para preservar contas existentes. Nome, e-mail, senha e **2FA por e-mail** ficam no mesmo formulário de criação/edição de usuário. Cada usuário pode editar nome e e-mail sem informar senha; deixar a nova senha em branco preserva a atual. A senha atual é exigida para trocar a senha e para ativar ou desativar o 2FA nessa edição; operadores veem apenas seu cadastro. Clicar no nome no cabeçalho abre o mesmo formulário. A ativação exige confirmação de um código enviado ao endereço cadastrado. Com 2FA ativo, o login não cria sessão antes de validar o código. Para mudar um e-mail protegido, o próprio usuário precisa desativar o 2FA primeiro; o administrador não controla essa escolha pela edição de usuários.

A opção **Esqueci minha senha** envia um link de uso único, com validade de 10 minutos. A resposta é uniforme para endereços cadastrados e desconhecidos. A troca da senha encerra sessões e invalida solicitações pendentes, mas preserva o 2FA. Códigos de 2FA também valem por 10 minutos e aceitam até cinco tentativas; solicitações repetidas do mesmo tipo têm intervalo mínimo de 30 segundos. Os tokens são armazenados como hash e os códigos têm hash vinculado ao token da solicitação. Não são retornados na API nem registrados em logs.

O controle de tentativas por IP é local à instância; em implantação com múltiplas instâncias, compartilhe esse limite com Redis ou mecanismo equivalente. A emissão e o consumo de solicitações usam o MariaDB compartilhado. Se o provedor ficar indisponível, o 2FA permanece exigido: restaure o envio SMTP em vez de desativar a proteção automaticamente. O envio SMTP é feito diretamente, com timeout, sem fila persistente; o usuário pode solicitar outra mensagem depois do intervalo permitido.


## Ordenação dos produtos por TV

Cada TV possui uma sequência de posições únicas, começando em zero. Ao inserir
ou mover um produto para uma posição ocupada, os demais são deslocados mantendo
a ordem relativa. Uma posição além do final é ajustada para o fim do catálogo.
Excluir um produto fecha o espaço deixado por ele. Transferências entre TVs
reorganizam as duas sequências e exigem permissão sobre ambas.

As alterações acontecem numa transação serializada do catálogo. O índice único
`products_screen_position_unique` protege a combinação TV/posição, inclusive
contra gravações concorrentes. As posições temporárias da reorganização não
ficam visíveis em estados confirmados.

A migração `011_unique_product_order.sql` normaliza catálogos existentes conforme
a sequência anteriormente exibida (`position,id`), preservando os produtos e
seus identificadores. A importação de SQLite usa a mesma ordem relativa e
normaliza as posições por TV.


### Reordenação pela interface

Na prévia e na lista de produtos, arraste um item sobre outro para ocupar a
posição do destino. A ordem é salva automaticamente e os itens intermediários
são deslocados. O arraste atua nos itens visíveis da página atual. Para mover
entre páginas, use o campo Ordem ou os botões Subir/Descer do editor.

Os botões do editor atendem também telas de toque. Produtos focados na prévia
ou na lista aceitam Alt + seta para cima/baixo. Os limites da sequência desabilitam
os movimentos correspondentes no editor. O campo numérico continua disponível.

A rota `PUT /api/products/:id/position` recebe apenas TV e posição e não altera
nome, preço, unidade ou oferta. A permissão é conferida na TV atual do produto;
se o item mudou de TV, a operação exige atualizar o catálogo. A transação e o
índice único são os mesmos usados na ordenação por formulário.


## Links de exibição e monitoramento automático (2.7.4)

O painel fornece Copiar link da TV para configurar o endereço de inicialização
no navegador ou gerenciador de telas. Não há sessão administrativa, pareamento
por código ou aprovação por aparelho. O endereço precisa ser configurado uma
vez em cada destino, como já ocorre para escolher o catálogo exibido.

O link autoriza somente registrar dispositivos e informar presença da TV à qual
pertence. O servidor deriva sua assinatura de uma chave privada persistente e
de um nonce por TV. O nonce fica em `screen_display_links`, fora do estado
público. A assinatura vai no fragmento da URL, que não é enviado no acesso HTTP,
e é transmitida apenas no corpo do registro automático via HTTPS. A credencial
individual é armazenada como hash no banco. Tokens de exibição não são sessões
administrativas e não autorizam edição.

Criar, consultar ou renovar o endereço exige uma sessão com permissão sobre a
TV. A renovação troca o nonce e revoga dispositivos/presença apenas dessa TV.
O comando de revogar dispositivos também invalida o link anterior. Os backups
do banco e de `/etc/systv` devem ser preservados juntos para manter as assinaturas
após uma restauração.

O navegador guarda sua identificação, credencial e link localmente. A cada
15 segundos, envia presença; o painel considera online um dispositivo que
respondeu nos últimos 45 segundos. Em falha de rede ou expiração, o navegador
se registra novamente sem login. Não há vencimento periódico do link. Fechar
uma aba interrompe seus envios, e a presença expira pelo prazo do servidor sem
derrubar outra aba do mesmo dispositivo. Páginas restauradas pelo navegador
retomam conexão e monitoramento.

Links antigos sem credencial não são autorizados anonimamente: os preços
continuam visíveis, mas a TV informa que deve ser usado o endereço copiado no
painel. Dispositivos com autorização anterior válida são compatíveis.
`preview=1` identifica uma prévia: não registra presença, não lê credenciais do
dispositivo e não interfere no status real do catálogo.

`public/tv-presence.js` concentra esse ciclo e permite testar inicialização,
reabertura, queda de rede, expiração e revogação sem usar aparelhos reais.
