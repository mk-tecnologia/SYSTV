# Histórico

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
