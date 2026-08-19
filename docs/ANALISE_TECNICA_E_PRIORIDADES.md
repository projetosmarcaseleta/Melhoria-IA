# Análise Técnica e Prioridades — CRIA

> Verificação com evidência do backlog de [PROMPT_MELHORIAS_PROJETO.md](PROMPT_MELHORIAS_PROJETO.md),
> com medições reais do Firestore de produção. Cada item marca o que foi **confirmado**,
> **corrigido** ou **reordenado** — e por quê.

Data da medição: 19/08/2026 · 6 clientes · 3.158 gerações · 190 chunks · 206 categorias espelhadas

---

## 1. O achado mais grave, que o backlog subestimou

A rota legada `POST /api/process` está montada **antes** de qualquer autenticação
(`server/index.js`: `app.use('/api', aiRouter)` na linha 34, `requireAuth` só a partir da 56).

O backlog descreve isso como "aceita `geminiApiKey` no corpo sem autenticação". O problema
real é o inverso do descrito: no caminho **OpenAI** — que é o padrão, quando ninguém manda
`provider: 'gemini'` — ela usa a `OPENAI_API_KEY` **do servidor**.

Ou seja: qualquer pessoa que alcance a porta do backend pode gastar o crédito de OpenAI do
projeto, sem login, em lote e sem limite de tamanho. Não é vazamento de dado — é gasto
financeiro direto e cota de API consumida por terceiros.

Confirmado também que **o frontend não chama mais essa rota** (`grep api/process src/` → nada).
É código morto com superfície de ataque. Remover é seguro e resolve três itens do backlog de uma vez
(rota legada, consolidação dos clients de LLM, teto de lote nesse caminho).

**Prioridade: acima de tudo o resto, inclusive do Firebase.**

---

## 2. Firebase: o diagnóstico do backlog está incompleto

### O que medi

| Recurso | Uso real | Limite do plano Spark | Situação |
|---|---|---|---|
| Storage (documentos + embeddings) | **2,23 MB** | 1 GiB | irrelevante — 0,2% |
| `generations` | 3.158 docs | — | cresce sem limite, nada expurga |
| `knowledge_chunks` | 190 docs (12 KB de embedding cada) | — | saudável |
| `anymarket_categories` | 206 docs (1 cliente) | — | saudável |

**Storage não é a causa da queda.** Sobram leituras e escritas por dia (50k / 20k no Spark).

### A correção conceitual que importa

O backlog propõe *retry com backoff exponencial* como item 1 da resiliência. Isso está certo
para `UNAVAILABLE`/`DEADLINE_EXCEEDED`, mas é preciso ser explícito sobre o caso que motivou
a análise:

> **Retry não resolve `RESOURCE_EXHAUSTED`. Piora.** Cota diária esgotada não volta em 300ms;
> volta na virada do dia (meia-noite, hora do Pacífico). Toda tentativa extra consome mais
> cota e aumenta o tempo de resposta para o operador ver o mesmo erro.

O backlog já reconhece isso no texto do item 1 ("sem retry para `RESOURCE_EXHAUSTED`"), mas
então o *circuit breaker* (item 6) passa a ser a peça central, não um complemento: ele é o que
evita a tempestade. E nem o retry nem o breaker **reduzem consumo** — que é o que faz o painel
parar de cair.

### O que reduz consumo, em ordem de retorno

**1. Cachear a leitura do operador no `requireAuth`.** Hoje `operators/{uid}` é lido **em toda
requisição autenticada** (`server/middleware/auth.js:42`). Publicar 50 produtos são 50
requisições, logo 50 leituras só para descobrir o mesmo cargo do mesmo operador. Perfil muda
raramente; um cache em memória com TTL de 5–10 min (padrão do `promptCache.js`, já existente
no projeto) elimina essa classe inteira. **É o único multiplicador de leitura sem limite que
encontrei.**

**2. Política de retenção em `generations`.** 3.158 documentos hoje, crescendo a cada geração,
sem nada que expurgue. O few-shot usa **5**; os insights usam `count()` e amostra limitada. Os
outros 3.000 só engordam a coleção. Opções na seção de perguntas.

**3. Instrumentar antes de otimizar o resto.** Não existe contador de operações do Firestore no
projeto, então ninguém sabe se a cota cai por leitura, escrita ou horário de pico — e eu não
consigo descobrir pelo código, porque depende de quantos operadores usam o painel e por quanto
tempo. Um contador em memória por rota (`reads`, `writes`, `deletes`) exposto num endpoint de
diagnóstico responde isso em um dia de uso, e custa ~40 linhas.

### O que o projeto já faz bem (não mexer)

- `insights.js` usa `count()` em vez de baixar coleção (1 leitura por 1.000 docs) e limita
  amostras de texto. Foi escrito com cota em mente.
- `promptCache` com TTL de 10 min ampara o pior caso: num lote de 50 produtos, apenas o
  primeiro paga as ~70 leituras de regras + chunks + few-shot.
