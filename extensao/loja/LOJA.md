# Publicar na Chrome Web Store

Tudo o que o painel de desenvolvedor pede, pronto para colar. Os textos descrevem o que a extensão faz hoje. Se a extensão mudar, mude este arquivo no mesmo commit.

## Antes de subir

1. **O site está em `https://www.wagas.com.br`, e é esse endereço, com `www`, que a extensão usa.** `wagas.com.br` redireciona (308) para o `www`, e redirecionamento em pedido com a sessão do usuário quebra o login. A revisão testa de verdade, então `/privacidade` e `/api/extensao/*` precisam estar no deploy de produção antes de enviar.
2. **A política de privacidade precisa abrir:** `https://www.wagas.com.br/privacidade`. Defina `NEXT_PUBLIC_CONTATO_PRIVACIDADE` no servidor com o e-mail de contato. Sem ele, a página diz "fale com quem opera o site", o que não basta para a LGPD.
3. **Gere o zip apontando para o site de produção:**

   ```bash
   npm run extensao -- --site=https://www.wagas.com.br
   ```

   O zip sai em `dist/wagas-extensao-<versão>.zip`, com `manifest.json` na raiz e `host_permissions` só com o site de produção. A pasta `extensao/` continua apontando para `localhost:3000`, para desenvolver.

## Passo a passo no painel

