// Retenção do visitante (LGPD, migration 0010): apaga conta anônima sem acesso
// há 30 dias. Buscas e cliques ficam, anonimizados.
//
//   npm run limpar-visitantes
//
// Roda no começo da coleta diária. Falhar aqui não deve impedir a coleta, então
// o workflow chama este passo com `continue-on-error` — mas o erro aparece no
// log e no resumo do run, em vez de ser engolido.

import { carregarConfigClassificador } from '../src/config/env.ts';
import { SupabaseRest } from '../src/db/supabase.ts';

const RETENCAO_DIAS = 30;

const config = carregarConfigClassificador({ precisaDb: true });
const db = new SupabaseRest(config.supabaseUrl, config.supabaseServiceKey);

const apagados = await db.rpc<number>('limpar_visitantes', { dias: RETENCAO_DIAS });
console.log(`visitantes sem acesso há ${RETENCAO_DIAS}+ dias apagados: ${apagados}`);
