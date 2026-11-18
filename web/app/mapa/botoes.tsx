'use client';

import { useFormStatus } from 'react-dom';

/** Botão que diz que está trabalhando: a comparação espera a IA, e o aviso evita o clique duplo. */
export function EnviarComEspera({ children, pendente }: { children: string; pendente: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendente : children}
    </button>
  );
}
