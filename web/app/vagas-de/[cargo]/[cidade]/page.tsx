import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  caminhoDaPagina,
  PAGINAS_PUBLICAS,
  paginaPublica,
  tituloDaPagina,
  type PaginaPublica,
} from '../../../../../src/feed/paginas-publicas.ts';
import { lerVagasPublicas } from '../../../../lib/acervo-publico.ts';
import { JANELA_DIAS, type Vaga } from '../../../../lib/feed.ts';
import { metadataDaPagina, URL_DO_SITE } from '../../../../lib/site.ts';
import { FormularioDeBusca } from '../../../formularios.tsx';

/**
 * Página pública "vagas de <cargo> em <cidade>", para o Google.
 *
 * É o feed lido do cache, sem sessão e sem coleta (ver `acervo-publico.ts`).
 * Só existem os pares de `PAGINAS_PUBLICAS`; qualquer outro slug é 404.
 *
 * Página sem vaga sai com `noindex`: indexar "0 vagas de Motorista em Curitiba"
 * é página fina, e o Google rebaixa o site inteiro por isso, não só a página.
 */
// Literal, não `CACHE_SEGUNDOS`: o Next lê a configuração do segmento de forma
// estática e recusa valor importado. Mantenha os dois iguais.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return PAGINAS_PUBLICAS.map((p) => ({ cargo: p.cargoSlug, cidade: p.cidadeSlug }));
}

type Parametros = { params: Promise<{ cargo: string; cidade: string }> };

async function carregar(params: Parametros['params']) {
  const { cargo, cidade } = await params;
  const pagina = paginaPublica(cargo, cidade);
  if (!pagina) notFound();
  const lido = await lerVagasPublicas(pagina.cargo, pagina.cidade?.nome ?? null);
  return { pagina, lido };
}

function descricaoDa(p: PaginaPublica, total: number | null): string {
  const quantas = total ? `${total} ${total === 1 ? 'vaga publicada' : 'vagas publicadas'}` : 'Vagas publicadas';
  return p.cidade
    ? `${quantas} nos últimos ${JANELA_DIAS} dias para ${p.cargo} em ${p.cidade.nome} (${p.cidade.uf}): presenciais, híbridas e remotas de todo o Brasil. Gupy, InfoJobs e LinkedIn num lugar só.`
    : `${quantas} nos últimos ${JANELA_DIAS} dias para ${p.cargo} em home office, de empresas de todo o Brasil. Gupy, InfoJobs e LinkedIn num lugar só.`;
}

export async function generateMetadata({ params }: Parametros): Promise<Metadata> {
  const { pagina, lido } = await carregar(params);
  const total = lido?.vagas.length ?? null;
  const base = metadataDaPagina(
    caminhoDaPagina(pagina),
    `${tituloDaPagina(pagina)} — publicadas nesta semana`,
    descricaoDa(pagina, total),
  );
  // Falha de leitura (null) não vira noindex: seria tirar a página do índice
  // por causa de um soluço do banco. Só a ausência confirmada de vaga.
  return total === 0 ? { ...base, robots: { index: false, follow: true } } : base;
}

const NOME_DA_FONTE: Record<Vaga['fonte'], string> = {
  linkedin_job: 'LinkedIn',
  linkedin_post: 'post no LinkedIn',
  ats_gupy: 'Gupy',
  ats_inhire: 'InHire',
  ats_greenhouse: 'Greenhouse',
  portal_infojobs: 'InfoJobs',
};
const NOME_DO_MODELO = { remoto: 'remoto', hibrido: 'híbrido', presencial: 'presencial' } as const;

const dia = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

