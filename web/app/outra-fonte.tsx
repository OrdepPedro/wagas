'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { AvisoDaOutraFonte } from '../../src/coleta/outra-fonte.ts';

/** Intervalo entre consultas ao estado. A coleta leva de 2 a 6 minutos. */
const INTERVALO_MS = 10_000;

/** Pedido cujo resultado a pessoa já viu, para o aviso não voltar a cada recarga. */
const CHAVE_VISTO = 'outra-fonte-visto';

function jaVisto(pedidoEm: string): boolean {
  try {
    return sessionStorage.getItem(CHAVE_VISTO) === pedidoEm;
  } catch {
    return false;
  }
}

function marcarVisto(pedidoEm: string): void {
  try {
    sessionStorage.setItem(CHAVE_VISTO, pedidoEm);
  } catch {
    // sem armazenamento: o aviso só volta numa recarga
  }
}

/**
 * Faixa sobre o feed enquanto a outra fonte é consultada em segundo plano.
 *
 * O feed não se atualiza sozinho quando a coleta termina: a lista pularia
 * enquanto a pessoa lê. Ela decide quando ver as vagas novas.
 */
export function FaixaDaOutraFonte({ inicial }: { inicial: AvisoDaOutraFonte | null }) {
  const [aviso, setAviso] = useState(inicial);
  const [atualizando, iniciar] = useTransition();
  const [visto, setVisto] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setAviso(inicial), [inicial]);
  // Lido depois de montar: sessionStorage não existe no servidor.
  useEffect(() => {
    if (inicial && jaVisto(inicial.pedidoEm)) setVisto(inicial.pedidoEm);
  }, [inicial]);

  // Aviso de fim sem ação (nada novo, mais tarde) aparece uma vez: na próxima
  // recarga ele já foi lido.
  useEffect(() => {
    if (aviso && (aviso.tipo === 'nada_novo' || aviso.tipo === 'mais_tarde')) marcarVisto(aviso.pedidoEm);
  }, [aviso]);

  const consultando = aviso?.tipo === 'consultando';
  useEffect(() => {
    if (!consultando) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/outra-fonte', { cache: 'no-store' });
        if (r.ok) setAviso(((await r.json()) as { aviso: AvisoDaOutraFonte | null }).aviso);
      } catch {
        // rede oscilou: tenta de novo no próximo intervalo
      }
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [consultando]);

  if (!aviso) return null;
  if (aviso.tipo !== 'consultando' && visto === aviso.pedidoEm) return null;

  if (aviso.tipo === 'consultando') {
    return (
      <div className="caixa outra-fonte" role="status">
        <span className="girando" aria-hidden="true" />
        <div>
          <p>Consultando outra fonte…</p>
          <p className="fraco">Leva alguns minutos. Pode ir olhando as vagas abaixo; avisamos aqui quando terminar.</p>
        </div>
      </div>
    );
  }

  if (aviso.tipo === 'chegou') {
    return (
      <div className="caixa outra-fonte boa" role="status">
        <div>
          <p>
            Outra fonte consultada: {aviso.vagas} {aviso.vagas === 1 ? 'vaga nova' : 'vagas novas'}.
          </p>
        </div>
        <button type="button" disabled={atualizando} onClick={() => {
            marcarVisto(aviso.pedidoEm);
            setVisto(aviso.pedidoEm);
            iniciar(() => router.refresh());
          }}>
          {atualizando ? 'Atualizando…' : 'Mostrar'}
        </button>
      </div>
    );
  }

  return (
    <div className="caixa outra-fonte" role="status">
      <p className="fraco">
        {aviso.tipo === 'nada_novo'
          ? 'Outra fonte consultada: nenhuma vaga nova para esta busca.'
          : 'A outra fonte vai demorar mais. As vagas dela entram aqui nas próximas horas.'}
      </p>
    </div>
  );
}