[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Novo item** → enviar o zip.

### Aba "Pacote" / "Página da loja"

| Campo | Valor |
|---|---|
| Idioma | Português (Brasil) |
| Nome | vem do manifest: `wagas — currículo para esta vaga` |
| Resumo (até 132 caracteres) | vem do manifest: `Cole a vaga que você está vendo e receba o seu currículo salvo no wagas adaptado a ela, em PDF.` |
| Categoria | Ferramentas (Tools). "Workflow e planejamento" também serve |
| Ícone da loja (128×128) | `extensao/loja/icone-128.png` |
| Capturas de tela (1280×800) | `extensao/loja/print-1-colar.png`, `extensao/loja/print-2-resultado.png` |
| Bloco promocional pequeno (440×280) | `extensao/loja/tile-440x280.png` |
| Bloco promocional de letreiro (1400×560) | `extensao/loja/letreiro-1400x560.png` |
| Site oficial | `https://www.wagas.com.br` |
| URL de suporte | `https://www.wagas.com.br/privacidade` (tem o contato) |

**Descrição:**

```
Achou uma vaga e quer mandar um currículo feito para ela? Abra o painel do wagas ao lado da página, cole o cargo e a descrição da vaga, e receba o seu currículo adaptado em PDF.

Como funciona
• Você guarda o seu currículo uma vez no site do wagas (wagas: vagas dos últimos 7 dias para o seu cargo e a sua cidade).
• Em qualquer site de vagas, clique no ícone do wagas: o painel abre ao lado da página.
• Copie e cole o cargo, a empresa e a descrição da vaga.
• A IA reorganiza o seu currículo para aquela vaga: destaca o que é relevante e usa o vocabulário do anúncio.
• Baixe o PDF de uma coluna, legível por sistemas de recrutamento (ATS).

O que a IA não faz
• Não inventa experiência. O que a vaga pede e o seu currículo não mostra aparece numa lista à parte, para você decidir.
• Avisa quando o texto gerado cita algo que não estava no seu currículo original.

Privacidade
• A extensão não lê as páginas que você visita: você cola o texto da vaga.
• A descrição colada não é guardada.
• O currículo fica salvo na sua conta e você apaga quando quiser.

Gratuito, com limite diário de adaptações. Requer conta no wagas com e-mail.
```

### Aba "Práticas de privacidade"

**Finalidade única:**

```
Adaptar o currículo que o usuário salvou na sua conta do wagas a uma vaga de emprego que ele cola no painel lateral, e entregar o resultado em PDF.
```

**Justificativa de cada permissão:**

| Permissão | Justificativa |
|---|---|
| `sidePanel` | A extensão é um painel lateral. O painel fica aberto enquanto a pessoa copia o texto da vaga na página ao lado; um popup fecharia a cada clique na página. |
| `storage` | Guarda o rascunho do que a pessoa colou (cargo, empresa e descrição) em `chrome.storage.session`, para não se perder ao fechar e reabrir o painel. Some quando o navegador fecha. |
| Permissão de host (`https://www.wagas.com.br/*`) | É o único site que a extensão acessa: a API do próprio wagas, que tem o currículo salvo do usuário e gera a versão adaptada. A permissão faz o navegador enviar a sessão do usuário nesse site. Nenhum outro site é acessado. |

**Código remoto:** Não. Todo o JavaScript está no pacote.

**Uso de dados.** Marque:
- **Informações de identificação pessoal.** O currículo adaptado, com nome e contato da pessoa, volta do servidor para o painel.
- **Conteúdo do site.** O texto da vaga que a pessoa copia de uma página e cola no painel.

Não marque histórico de navegação, atividade do usuário, autenticação, localização, saúde, finanças nem comunicações. A extensão não lê abas nem páginas e não guarda credencial; a sessão é o cookie do próprio site, enviado pelo navegador.

Marque as três declarações: não vende nem transfere dado a terceiros fora dos casos permitidos; não usa dado para finalidade alheia à finalidade única; não usa dado para avaliar crédito.

**Política de privacidade:** `https://www.wagas.com.br/privacidade`

### Aba "Distribuição"

- **Visibilidade: Não listada.** Só quem tem o link instala. É o formato do teste com 10 pessoas (Passo 5).
- Países: Brasil, ou todos.

### Instruções de teste (campo para o revisor)

```
A extensão precisa de uma conta no wagas com e-mail. Para testar:
1. Abra https://www.wagas.com.br, clique em "Entrar" e informe o seu e-mail. Você recebe um link de acesso; abra-o neste navegador.
2. Em https://www.wagas.com.br/curriculo, cole qualquer texto de currículo (mínimo de 200 caracteres), marque a caixa de consentimento e salve.
3. Clique no ícone da extensão: o painel lateral abre.
4. Cole um cargo e uma descrição de vaga com pelo menos 300 caracteres e clique em "Adaptar meu currículo". Em ~10 segundos aparece o resultado; "Baixar PDF" gera o arquivo.
```

O login é por link mágico, então o revisor usa o próprio e-mail. Isso depende do e-mail do Supabase sair. O remetente padrão tem limite baixo por hora, o que basta para um revisor.

## Depois da primeira publicação

1. A loja dá um **ID** fixo à extensão: 32 letras, no painel e na URL do item.
2. Defina `EXTENSAO_ID=<id>` nas variáveis de ambiente do servidor e refaça o deploy. A partir daí, só a extensão oficial chama `/api/extensao/*`.
3. Para atualizar: suba `version` no `extensao/manifest.json`, rode `npm run extensao -- --site=...` de novo e envie o zip novo no mesmo item.

## Como as imagens foram geradas

`extensao/loja/prints.html` é a fonte, com o `painel.css` de verdade e dados fictícios. Para regerar no Windows (PowerShell, na raiz do repositório):

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"; $base = (Resolve-Path extensao\loja\prints.html).Path -replace '\\','/'; $out = (Resolve-Path extensao\loja).Path
foreach ($a in @(@('formulario','print-1-colar.png','1280,800'), @('resultado','print-2-resultado.png','1280,800'), @('tile','tile-440x280.png','440,280'), @('letreiro','letreiro-1400x560.png','1400,560'), @('icone','icone-128.png','128,128'))) { & $chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 "--user-data-dir=$env:TEMP\wagas-headless" "--window-size=$($a[2])" "--screenshot=$out\$($a[1])" "file:///$base`?tela=$($a[0])" }
```
