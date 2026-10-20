# Revisão de exposição pública — 20/10/2026

Revisão do conteúdo publicado no GitHub e das releases anteriores à versão
2.2.0. Não foi encontrado segredo real pelos procedimentos abaixo. Isso não
representa garantia absoluta contra todas as formas de informação sensível.

## Escopo conferido

- Histórico completo publicado até `v2.1.2`: nove commits e 100 blobs distintos,
  verificados com Gitleaks 8.30.1, com resultados integralmente redigidos.
- Comparação local dos valores secretos do `.env` de desenvolvimento com os
  blobs Git, sem imprimir os valores. Nenhuma correspondência.
- Ausência de `.env` real, bancos locais, backups, arquivos de IDE e chaves
  privadas entre os caminhos do histórico.
- Downloads de todos os assets das releases `v2.1.0`, `v2.1.1` e `v2.1.2`,
  conferência de SHA-256 e inspeção dos arquivos extraídos (49 por pacote).
- Gitleaks nos assets e nos arquivos extraídos das três releases, sem achados.
- Uma branch publicada (`main`) e nenhum artefato adicional de GitHub Actions
  no momento da conferência. Os workflows foram revisados para não imprimir
  configuração de produção, senhas ou chaves geradas nos testes.

As senhas de fixtures como `test-root-only`, `integration-password` e os dados
`db`/`db` da configuração DDEV antiga são dados de teste/desenvolvimento, não
credenciais de produção. DDEV existe somente no histórico anterior; não está
na árvore atual ou nos pacotes de produção.

Nome/e-mail dos autores de commits e o identificador da conta GitHub são
metadados públicos de autoria. Não são credenciais e não foram removidos.
A revisão não acessou o servidor instalado e não afirma nada sobre arquivos
armazenados fora deste repositório, outros projetos ou serviços externos.

## Controles acrescentados

- Gitleaks em todo o histórico na CI, com redação de resultados.
- Exclusão Git para chaves/certificados privados, bancos e dumps locais.
- Pacote de produção com diretórios permitidos, bloqueio de caminhos sensíveis
  e teste automático para impedir inclusão de segredo por nome de arquivo.
- Segredos de instalação ficam em `/etc/systv`, fora das releases e do Git.
- Backups e snapshots de configuração têm acesso restrito a root e não fazem
  parte dos pacotes públicos.

Relatórios detalhados de scanners e valores locais não são publicados. Se um
segredo real for identificado futuramente, revogue/rotacione primeiro e então
planeje a remoção do histórico e dos arquivos afetados.
