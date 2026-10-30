# Histórico

## 2.7.5

- Exibe o nome e o status de todas as TVs autorizadas em uma lista compacta sempre visível, com totais online/offline e seleção direta para edição. Falhas de consulta aparecem como sem confirmação.
- Preserva o status durante a renovação normal da sessão, evitando oscilações desnecessárias nos indicadores.

## 2.7.4

- Compacta o painel administrativo: seleção de TV sem cartões expansivos, indicadores em linha, cadastro e catálogo próximos do topo, ajuda recolhível e exclusão de TV na configuração. Preserva controles acessíveis e a rolagem normal de catálogos extensos.

- Substitui a necessidade de login em cada TV por links exclusivos de exibição, copiados no painel, com registro e reconexão automáticos do navegador.
- Mantém o link estável após reiniciar a aplicação e permite renová-lo por TV, invalidando apenas as autorizações daquela tela.
- Separa a prévia administrativa da exibição monitorada para que a prévia não mantenha uma TV desligada como online.
- Preserva dispositivos já autorizados e recupera credenciais expiradas automaticamente quando o navegador possui o link válido.
- Evita esgotar a cota de presença durante muitas atualizações de catálogo e mantém o monitoramento de outras abas ao fechar uma exibição.
- Mostra orientação quando o endereço antigo não possui autorização de monitoramento, sem solicitar códigos ou login na TV.


## 2.7.3

- Permite arrastar produtos na prévia e na lista para reorganizar a TV, com salvamento automático, indicação de destino, botões Subir/Descer e atalhos de teclado. A movimentação altera somente a posição e respeita as permissões da TV.
- Mantém posições únicas e sequenciais por TV: inserir ou mover um produto desloca os demais, e a exclusão fecha a sequência. Uma migração normaliza posições antigas e adiciona proteção no banco contra duplicidades.
- Acrescenta a ação Excluir produto no editor aberto pela prévia da TV, com confirmação identificando produto e catálogo e limpeza da edição após a exclusão.
- Mantém a mesma ação na lista, com verificação das permissões por TV na API.
- Inclui a licença GPL v3 ou posterior e o README nos pacotes e nas instalações.

## 2.7.2

- Publica os arquivos systemd por substituição atômica e confirma a gravação da release e das configurações em disco antes de concluir.
- Confere o hash do executável Node extraído contra o pacote validado e verifica sua execução antes de ativar a release.
- Grava e valida a chave pública SSH do SCRIPTS-INI antes de ativar acesso somente por chave, com `AuthenticationMethods publickey` e recarga do SSH.
- Verifica chave, autenticação e arquivos de serviço no teste da instalação inicial, sem depender da execução posterior de `systvctl server`.

## 2.7.1

- Incorpora a preparação Debian do SCRIPTS-INI: vim, qemu-guest-agent, fastfetch, chave SSH do administrador e autenticação por chave.
- Usa o banner MKTECNOLOGIA original, MOTD dinâmico, aliases do root e domínio do kernel; acrescenta `systemd.ssh_auto=no` ao GRUB.
- Preserva backups dos arquivos alterados; atualizações comuns não reaplicam a preparação de SSH/root.

## 2.7.0

- Adapta o perfil local do MKPABX ao SYSTV: hostname, domínio local em `/etc/hosts`, fuso horário e identificação da MK Tecnologia no console.
- O assistente pede nome do servidor, domínio e fuso e sugere a URL HTTPS correspondente; instalações automatizadas aceitam `--hostname`, `--domain` e `--timezone`.
- Mostra sistema, kernel, IP dinâmico, versão ativa e URL do painel antes do login, além de identificação no MOTD.
- Mascara persistentemente o `systemd-ssh-generator`, corrigindo as tentativas repetidas de AF_VSOCK sem desativar o SSH TCP.
- Configura o console para exibir erros do kernel, preservando warnings e informações nos logs.
- Acrescenta `systvctl server`, snapshots privados e recuperação em erro, aplicação idempotente e atualização do banner ao trocar a origem web ou a versão ativa.
- Preserva sessões abertas, política SSH, firewall, IP, gateway e DNS da rede.


## 2.6.0