function Cartao({ vaga }: { vaga: Vaga }) {
  return (
    <li className="vaga">
      <p className="empresa">
        {vaga.empresa === 'não identificada' ? <em>empresa não identificada</em> : vaga.empresa}
      </p>
      {/* `/ir/` conta o clique de quem tem sessão e redireciona. `nofollow`
          porque o destino é o anúncio de outro site, e o robô não deve
          seguir — `robots.txt` já bloqueia o caminho. */}
      <a className="titulo" href={`/ir/${vaga.id}`} target="_blank" rel="nofollow noopener noreferrer">
        {vaga.cargo}
      </a>
      {vaga.localizacao ? <p className="local">{vaga.localizacao}</p> : null}
      <div className="etiquetas">
        {vaga.modelo ? (
          <span className={`etiqueta${vaga.modelo === 'remoto' ? ' destaque' : ''}`}>
            {NOME_DO_MODELO[vaga.modelo]}
          </span>
        ) : null}
        <span className="etiqueta">{NOME_DA_FONTE[vaga.fonte]}</span>
        <span className="etiqueta">
          {vaga.data_publicacao ? `publicada em ${dia(vaga.data_publicacao)}` : `vista em ${dia(vaga.data_referencia)}`}
        </span>
      </div>
    </li>
  );
}

export default async function PaginaPublicaDeVagas({ params }: Parametros) {
  const { pagina, lido } = await carregar(params);
  const vagas = lido?.vagas ?? [];
  const naCidade = lido ? vagas.filter((v) => v.cidade_slug === lido.cidadeSlug).length : 0;

  const mesmoCargo = PAGINAS_PUBLICAS.filter((p) => p.cargo === pagina.cargo && p !== pagina);
  const mesmaCidade = PAGINAS_PUBLICAS.filter((p) => p.cidadeSlug === pagina.cidadeSlug && p !== pagina);

  const migalhas = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'wagas', item: `${URL_DO_SITE}/` },
      { '@type': 'ListItem', position: 2, name: tituloDaPagina(pagina), item: `${URL_DO_SITE}${caminhoDaPagina(pagina)}` },
    ],
  };

  return (
    <article className="pagina-publica">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(migalhas) }} />
      <nav className="migalhas" aria-label="Você está em">
        <a href="/">wagas</a> › {tituloDaPagina(pagina)}
      </nav>

      <h1>{tituloDaPagina(pagina)}</h1>
      <p className="fraco">
        {lido === null
          ? `Vagas publicadas nos últimos ${JANELA_DIAS} dias.`
          : vagas.length === 0
            ? `Nenhuma vaga publicada nos últimos ${JANELA_DIAS} dias neste momento.`
            : pagina.cidade
              ? `${vagas.length} ${vagas.length === 1 ? 'vaga' : 'vagas'} dos últimos ${JANELA_DIAS} dias — ${naCidade} em ${pagina.cidade.nome}, ${vagas.length - naCidade} remotas de todo o Brasil.`
              : `${vagas.length} ${vagas.length === 1 ? 'vaga remota' : 'vagas remotas'} dos últimos ${JANELA_DIAS} dias, de empresas de todo o Brasil.`}
      </p>

      <section className="busca busca-publica" aria-label="Buscar outro cargo ou cidade">
        <FormularioDeBusca
          cargo={pagina.cargo}
          cidade={pagina.cidade?.nome ?? ''}
          soRemoto={pagina.cidade === null}
          rotulo="Ver o feed completo"
        />
      </section>

      {vagas.length > 0 ? (
        <ul className="vagas">
          {vagas.map((v) => (
            <Cartao key={v.id} vaga={v} />
          ))}
        </ul>
      ) : null}

      <nav className="outras" aria-labelledby="outras-cidades">
        <h2 id="outras-cidades">{pagina.cargo} em outros lugares</h2>
        <div className="atalho-grupo">
          <ul>
            {mesmoCargo.map((p) => (
              <li key={p.cidadeSlug}>
                <a href={caminhoDaPagina(p)}>{p.cidade ? p.cidade.nome : 'Remoto'}</a>
              </li>
            ))}
          </ul>
        </div>
        <h2>{pagina.cidade ? `Outros cargos em ${pagina.cidade.nome}` : 'Outros cargos remotos'}</h2>
        <div className="atalho-grupo">
          <ul>
            {mesmaCidade.map((p) => (
              <li key={p.cargoSlug}>
                <a href={caminhoDaPagina(p)}>{p.cargo}</a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </article>
  );
}
