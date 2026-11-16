import type { Metadata } from 'next';
import { caminhoDaPagina, PAGINAS_PUBLICAS } from '../../src/feed/paginas-publicas.ts';
import { lerVagasPublicas } from '../lib/acervo-publico.ts';
import { FormularioDeBusca } from './formularios.tsx';

/**
 * Página 404 do site inteiro.
 *
 * Quem cai aqui quase sempre veio de um link velho ou de uma página por cargo ×
 * cidade que não existe. A saída útil não é "voltar ao início": é a busca, que
 * é o que a pessoa queria fazer, mais os atalhos das páginas públicas.
 *
 * O Next já responde 404 e põe `noindex` sozinho; o título só evita que a aba
 * mostre o da home.
 */
export const metadata: Metadata = { title: 'Página não encontrada' };

export default async function NaoEncontrada() {
  // Um atalho por cargo, na versão remota: vale para quem chega de qualquer
  // cidade. Fica de fora o que está vazio hoje (Motorista remoto não existe), com
  // a mesma leitura em cache do sitemap; falha de leitura mantém o atalho.
  const remotas = PAGINAS_PUBLICAS.filter((p) => p.cidade === null);
  const lidas = await Promise.all(remotas.map((p) => lerVagasPublicas(p.cargo, null)));
  const atalhos = remotas.filter((_, i) => lidas[i]?.vagas.length !== 0);

  return (
    <article className="pagina-publica">
      <nav className="migalhas" aria-label="Você está em">
        <a href="/">wagas</a> › Página não encontrada
      </nav>

      <h1>Esta página não existe</h1>
      <p className="fraco">
        O endereço pode ter mudado ou estar digitado errado. Busque direto pelo cargo e pela cidade que você
        procura.
      </p>

      <section className="busca busca-publica" aria-label="Buscar vagas">
        <FormularioDeBusca />
      </section>

      <nav className="outras" aria-labelledby="atalhos-404">
        <h2 id="atalhos-404">Vagas remotas por cargo</h2>
        <div className="atalho-grupo">
          <ul>
            {atalhos.map((p) => (
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
