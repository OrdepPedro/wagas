/**
 * Regras do Mapa: o que fica recolhido, em que estado está o acesso, e os
 * status de uma candidatura. Tudo determinístico e sem banco, para ter teste.
 *
 * Decidido pelo Pedro em 16–17/11/2026:
 *   - vaga cortada NÃO some: fica recolhida, com o motivo e a contagem;
 *   - o Mapa não se candidata por ninguém, só guarda o que a pessoa enviou;
 *   - teste de 3 dias sem cartão, depois o Mapa trava (o feed segue gratuito).
 */

export const NIVEIS = ['estagio', 'junior', 'pleno', 'senior', 'principal'] as const;
export type Nivel = (typeof NIVEIS)[number];

export const NOME_DO_NIVEL: Record<Nivel, string> = {
  estagio: 'Estágio',
  junior: 'Júnior',
  pleno: 'Pleno',
  senior: 'Sênior',
  principal: 'Especialista / liderança',
};

export const MODELOS = ['presencial', 'hibrido', 'remoto'] as const;
export type Modelo = (typeof MODELOS)[number];

export const CONTRATOS = ['tanto_faz', 'clt', 'pj'] as const;
export type Contrato = (typeof CONTRATOS)[number];

export interface PerfilDoMapa {
  /** Nível da pessoa. Null = não filtra por nível. */
  nivel: Nivel | null;
  /** Modelos de trabalho que ela aceita. Vazio = aceita todos. */
  modelos: Modelo[];
  contrato: Contrato;
  /** Quanto quer ganhar, em reais por mês. Guardado; ainda não corta nada. */
  pretensao: number | null;
}

export const PERFIL_VAZIO: PerfilDoMapa = { nivel: null, modelos: [], contrato: 'tanto_faz', pretensao: null };

export type MotivoDoCorte = 'nivel' | 'modelo' | 'contrato';

export const NOME_DO_MOTIVO: Record<MotivoDoCorte, string> = {
  nivel: 'acima do seu nível',
  modelo: 'modelo de trabalho que você não aceita',
  contrato: 'tipo de contrato que você não quer',
};

export interface VagaCortavel {
  senioridade: string | null;
  modelo: string | null;
  tipo_contrato: string | null;
}

/**
 * Por que esta vaga fica recolhida, ou null se ela fica à vista.
 *
 * DADO AUSENTE NUNCA CORTA. Senioridade está vazia em boa parte do acervo e a
 * extração pelo LLM varia entre rodadas (achado 11); modelo e contrato também
 * faltam. Cortar o desconhecido esconderia vaga boa em silêncio, que é o erro
 * caro. O desconhecido fica à vista e a pessoa decide.
 *
 * Nível só corta para CIMA: vaga sênior sai da frente de quem é júnior, mas
 * vaga júnior continua à vista de quem é sênior.
 */
export function motivoDoCorte(vaga: VagaCortavel, perfil: PerfilDoMapa): MotivoDoCorte | null {
  if (perfil.nivel && vaga.senioridade) {
    const daVaga = NIVEIS.indexOf(vaga.senioridade as Nivel);
    if (daVaga > NIVEIS.indexOf(perfil.nivel)) return 'nivel';
  }

  if (perfil.modelos.length > 0 && vaga.modelo && !perfil.modelos.includes(vaga.modelo as Modelo)) {
    return 'modelo';
  }

  if (perfil.contrato !== 'tanto_faz' && vaga.tipo_contrato) {
    const clt = /\bCLT\b/i.test(vaga.tipo_contrato);
    const pj = /\bPJ\b/.test(vaga.tipo_contrato);
    // Só corta quando a vaga declara o OUTRO regime e não declara o da pessoa.
    if (perfil.contrato === 'clt' && pj && !clt) return 'contrato';
    if (perfil.contrato === 'pj' && clt && !pj) return 'contrato';
  }

  return null;
}

export interface Separacao<V> {
  visiveis: V[];
  recolhidas: { vaga: V; motivo: MotivoDoCorte }[];
  contagem: Record<MotivoDoCorte, number>;
}

export function separar<V extends VagaCortavel>(vagas: V[], perfil: PerfilDoMapa): Separacao<V> {
  const saida: Separacao<V> = { visiveis: [], recolhidas: [], contagem: { nivel: 0, modelo: 0, contrato: 0 } };
  for (const vaga of vagas) {
    const motivo = motivoDoCorte(vaga, perfil);
    if (!motivo) saida.visiveis.push(vaga);
    else {
      saida.recolhidas.push({ vaga, motivo });
      saida.contagem[motivo]++;
    }
  }
  return saida;
}