- Corrige as cotas de autenticação atrás do Nginx, com identificação confiável do cliente e limites por IP, conta e escopo global.
- Exige senha atual para mudar o e-mail de recuperação e protege alterações simultâneas do perfil.
- Atualiza Nodemailer para 10.3.1 e inclui auditoria de dependências na CI.
- Autoriza a presença das TVs por credencial vinculada ao dispositivo e à tela, com expiração, revogação e quotas.
- Exige HTTPS para acesso de produção pela rede, cookies seguros e origem canônica; acrescenta CSP, HSTS e limites de conexões/consultas.
- Isola o build do usuário da aplicação e mantém código e ferramentas administrativas pertencentes a root.
- Atualiza o Node.js junto das releases e restaura o runtime no rollback, com compatibilidade para instalações antigas.
- Permite retomar instalações iniciais interrompidas com `--resume`, preservando parâmetros e credenciais; recuperação aguarda saúde da aplicação.
- Acrescenta retenção dos snapshots web e testes de falhas reais de npm, migração, proxy e runtime legado.
- Valida os fluxos no MariaDB/Debian 13 e a interface no Safari em desktop, celular e tablet.

**Antes de atualizar:** instalações de rede em HTTP precisam migrar para HTTPS e configurar a confiança do certificado nos clientes. Navegadores das TVs precisam ser autorizados uma vez pelo painel para informar presença online; links públicos continuam exibindo os preços.

## 2.5.0

- Consolida o CSS em uma base compartilhada de cores, bordas, raios, tipografia e espaçamentos.
- Padroniza cabeçalho, painéis, formulários, diálogos, listas, login, ativação, prévias e componentes da TV.
- Usa ações e adaptação responsiva comuns nas listas de produtos, unidades e usuários.
- Adiciona diretriz permanente de layout e prévia local com dados fictícios e medição de excesso horizontal.

## 2.4.4

- Remove largura mínima e rolagem horizontal da lista de usuários.
- Compacta a tabela, reúne nome/login/e-mail e usa ações com ícones identificados.
- Adapta os campos em telas pequenas sem cortar informações.
- Ações quebram de linha sem cortar botões ou expandir o conteúdo.

## 2.4.3

- Reduz cache de releases para cinco minutos e adiciona verificação manual com horário da consulta.
- Reserva espaço da barra de rolagem ao alternar páginas e contém a tabela de usuários na área de conteúdo.

## 2.4.2

- Padroniza controles de tema, perfil e saída com altura de 44px, borda e raio de 7px dos botões secundários.
- Unifica fundos, seleção, hover e foco nos temas claro e escuro, removendo a moldura retangular do perfil.

## 2.4.1

- Reorganiza cabeçalho com versão integrada à identidade, controles de conta agrupados e navegação alinhada ao conteúdo.
- Ajusta hierarquia, espaçamento, temas e disposição em telas pequenas.

## 2.4.0

- Versão instalada em destaque no cabeçalho do painel, com aviso e link para novas versões.
- Consulta de releases estáveis pelo servidor com cache e tolerância a intranets sem internet.

## 2.3.1

- Permite editar nome e e-mail do próprio usuário sem informar senha.
- Campo de nova senha vazio preserva a senha atual; troca de senha e 2FA continuam exigindo a senha atual.

## 2.3.0

- Primeiro administrador criado pelo usuário no navegador com link de uso único.
- Links de 256 bits, validade de 24 horas, renovação local e somente hash no banco.
- Senha administrativa padrão/gerada removida das novas instalações de produção.
- Entrega no terminal sem registrar o token em logs de provisionamento.
- Migração preserva contas e sessões existentes e bloqueia reabertura da ativação.

## 2.2.1

- Redireciona o nome curto HTTP ao endereço canônico, preservando caminho e parâmetros.
- Evita a página padrão do Nginx ao acessar o primeiro rótulo do hostname configurado.

## 2.2.0

- HTTPS local como padrão para URLs HTTPS, sem exigir servidor público.
- Modos explícitos para certificado próprio, CA da empresa, HTTP e Let's Encrypt.
- Recuperação de falha de Certbot sem reinstalar ou alterar banco/senhas.
- Reconfiguração web transacional com snapshot e restauração em erro.
- Revisão do histórico e de todas as releases públicas com Gitleaks.
- Proteções e CI para impedir publicação acidental de segredos.

## 2.1.2

- Aceita tokens de leitura do GitHub Actions no download privado.

## 2.1.1

- Corrige a seleção de versão no bootstrap após identificar o sistema operacional.

## 2.1.0

- Instalador por link, com assistente e download de release estável verificada.
- Distribuição de produção reproduzível, sem DDEV, dados locais ou segredos.
- Catálogo inicial vazio e credenciais aleatórias por instalação.
- Releases em diretórios separados, atualização com backup e rollback de código.
- Backups diários com checksums, retenção e comandos de diagnóstico.
- Verificação de instalação e operação em Debian 13 com systemd na CI.
