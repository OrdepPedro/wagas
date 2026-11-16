import type { Metadata } from 'next';
import { metadataDaPagina } from '../../lib/site.ts';

/**
 * Política de privacidade do site e da extensão do Chrome.
 *
 * A Chrome Web Store exige URL pública de política para extensão que lida com
 * dado pessoal, e o currículo é o dado mais pessoal do produto. O texto
 * descreve o que o código faz HOJE — se uma regra mudar (retenção, provedor de
 * IA, o que é gravado), esta página muda no mesmo commit.
 *
 * O contato vem de `NEXT_PUBLIC_CONTATO_PRIVACIDADE`: a LGPD pede um canal para
 * o titular, e o endereço é decisão de quem opera o site, não do código.
 */
export const metadata: Metadata = metadataDaPagina(
  '/privacidade',
  'Política de privacidade',
  'O que o wagas e a extensão do Chrome fazem com os seus dados.',
);

const ATUALIZADA_EM = '10/11/2026';

export default function Privacidade() {
  const contato = process.env['NEXT_PUBLIC_CONTATO_PRIVACIDADE']?.trim();

  return (
    <article className="texto-longo">
      <h1>Privacidade</h1>
      <p className="fraco">Atualizada em {ATUALIZADA_EM}. Vale para o site wagas e para a extensão do Chrome.</p>

      <p>
        O wagas é um site gratuito para quem procura emprego: mostra vagas dos últimos 7 dias e adapta o seu
        currículo a uma vaga. Esta página diz, sem rodeio, o que guardamos, para quê, com quem compartilhamos e
        como apagar.
      </p>

      <h2>O que guardamos</h2>
      <ul>
        <li>
          <strong>Conta.</strong> O seu e-mail, se você entrar com ele. Quem usa sem e-mail recebe uma sessão
          anônima, sem nome nem e-mail.
        </li>
        <li>
          <strong>Buscas e cliques.</strong> O cargo e a cidade que você busca, quantas vagas apareceram e em
          quais vagas você clicou. É o que mede se o produto funciona e decide de quais cargos e cidades buscar
          vagas.
        </li>
        <li>
          <strong>Currículo salvo.</strong> Só se você tiver conta com e-mail e marcar a caixa de consentimento.
          Guardamos o texto do currículo, quando você o salvou, as versões adaptadas que você gerou e os
          pedidos de ajuste que você escreveu à IA na revisão, com as respostas dela.
        </li>
        <li>
          <strong>Medidor e reescrita para LinkedIn e Gupy.</strong> O currículo enviado a essas ferramentas é
          processado e descartado. Guardamos só a nota, contagens e um código não reversível do texto, para
          aplicar o limite diário.
        </li>
      </ul>
      <p>
        Não guardamos endereço IP em tabela nossa, não vendemos dado e não usamos o seu currículo para nada além
        de gerar o que você pediu.
      </p>

      <h2>Extensão do Chrome</h2>
      <p>
        A extensão serve a um propósito só: adaptar o currículo que você salvou no wagas a uma vaga que você
        colou nela.
      </p>
      <ul>
        <li>
          <strong>Ela não lê as páginas que você visita.</strong> Não tem acesso às suas abas nem roda código
          em site nenhum. Você copia e cola o cargo, a empresa e a descrição da vaga.
        </li>
        <li>
          O que você cola é enviado ao wagas e à IA para gerar o currículo adaptado. <strong>A descrição da vaga
          não é guardada</strong>: guardamos só o cargo, a empresa e um código não reversível do texto, para não
          gastar o seu limite diário com a mesma vaga duas vezes.
        </li>
        <li>
          A extensão usa a sua sessão do site wagas, sem guardar senha nem token. O rascunho do que você colou
          fica no próprio navegador e some quando ele é fechado.
        </li>
      </ul>

      <h2>Com quem compartilhamos</h2>
      <ul>
        <li>
          <strong>Supabase</strong> (banco de dados e login, servidor em São Paulo): guarda tudo o que está
          listado acima.
        </li>
        <li>
          <strong>Groq</strong> (IA, Estados Unidos): recebe o seu currículo salvo e a descrição da vaga para
          gerar a versão adaptada. O currículo salvo vai só para ele.
        </li>
        <li>
          <strong>Google Gemini</strong> (IA, Estados Unidos): recebe o currículo enviado ao medidor e à
          reescrita para LinkedIn e Gupy, que não ficam guardados por nós.
        </li>
        <li>
          <strong>Vercel</strong> (hospedagem do site), que processa as requisições e conta as visitas: qual
          página foi aberta, de onde a visita veio, país, navegador e tipo de aparelho. A contagem não usa
          cookie e não identifica você de um dia para o outro nem em outros sites.
        </li>
      </ul>

      <h2>Por quanto tempo</h2>
      <ul>
        <li>Currículo salvo e adaptações: até você apagar.</li>
        <li>
          Sessão anônima: apagada depois de 30 dias sem uso. As buscas e cliques dela ficam, sem ligação com
          ninguém.
        </li>
        <li>Conta com e-mail: até você pedir a exclusão.</li>
      </ul>

      <h2>Seus direitos (LGPD)</h2>
      <p>
        Você pode ver, corrigir e apagar o seu currículo quando quiser, em <a href="/curriculo">Seu currículo</a>
        . O botão de apagar remove o currículo, o conteúdo de todas as versões adaptadas e os pedidos de ajuste. Para acessar ou
        apagar qualquer outro dado, ou a conta inteira,{' '}
        {contato ? (
          <>
            escreva para <a href={`mailto:${contato}`}>{contato}</a>
          </>
        ) : (
          'fale com quem opera o site'
        )}
        .
      </p>
    </article>
  );
}
