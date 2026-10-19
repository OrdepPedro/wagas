/**
 * Telegram — canal público, lido pelo HTML de `t.me/s/<canal>`.
 *
 * POR QUE ESTA FONTE FOI INVESTIGADA. O diferencial declarado do produto é
 * capturar vaga anunciada só em texto. O achado 27 mostrou que a SERP não
 * enxerga o post do LinkedIn enquanto o anúncio vale, e o achado 32 mostrou que
 * nenhuma solução paga conserta isso — todas descobrem post pelo mesmo índice do
 * Google. O Telegram ataca outro eixo: é push, não índice, e a página do canal é
 * HTML público, sem login, sem chave e sem conta.
 *
 * A restrição 2 trata de scraping do LinkedIn AUTENTICADO — DOM logado, sessão,
 * endpoint interno. Nada disso se aplica aqui, pela mesma leitura que autoriza a
 * API pública da Gupy: GET anônimo sobre conteúdo público.
 *
 * O QUE ESTE MÓDULO FAZ, E O QUE ELE DELIBERADAMENTE NÃO FAZ. Ele lê e
 * classifica. Não grava em `raw_results`, não entra no feed e não é chamado por
 * request de usuário. Enquanto a decisão de adotar o Telegram como fonte não for
 * tomada, isto é instrumento de medição — e o script que o usa é
 * `scripts/testar-telegram.ts`.
 */
import { limparTexto } from '../normalize/texto.ts';

export interface MensagemDeCanal {
  canal: string;
  segmento: string;
  id: number;
  url: string;
  dataIso: string;
  texto: string;
  links: string[];
  views: number | null;
}

/**
 * Contato direto: o anúncio continua sendo o texto, e o link é só o caminho de
 * volta para quem quer se candidatar. Qualquer OUTRO link externo significa que
 * a vaga tem página em algum lugar — ATS, quadro de vagas, portal do próprio
 * canal — e portanto é descobrível por outro caminho.
 *
 * ESTA LISTA É DE HOST, NÃO DE SUBSTRING, e a distinção não é preciosismo. A
 * primeira versão casava `whatsapp` em qualquer posição da URL, e as vagas do
 * `rjempregos` têm slug terminado em `-whatsapp`
 * (`rioempregos.com.br/vagasrj/operador-de-caixa-...-whatsapp`). Com isso, 240
 * republicações de portal entraram como "só texto", e o número que decide o
 * teste saiu 47% em vez de 10,6% — errando A FAVOR da hipótese que o teste
 * deveria julgar, que é o pior lado para um erro cair.
 */
const HOSTS_DE_CONTATO = [
  'wa.me',
  'whatsapp.com',
  'api.whatsapp.com',
  'chat.whatsapp.com',
  't.me',
  'telegram.me',
  'forms.gle',
  'docs.google.com',
];

