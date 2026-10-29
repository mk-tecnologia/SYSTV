#!/usr/bin/env bash
# Funções compartilhadas: validação antes de provisionar ou alterar serviços.
web_validate() {
  [[ $ORIGIN =~ ^(http|https)://([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)$ ]] || fail 'URL inválida: use http://host ou https://host, sem porta/caminho/barra final.'
  SCHEME=${BASH_REMATCH[1]}
  SITE_HOST=${BASH_REMATCH[2]}
  SITE_HOST=${SITE_HOST,,}
  ORIGIN=$SCHEME://$SITE_HOST
  if [[ $SCHEME == http && $SITE_HOST != 127.0.0.1 && $SITE_HOST != localhost ]]; then
    fail 'Use HTTPS para acesso pela rede. HTTP é permitido somente em loopback para testes locais.'
  fi
  [[ $SITE_HOST != *..* ]] || fail 'Nome do servidor inválido.'
  [[ -n $TLS_MODE ]] || { if [[ $SCHEME == https ]]; then TLS_MODE=self-signed; else TLS_MODE=none; fi; }
  case $TLS_MODE in
    none) [[ $SCHEME == http ]] || fail 'O modo none exige URL http://.' ;;
    self-signed|provided|letsencrypt) [[ $SCHEME == https ]] || fail 'Este modo de certificado exige URL https://.' ;;
    *) fail 'Use --tls none, self-signed, provided ou letsencrypt.' ;;
  esac
  if [[ $TLS_MODE == provided ]]; then
    [[ $TLS_CERT == /* && -r $TLS_CERT && $TLS_KEY == /* && -r $TLS_KEY ]] || fail 'Informe --tls-cert e --tls-key com caminhos absolutos legíveis.'
  else
    [[ -z $TLS_CERT && -z $TLS_KEY ]] || fail '--tls-cert e --tls-key só podem ser usados com --tls provided.'
  fi
  if [[ $TLS_MODE == letsencrypt ]]; then
    case ${SITE_HOST,,} in
      localhost|*.localhost|*.intranet|*.internal|*.local|*.lan|*.home|*.test|*.invalid|*.example|*.home.arpa)
        fail "Let's Encrypt não atende nomes internos. Use --tls self-signed ou --tls provided." ;;
    esac
    [[ $SITE_HOST == *.* && ! $SITE_HOST =~ ^[0-9.]+$ ]] || fail 'O modo letsencrypt exige domínio público, não IP ou nome curto.'
    [[ $EMAIL =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail "Let's Encrypt exige --email válido."
  else
    [[ -z $EMAIL ]] || fail '--email só é necessário com --tls letsencrypt.'
  fi
}
