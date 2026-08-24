#!/usr/bin/env bash
# Lê os feeds RSS dos alertas direto do bash, sem Node.
#
# Uso:
#   ./scripts/alertas.sh            # contagem por alerta
#   ./scripts/alertas.sh -v         # lista título + URL real de cada entrada
#   ./scripts/alertas.sh -u         # só as URLs reais (bom para pipe/diff)
#
# Os feeds são públicos: quem tem a URL, lê o conteúdo. Não são segredo grave,
# mas também não são para colar em lugar público.

set -uo pipefail

BASE="https://www.google.com/alerts/feeds/16549780003450680571"

# id do alerta -> id do feed. Precisa bater com src/config/alertas.ts.
FEEDS="
pm-bh-job:3469699774417139819
pm-remoto-job:14848090260388894556
pm-bh-gupy:15399087825688553350
pm-remoto-post-titulo:2169284706479048979
pm-remoto-post-corpo:7660055469178673414
"

MODO="contagem"
case "${1:-}" in
  -v) MODO="verbose" ;;
  -u) MODO="urls" ;;
  "") ;;
  *) echo "uso: $0 [-v|-u]" >&2; exit 2 ;;
esac

# O Alerts embrulha todo link em google.com/url?...&url=<destino>.
# Sem desembrulhar, tudo vira o mesmo domínio e a dedup por URL colapsa.
desembrulhar() {
  sed -e 's|&amp;|\&|g' \
    | sed -n 's|.*[?&]url=\([^&]*\).*|\1|p' \
    | sed -e 's|%3A|:|g' -e 's|%2F|/|g' -e 's|%25|%|g'
}

# O Alerts entrega o título com DUPLA codificação: as tags de destaque vêm como
# &lt;b&gt; e um & do texto vem como &amp;amp;. Duas coisas importam aqui:
#   1. decodificar &lt;/&gt; ANTES de remover tags — é isso que revela as tags;
#   2. passar em &amp; duas vezes — uma só deixaria "&amp;" no lugar de "&".
decodificar() {
  sed -e 's|&lt;|<|g' \
      -e 's|&gt;|>|g' \
      -e 's|<[^>]*>||g' \
      -e 's|&quot;|"|g' \
      -e "s|&#39;|'|g" \
      -e 's|&nbsp;| |g' \
      -e 's|&amp;|\&|g' \
      -e 's|&amp;|\&|g'
}

entradas_do_feed() {
  # Uma <entry> por linha, para o sed conseguir trabalhar campo a campo.
  curl -sS --max-time 20 "$1" | sed 's|<entry>|\n<entry>|g' | grep '<entry>'
}

total_geral=0

for par in $FEEDS; do
  [ -z "$par" ] && continue
  alerta="${par%%:*}"
  feed_id="${par##*:}"
  url="$BASE/$feed_id"

  entradas="$(entradas_do_feed "$url")"
  n=0
  [ -n "$entradas" ] && n=$(printf '%s\n' "$entradas" | grep -c '<entry>')
  total_geral=$((total_geral + n))

  case "$MODO" in
    contagem)
      printf '%-24s %3d\n' "$alerta" "$n"
      ;;
    verbose)
      printf '\n=== %s (%d) ===\n' "$alerta" "$n"
      [ "$n" -eq 0 ] && continue
      printf '%s\n' "$entradas" | while IFS= read -r e; do
        titulo=$(printf '%s' "$e" \
          | sed -n 's|.*<title type="html">\(.*\)</title>.*|\1|p' \
          | decodificar)
        real=$(printf '%s' "$e" | sed -n 's|.*<link href="\([^"]*\)".*|\1|p' | desembrulhar)
        data=$(printf '%s' "$e" | sed -n 's|.*<published>\([^<]*\)</published>.*|\1|p')
        printf '  %s\n    %s\n    %s\n' "${titulo:-<sem título>}" "${real:-<link não resolvido>}" "$data"
      done
      ;;
    urls)
      [ "$n" -eq 0 ] && continue
      printf '%s\n' "$entradas" | while IFS= read -r e; do
        printf '%s' "$e" | sed -n 's|.*<link href="\([^"]*\)".*|\1|p' | desembrulhar
      done
      ;;
  esac
done

[ "$MODO" = "contagem" ] && printf '%-24s %3d\n' "TOTAL" "$total_geral"
exit 0
