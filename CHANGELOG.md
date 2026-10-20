# Histórico

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