- Nenhum `setInterval` no frontend — não há polling comendo cota em segundo plano.
- A feature de categorias tem `treeFingerprint`: se a árvore não mudou, o sync faz **1 leitura
  e zero escritas** em vez de regravar 206 documentos.

---

## 3. O padrão de fallback: onde é defensável e onde é armadilha

O `mockStorage` como contingência é razoável em **leitura** (mostrar dado velho é melhor que
tela quebrada) e em **escrita nova** (perder uma geração é menos grave que travar o operador).

Em **exclusão e edição**, é armadilha — e isso não é teórico: nesta semana a exclusão de
documento RAG respondia `ok: true` vindo do `catch`, o dado permanecia no Firestore e voltava
no F5. Já corrigido, com verificação pós-commit e erro explícito.

Restam três pontos com o mesmo padrão, em `knowledge.js`: `PUT /rules/:ruleId`,
`POST /rules/:ruleId/approve` e `POST /rules/:ruleId/reject` respondem
`"Regra … em contingência"` com `ok: true`. O operador aprova uma regra, a tela confirma, e no
próximo carregamento a regra volta a pendente. Mesma classe de bug, mesmo desfecho.

**Regra proposta:** contingência silenciosa só em `GET`. Toda escrita que o usuário confere
depois deve falhar em voz alta.

---

## 4. Correções ao backlog

| Item do backlog | Veredito |
|---|---|
| 6.3 — "Escrever um `README.md` (não foi encontrado)" | **Incorreto.** `README.md` existe na raiz, com visão do produto e stack. Pode ser ampliado (como rodar, variáveis, testes), mas não está ausente. |
| 2.2 — Langfuse pode não cobrir produção | **Confirmado.** `openaiClient.js` é o instrumentado; o pipeline real usa `llmService.js`, que cria o cliente OpenAI direto. Nenhuma chamada de produção aparece no Langfuse hoje. |
| 2.3 — Sem teto de lote no `/api/generate` | **Confirmado.** O backend valida apenas "array não vazio". |
| 4.1 — `{{title}}` no `FALLBACK_DEFAULT_PROMPTS` | **Confirmado**, e pior do que descrito: o botão *Copiar para Customizado* levava essas variáveis para dentro de um prompt que passa a valer de verdade. |
| 6.1 — Especificação de categorias desatualizada | **Confirmado**, e é dívida minha: o documento diz "Fase 1 implementada" quando as fases 2–5 estão no ar com testes. |
| 1.5 — Fallback duplo no `promptResolver` | **Parcialmente resolvido.** O filtro por escopo foi reescrito nesta semana (`scopeMatches`), mas segue sem teste que simule falha do Firestore. |

---

## 5. Novas oportunidades que o backlog não cobre

1. **`ReviewPanel.jsx` tem 1.094 linhas** e acumula: tabela, seleção em lote, geração, publicação,
   exportação XLSX, banner de bloqueados e agora o modal de categoria. O backlog sugere dividir;
   acrescento o motivo concreto: **não existe um único teste de frontend no projeto**, e esse
   componente concentra o fluxo que mais mexe em dado de produção (publicar no marketplace).
   Quebrar em subcomponentes é pré-requisito para testá-lo.

2. **Histórico de prompt sem tela.** As rotas `/history/:type` e `/restore` foram criadas nesta
   semana junto com a liberação da edição para todos os operadores. Sem os botões na interface,
   a rede de segurança existe mas ninguém alcança — e agora qualquer operador pode editar.
   É a lacuna mais urgente de UX.

3. **Migração de prompt legado.** Clientes com prompt salvo antes do modelo de composição
   continuam em `promptMode: 'replace'` e não têm caminho pela interface para virar `append`
   (núcleo do sistema + personalização). Ficam congelados sem melhoria do núcleo.

4. **Documento fantasma na base RAG.** `diretrizes-descricao-tecnica-easytech.md` (EASYTECH - MG)
   está com `analysisStatus: 'processing'` desde 18/08, 34.963 caracteres e **zero chunks** — um
   upload que estourou o limite de tamanho do commit antes da correção desta semana. A interface
   o exibe como se estivesse ativo. Falta um selo de "documento incompleto" quando
   `charCount > 0 && chunkCount = 0`.

5. **`global_prompts` está vazio.** A coleção existe no código como camada de fallback entre o
   prompt do cliente e o padrão embutido, mas nunca foi populada. Ou se usa (para padronizar
   uma base editável por admin sem tocar em código) ou se remove do resolver — hoje é um ramo
   morto que confunde o diagnóstico de "qual prompt está valendo".

---

## 6. Ordem sugerida

