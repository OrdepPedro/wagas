/**
 * Vitrine das funcionalidades além do feed. Cada uma é uma página própria.
 */
export default function PaginaDeFuncionalidades() {
  return (
    <div className="funcionalidades">
      <h1>Funcionalidades</h1>
      <p className="fraco">Ferramentas gratuitas para procurar vaga por conta própria.</p>
      <a href="/funcionalidades/dorks" className="caixa cartao-funcionalidade">
        <strong>Gerador de buscas avançadas</strong>
        <span className="fraco">
          Informe o cargo, os sites e o período: montamos a busca do Google pronta para abrir.
        </span>
      </a>
    </div>
  );
}
