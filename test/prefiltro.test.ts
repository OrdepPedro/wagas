import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { idadeEmDias, prefiltrar } from '../src/classificar/prefiltro.ts';
import type { Candidato } from '../src/classificar/tipos.ts';

function candidato(parcial: Partial<Candidato> = {}): Candidato {
  return {
    id: 1,
    fonte: 'linkedin_job',
    fonteId: '4365109913',
    urlCanonica: 'https://www.linkedin.com/jobs/view/4365109913',
    titulo: 'Product Manager - SYDLE',
    snippet: '',
    cargoBusca: 'Product Manager',
    localizacaoBusca: 'Belo Horizonte',
    dataPublicacao: null,
    ...parcial,
  };
}

const AGORA = new Date('2026-08-24T12:00:00Z');

describe('prefiltrar', () => {
  it('deixa passar vaga do cargo buscado', () => {
    assert.equal(prefiltrar(candidato(), { agora: AGORA }).passa, true);
  });

  it('corta domínio fora das três fontes', () => {
    const d = prefiltrar(candidato({ fonte: 'desconhecida' }), { agora: AGORA });
    assert.equal(d.passa, false);
    assert.equal(d.motivo, 'fonte_sem_extrator');
  });

  it('corta cargo de outra família pelo título', () => {
    const d = prefiltrar(candidato({ titulo: 'Especialista II SAP EWM - Grupo Boticário' }), {
      agora: AGORA,
    });
    assert.equal(d.passa, false);
    assert.equal(d.motivo, 'cargo_fora_do_titulo');
  });

  it('NUNCA filtra post por título', () => {
    // Achado 3 do CLAUDE.md: o `title` de post vem reescrito pelo Google
    // ("Publicação de Fulano"). Filtrar por ele descartaria vaga boa — o
    // `intitle:` do dork já fez esse filtro na origem.
    const d = prefiltrar(
      candidato({
        fonte: 'linkedin_post',
        titulo: 'Publicação de Ana Carolina Schirmer',
        urlCanonica: 'https://www.linkedin.com/feed/update/urn:li:activity:7454867228224626689',
      }),
      { agora: AGORA },
    );
    assert.equal(d.passa, true);
  });

  it('corta página de listagem da Gupy pelo título', () => {
    for (const titulo of [
      'Vagas de marketing | Encontre oportunidades',
      'Aplique para Vagas de enfermeiro em Minas Gerais',
      'Vagas de Assistente | Encontre oportunidades',
    ]) {
      const d = prefiltrar(
        candidato({ fonte: 'ats_gupy', titulo, urlCanonica: '', cargoBusca: 'Analista de Marketing' }),
        { agora: AGORA },
      );
      assert.equal(d.passa, false, titulo);
      assert.equal(d.motivo, 'pagina_de_listagem');
    }
  });

  it('corta página da Gupy cuja URL não é de vaga única', () => {
    const d = prefiltrar(
      candidato({
        fonte: 'ats_gupy',
        titulo: 'Product Manager - Omie',
        urlCanonica: 'https://carreirasomie.gupy.io/',
      }),
      { agora: AGORA },
    );
    assert.equal(d.passa, false);
    assert.equal(d.motivo, 'pagina_de_listagem');
  });

  it('aceita a vaga da Gupy no formato /job/<base64>', () => {
    // Caso real: a URL não tem id numérico, mas é vaga única. Cortar por
    // ausência de id perderia a vaga.
    const d = prefiltrar(
      candidato({
        fonte: 'ats_gupy',
        titulo: 'Página da Vaga | PRODUCT MANAGER III',
        urlCanonica: 'https://localiza.gupy.io/job/eyJqb2JJZCI6MTE1NjkyNDV9',
      }),
      { agora: AGORA },
    );
    assert.equal(d.passa, true);
  });

  it('"Vagas Home Office - Product Manager" em post não é listagem', () => {
    // A regra de listagem só vale para a Gupy: em post, esse título é anúncio
    // de vaga de verdade.
    const d = prefiltrar(
      candidato({ fonte: 'linkedin_post', titulo: 'Vagas Home Office - Product Manager' }),
      { agora: AGORA },
    );
    assert.equal(d.passa, true);
  });

  it('corta o que passou dos 7 dias', () => {
    const d = prefiltrar(
      candidato({ fonte: 'ats_gupy', urlCanonica: 'https://asaas.gupy.io/jobs/11889469', dataPublicacao: '2026-08-10T00:00:00Z' }),
      { agora: AGORA },
    );
    assert.equal(d.passa, false);
    assert.equal(d.motivo, 'fora_da_janela');
  });

  it('data desconhecida não reprova', () => {
    // Só a Gupy publica data estruturada. Reprovar por ausência mataria os dois
    // blocos do LinkedIn inteiros — o `tbs=qdr:w` da coleta é a garantia deles.
    assert.equal(prefiltrar(candidato({ dataPublicacao: null }), { agora: AGORA }).passa, true);
    assert.equal(prefiltrar(candidato({ dataPublicacao: 'ontem' }), { agora: AGORA }).passa, true);
  });
});

describe('idadeEmDias', () => {
  it('conta em dias corridos', () => {
    assert.equal(idadeEmDias('2026-08-17T12:00:00Z', AGORA), 7);
  });

  it('devolve null para data ausente ou ilegível', () => {
    assert.equal(idadeEmDias(null, AGORA), null);
    assert.equal(idadeEmDias('há 3 dias', AGORA), null);
  });
});