| # | Item | Por quê primeiro |
|---|---|---|
| 1 | Remover `/api/process` e arquivos órfãos | Gasto financeiro sem autenticação. Código morto: risco zero em remover. |
| 2 | Cache do operador no `requireAuth` | Único multiplicador de leitura sem limite. ~20 linhas. |
| 3 | Instrumentar contadores do Firestore | Sem isso, otimizar cota é chute. |
| 4 | Escritas em contingência falharem em voz alta | Mesma classe de bug que já mordeu esta semana. |
| 5 | Tela de histórico/restauração de prompt | A edição já está liberada; a rede de segurança precisa estar alcançável. |
| 6 | Retenção em `generations` | Cresce para sempre, hoje 3.158. |
| 7 | Circuit breaker + wrapper do Firestore | Estanca tempestade de erro, mas não reduz consumo. |
| 8 | Langfuse no `llmService` | Observabilidade de custo de LLM em produção. |
| 9 | Quebrar `ReviewPanel` + primeiros testes de frontend | Dívida estrutural; alto valor, alto esforço. |

---

## 7. Estado da implementação (decisões tomadas em 19/08/2026)

Decisões do responsável: **permanecer no plano Spark** e otimizar código · **remover** a rota
legada · retenção **preservando aprovadas/editadas**, expurgando o resto após 90 dias ·
próximo foco na **tela de histórico de prompt**.

### Entregue

| Item | Detalhe |
|---|---|
| Rota legada removida | `routes/ai.js`, `services/openaiService.js`, `services/geminiService.js`, `config/prompts.json`. **Toda rota agora exige `requireAuth`.** |
| Cache do perfil do operador | `OperatorCache` (TTL 10 min) em `middleware/auth.js`, invalidado ao mudar cargo em `routes/operators.js`. Elimina 1 leitura por requisição. |
| Medidor + disjuntor | `services/firestoreMeter.js`: conta leituras/escritas/exclusões por rota com virada de dia no fuso do Pacífico; classifica `RESOURCE_EXHAUSTED` (sem retry) vs transitório (com retry); abre disjuntor por 5 min sob cota. |
| Diagnóstico | `GET /api/diagnostics` — cota consumida, % do limite Spark, ranking de rotas, caches, alertas acionáveis. `POST /api/diagnostics/reset` zera a janela. |
| Instrumentação | `promptResolver` reporta as 5 consultas que faz (prompt, regras, chunks, few-shot, skills). |
| Retenção | `server/scripts/purgeGenerations.js` — dry-run por padrão, teto por execução, idempotente. |
| Tela de histórico de prompt | `components/PromptHistoryPanel.jsx` dentro do ConfigModal: lista versões arquivadas com autor/data/prévia, restaura versão específica ou o padrão do sistema. |

### Medição do custo de resolução de prompt

Lote de 10 produtos do mesmo cliente/tipo (EASYTECH SP, 58 chunks):

```
leituras totais: 68     (0,1% da cota diária)
  chunks   58
  regras    7
  prompt    1
  few-shot  1
  skills    1
cache de prompt: 9 hits / 1 miss
```

Só o primeiro produto paga. Um lote de 50 custa as mesmas 68 leituras. No limite de 50k/dia,
isso equivale a ~735 lotes por dia — **resolução de prompt não é a ameaça à cota.** Era a
leitura de perfil do operador, que crescia com o número de requisições, não de lotes.

### Achado novo durante a implementação

Distribuição de `generations` (3.158 documentos):

| Status | Total | % |
|---|---|---|
| `pending` | 3.085 | **97,7%** |
| `approved` | 70 | 2,2% |
| `edited` | 3 | 0,1% |
| `rejected` | 0 | 0% |

**O ciclo de aprendizado recebe 2,3% do sinal que poderia.** O few-shot dinâmico usa as 5
gerações aprovadas/editadas mais recentes por cliente e tipo — com 73 documentos aprovados
espalhados entre 6 clientes e 2 tipos, vários clientes provavelmente têm **zero** exemplo.
E `rejected: 0` sugere que ninguém usa o botão de rejeitar, então o sistema também não
aprende o que evitar.

Publicar já promove `pending → approved` automaticamente (`routes/anymarket.js`), então a
hipótese mais provável é que se gera muito mais do que se publica. Vale investigar antes de
qualquer trabalho para "melhorar a qualidade da IA": o mecanismo de aprendizado existe e está
correto, mas está faminto.

### Pendências conhecidas

- `services/openaiClient.js` (Langfuse) não é importado por ninguém — a instrumentação está
  100% inativa, não apenas incompleta. Ligar no `llmService` ou remover.
- `@google/genai` ficou órfã no `package.json` após a remoção do caminho Gemini.
- Escritas em contingência que ainda respondem `ok: true`: `PUT /rules/:ruleId`,
  `POST /rules/:ruleId/approve`, `POST /rules/:ruleId/reject` em `routes/knowledge.js`.
- Sem teto de lote no `POST /api/generate`.
- Sem caminho na interface para migrar prompt legado (`replace`) para o modo aditivo.