export function ehLinkDeContato(url: string): boolean {
  if (/^mailto:/i.test(url)) return true;
  try {
    return HOSTS_DE_CONTATO.includes(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

export type Balde =
  | 'bot_agregador'
  | 'portal'
  | 'so_imagem'
  | 'spam_curso'
  | 'informal_com_cargo'
  | 'informal_sem_cargo';

/**
 * Robô que republica vaga de outro lugar. Nasceu de olhar o dado: os canais de
 * tech postam sempre no mesmo molde — "🚨Nova vaga encontrada🚨 ... ✨ verificada
 * por IA!" — e 242 das 299 citam o LinkedIn dentro da própria mensagem. Como não
 * trazem link (o botão de candidatura não aparece no HTML público), a regra de
 * link sozinha os classificaria como "só texto", que é o oposto do que são.
 */
const BOT = /Nova vaga encontrada|verificada por IA/i;

/** Venda de curso e afiliado, que usam vocabulário de emprego para vender outra coisa. */
const SPAM = /curso|certificad|matr[íi]cula|combo|promo[çc][ãa]o|cadastre-se agora|99app|parceiro 99/i;

/**
 * Cargo no texto. Léxico de ocupação, não de segmento — a mesma exigência que o
 * CLAUDE.md faz para `familia.ts`. Existe para separar "Contrata-se Garçom na
 * Savassi" de "Vagas abertas no Shopping Boulevard": as duas são informais, e só
 * a primeira é alcançável pela busca do produto, que é por cargo.
 */
const CARGO =
  /\b(analista|assistente|auxiliar|atendente|vendedor(?:a)?|operador(?:a)?|t[ée]cnic[oa]|enfermeir[oa]|m[ée]dic[oa]|desenvolvedor|programador|engenheir[oa]|designer|gerente|coordenador|supervisor|recepcionista|secret[áa]ri[oa]|motorista|cozinheir[oa]|gar[çc]om|gar[çc]onete|estagi[áa]ri[oa]|aprendiz|consultor|corretor|frentista|promotor|repositor|estoquista|padeiro|a[çc]ougueiro|camareir[oa]|porteiro|vigilante|zelador|faxineir[oa]|copeir[oa]|balconista|encarregado|pedreiro|eletricista|mec[âa]nico|soldador|costureir[oa]|manicure|cabeleireir[oa]|esteticista|barbeiro|professor|instrutor|redator|contador|advogado|farmac[êe]utic[oa]|nutricionista|fisioterapeuta|psic[óo]log[oa]|dentista|veterin[áa]ri[oa]|servi[çc]os gerais|seguran[çc]a|entregador|fiscal|comprador|almoxarife|montador|inspetor|conferente|telemarketing|pesquisador|expedi[çc][ãa]o|refrigera[çc][ãa]o)\b/i;

export function classificar(m: Pick<MensagemDeCanal, 'texto' | 'links'>): Balde {
  const texto = m.texto.trim();
  // Mensagem sem texto é panfleto: a vaga está DENTRO da imagem. Balde próprio
  // porque não é ausência de vaga, é vaga ilegível sem OCR.
  if (texto === '') return 'so_imagem';
  if (BOT.test(texto)) return 'bot_agregador';
  if (m.links.some((u) => !ehLinkDeContato(u))) return 'portal';
  if (SPAM.test(texto) && !CARGO.test(texto)) return 'spam_curso';
  return CARGO.test(texto) ? 'informal_com_cargo' : 'informal_sem_cargo';
}

export function extrairMensagens(html: string, canal: string, segmento = ''): MensagemDeCanal[] {
  const saida: MensagemDeCanal[] = [];
  // Cada mensagem começa no wrapper; fatiar por ele evita casar o campo de uma
  // mensagem com o de outra, que é o erro que faz a data sair trocada.
  const blocos = html.split('<div class="tgme_widget_message_wrap').slice(1);

  for (const bloco of blocos) {
    const post = /data-post="([^"]+)\/(\d+)"/.exec(bloco);
    const id = post?.[2];
    const dataIso = /<time[^>]+datetime="([^"]+)"/.exec(bloco)?.[1];
    if (!id || !dataIso) continue;

    const corpo = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(bloco);
    const bruto = corpo?.[1] ?? '';
    const texto = limparTexto(bruto.replace(/<br\s*\/?>/gi, '\n')).trim();

    // Links do texto E do card de preview: o card é o destino real quando a
    // mensagem só cola a URL, e ignorá-lo classificaria a vaga como "só texto".
    const links = [
      ...[...bruto.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? ''),
      ...[...bloco.matchAll(/tgme_widget_message_link_preview" href="([^"]+)"/g)].map((m) => m[1] ?? ''),
    ].filter((u) => /^https?:|^mailto:/i.test(u));

    const views = /tgme_widget_message_views">([^<]+)</.exec(bloco)?.[1] ?? null;

    saida.push({
      canal,
      segmento,
      id: Number(id),
      url: `https://t.me/${canal}/${id}`,
      dataIso,
      texto,
      links: [...new Set(links)],
      views: views ? Number(views.replace(/[^\d]/g, '')) || null : null,
    });
  }
  return saida;
}

const UA = 'Mozilla/5.0 (compatible; wagas-probe/0.1)';

export interface LeituraDeCanal {
  mensagens: MensagemDeCanal[];
  /**
   * A fonte falhou (rede, HTTP), separado de "não veio nada" — a mesma distinção
   * que a Gupy exigiu (achado 24). Canal fora do ar carimbado como canal vazio
   * viraria "o Telegram não tem vaga", que é conclusão errada sobre a fonte.
   */
  falhou: boolean;
}

/** Pagina para trás até sair da janela. `before` é o id da mensagem mais antiga da página. */
export async function lerCanal(
  canal: string,
  segmento: string,
  corte: number,
  buscar: typeof fetch = fetch,
): Promise<LeituraDeCanal> {
  const todas = new Map<number, MensagemDeCanal>();
  let before: number | null = null;
  let falhou = false;

  for (let pagina = 0; pagina < 12; pagina++) {
    const url = `https://t.me/s/${canal}${before ? `?before=${before}` : ''}`;
    let html: string;
    try {
      const r = await buscar(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        falhou = true;
        break;
      }
      html = await r.text();
    } catch {
      falhou = true;
      break;
    }

    const lote = extrairMensagens(html, canal, segmento);
    if (lote.length === 0) break;

    let novas = 0;
    for (const m of lote) {
      if (!todas.has(m.id)) {
        todas.set(m.id, m);
        novas++;
      }
    }
    if (novas === 0) break;

    if (Math.min(...lote.map((m) => Date.parse(m.dataIso))) < corte) break;
    before = Math.min(...lote.map((m) => m.id));
  }

  return { mensagens: [...todas.values()], falhou };
}
