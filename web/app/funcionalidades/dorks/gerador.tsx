'use client';

import { useState } from 'react';
import { gerarDorks, PERIODOS, SITES, type Periodo } from '../../../../src/dorks/gerador.ts';

/**
 * Tudo no cliente: o dork é texto montado a partir do formulário, sem chamada
 * ao servidor e, sobretudo, sem a Serper.
 */
export function GeradorDeDorks() {
  const [cargo, setCargo] = useState('');
  const [cidade, setCidade] = useState('');
  const [remoto, setRemoto] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [sites, setSites] = useState<string[]>(['linkedin_job', 'gupy']);
  const [copiado, setCopiado] = useState<string | null>(null);

  const dorks = gerarDorks({ cargo, cidade, remoto, periodo, sites });

  function alternarSite(id: string) {
    setSites((atual) => (atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id]));
  }

  async function copiar(id: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      // Sem permissão de área de transferência: o texto continua selecionável.
    }
  }

  return (
    <>
      <div className="caixa gerador-dorks">
        <label htmlFor="dork-cargo">Cargo</label>
        <input
          id="dork-cargo"
          type="text"
          value={cargo}
          onChange={(e) => setCargo(e.target.value)}
          placeholder="Ex.: Analista de Dados"
        />

        <label htmlFor="dork-cidade">Cidade (opcional)</label>
        <input
          id="dork-cidade"
          type="text"
          value={cidade}
          disabled={remoto}
          onChange={(e) => setCidade(e.target.value)}
          placeholder="Ex.: Belo Horizonte"
        />
        <label className="opcao">
          <input type="checkbox" checked={remoto} onChange={(e) => setRemoto(e.target.checked)} />
          Só vagas remotas
        </label>

        <fieldset>
          <legend>Sites</legend>
          {SITES.map((s) => (
            <label key={s.id} className="opcao">
              <input type="checkbox" checked={sites.includes(s.id)} onChange={() => alternarSite(s.id)} />
              {s.nome}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Período</legend>
          {PERIODOS.map((p) => (
            <label key={p.id} className="opcao">
              <input
                type="radio"
                name="periodo"
                checked={periodo === p.id}
                onChange={() => setPeriodo(p.id)}
              />
              {p.rotulo}
            </label>
          ))}
        </fieldset>
      </div>

      {dorks.length > 0 ? (
        <ul className="lista-dorks">
          {dorks.map((d) => (
            <li key={d.site.id} className="caixa">
              <strong>{d.site.nome}</strong>
              <code className="dork">{d.consulta}</code>
              <div className="dork-acoes">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="link-feed">
                  Pesquisar no Google
                </a>
                <button type="button" className="discreto" onClick={() => copiar(d.site.id, d.consulta)}>
                  {copiado === d.site.id ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fraco">Informe o cargo e escolha ao menos um site.</p>
      )}
    </>
  );
}