/** Lê o perfil do formulário. Valor desconhecido vira "não filtra", nunca erro. */
export function perfilDoFormulario(campos: {
  nivel: string;
  modelos: string[];
  contrato: string;
  pretensao: string;
}): PerfilDoMapa {
  // "3.500,00", "3500" e "R$ 3.500" são o mesmo número; centavos saem.
  const digitos = campos.pretensao.replace(/,\d{1,2}\s*$/, '').replace(/\D/g, '');
  const valor = digitos ? Number(digitos) : null;
  return {
    nivel: (NIVEIS as readonly string[]).includes(campos.nivel) ? (campos.nivel as Nivel) : null,
    modelos: MODELOS.filter((m) => campos.modelos.includes(m)),
    contrato: (CONTRATOS as readonly string[]).includes(campos.contrato) ? (campos.contrato as Contrato) : 'tanto_faz',
    pretensao: valor !== null && valor >= 100 && valor <= 200_000 ? valor : null,
  };
}

// ---------------------------------------------------------------------------
// Acesso: teste de 3 dias, depois trava.
// ---------------------------------------------------------------------------

export const TRIAL_DIAS = 3;
/** Comparações com o currículo por dia durante o teste. */
export const COMPARACOES_POR_DIA_NO_TESTE = 2;

export type Acesso =
  | { estado: 'sem_teste' }
  | { estado: 'teste'; ate: Date; horasRestantes: number }
  | { estado: 'pago'; ate: Date }
  | { estado: 'expirado'; em: Date };

export function estadoDoAcesso(
  linha: { trial_inicio: string; pago_ate: string | null } | null,
  agora: Date = new Date(),
): Acesso {
  if (!linha) return { estado: 'sem_teste' };

  if (linha.pago_ate) {
    const pagoAte = new Date(linha.pago_ate);
    if (pagoAte > agora) return { estado: 'pago', ate: pagoAte };
  }

  const fim = new Date(new Date(linha.trial_inicio).getTime() + TRIAL_DIAS * 24 * 3600 * 1000);
  if (fim > agora) {
    return { estado: 'teste', ate: fim, horasRestantes: Math.ceil((fim.getTime() - agora.getTime()) / 3600_000) };
  }
  return { estado: 'expirado', em: linha.pago_ate ? new Date(linha.pago_ate) : fim };
}

// ---------------------------------------------------------------------------
// Candidaturas.
// ---------------------------------------------------------------------------

/**
 * `nao_enviada` é a resposta "não" à pergunta "você se candidatou?". Não é uma
 * candidatura: existe para a pergunta não se repetir, e nunca aparece na lista.
 */
export const STATUS = ['enviada', 'aguardando', 'entrevista', 'proposta', 'recusada', 'nao_enviada'] as const;
export type Status = (typeof STATUS)[number];

export const STATUS_VISIVEIS: Exclude<Status, 'nao_enviada'>[] = ['enviada', 'aguardando', 'entrevista', 'proposta', 'recusada'];

export const NOME_DO_STATUS: Record<Exclude<Status, 'nao_enviada'>, string> = {
  enviada: 'Enviada',
  aguardando: 'Aguardando próxima fase',
  entrevista: 'Entrevista',
  proposta: 'Proposta',
  recusada: 'Recusa',
};

export const ehStatus = (s: string): s is Status => (STATUS as readonly string[]).includes(s);

/** Seções do painel do Mapa, em `/mapa?aba=`. */
export const ABAS = ['geral', 'vagas', 'candidaturas', 'filtros'] as const;
export type Aba = (typeof ABAS)[number];
export const ehAba = (valor: unknown): valor is Aba =>
  typeof valor === 'string' && (ABAS as readonly string[]).includes(valor);

export interface CandidaturaManual {
  cargo: string;
  empresa: string;
  url: string | null;
  enviada_em: string;
  status: Status;
}

/** Valida a inserção manual. Devolve a mensagem de erro, ou a linha pronta. */
export function validarManual(
  campos: { cargo: string; empresa: string; url: string; enviada_em: string; status: string },
  hoje: Date = new Date(),
): { erro: string } | CandidaturaManual {
  const cargo = campos.cargo.trim().replace(/\s+/g, ' ');
  const empresa = campos.empresa.trim().replace(/\s+/g, ' ');
  if (cargo.length < 2 || cargo.length > 120) return { erro: 'Escreva o cargo da vaga.' };
  if (empresa.length < 2 || empresa.length > 120) return { erro: 'Escreva o nome da empresa.' };

  let url: string | null = null;
  if (campos.url.trim()) {
    try {
      const lida = new URL(campos.url.trim());
      if (lida.protocol !== 'https:' && lida.protocol !== 'http:') throw new Error('protocolo');
      url = lida.toString().slice(0, 500);
    } catch {
      return { erro: 'O link da vaga precisa começar com http:// ou https://.' };
    }
  }

  const dia = campos.enviada_em.trim() || hoje.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(dia))) return { erro: 'Data inválida.' };
  if (Date.parse(dia) > hoje.getTime() + 24 * 3600 * 1000) return { erro: 'A data não pode estar no futuro.' };

  const status = ehStatus(campos.status) && campos.status !== 'nao_enviada' ? campos.status : 'enviada';
  return { cargo, empresa, url, enviada_em: dia, status };
}
