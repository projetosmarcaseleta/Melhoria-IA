# Prompt de Análise e Melhorias — CRIA (Melhoria de Descrição de Produtos)

> Use este prompt para pedir a um agente (Claude Code ou outro) uma rodada de melhorias no projeto. Pode ser executado inteiro ou por seções (Firebase, Design, Funcionalidades, Reestruturação, Documentação).

## Contexto do projeto

O **CRIA** é a plataforma da Marca Seleta que usa IA generativa (OpenAI) para reescrever títulos e descrições de produtos vindos do AnyMarket, com aprendizado evolutivo a partir de feedback humano (aprovar/rejeitar/editar). Stack: React 18 + Vite + Tailwind + Zustand no frontend; Node.js/Express 5 no backend; Firebase (Auth + Firestore) como banco principal; deploy em VPS própria via PM2 (não é Firebase Hosting). Tem também uma feature mais recente e mais madura de sugestão/criação assistida de categorias no AnyMarket, com dedup, aprovação humana e lock distribuído.

O ponto de partida é: **o plano gratuito (Spark) do Firestore às vezes derruba o painel**, e além disso quero uma varredura completa de melhorias de design, UX, novas funcionalidades e organização do código.

---

## 1. Resiliência do Firebase/Firestore (prioridade alta)

O padrão atual é "fail-fast + fallback silencioso para memória" (`mockStorage.js`), sem retry/backoff — diferente do tratamento dado ao AnyMarket em `server/services/anymarketClient.js`, que já tem rate limiter, backoff exponencial com jitter e checkpoint de paginação. Isso provavelmente é a causa raiz do painel cair sob cota do Spark (`RESOURCE_EXHAUSTED`).

Peça para o agente:

1. Criar um **wrapper único de acesso ao Firestore** (ex: `server/services/firestoreClient.js`) que padronize: retry com backoff exponencial curto (2–3 tentativas) para erros transitórios (`UNAVAILABLE`, `DEADLINE_EXCEEDED`), e **sem retry** para `RESOURCE_EXHAUSTED` (cota esgotada) — nesse caso, cair no fallback imediatamente, mas **sinalizando isso**.
2. Diferenciar "cota diária esgotada" de "erro de rede transitório" em todos os pontos que hoje fazem `catch` genérico e caem silenciosamente no mock: `server/routes/clients.js`, `server/routes/knowledge.js`, `server/routes/generate.js`, `server/services/promptResolver.js`, `server/middleware/auth.js`.
3. **Corrigir inconsistência crítica**: hoje só os `GET` têm fallback gracioso; `POST`/`PATCH`/`DELETE` em `clients.js` e o upload de conhecimento em `knowledge.js` retornam 500 puro se o Firestore falhar. Ou padronizar os dois casos (com fallback + fila de retry) ou, no mínimo, dar uma mensagem de erro clara e acionável ao operador em vez de um 500 genérico.
4. **Parar de persistir "geração aprovada" só na memória sem avisar o operador**: em `generate.js`, quando a gravação em `generations` cai no mock, hoje o operador não sabe que aquilo se perde ao reiniciar o servidor e nem entra no few-shot dinâmico. Adicionar um indicador visível na UI (ex: badge "não sincronizado") quando uma operação caiu em modo de contingência.
5. Investigar o fallback duplo em `promptResolver.js`: confirmar se, quando o Firestore falha, os clientes reais realmente recebem "sem regras/skills" (silencioso) em vez das regras do cliente de teste por engano — hoje o filtro por `TEST_CLIENT_ID` dentro do fallback é sutil e merece um teste explícito.
6. Adicionar um **circuit breaker leve**: memorizar por N segundos que o Firestore está fora, para não tentar de novo a cada clique do operador durante uma indisponibilidade prolongada (evita tempestade de erros no log do PM2).
7. Adicionar **observabilidade mínima**: alerta (mesmo que só um log estruturado ou webhook simples) quando o sistema entra em modo de contingência, para alguém saber que precisa agir (upgrade de plano, aguardar reset de cota, etc.) em vez de descobrir por dado sumido.
8. Avaliar se faz sentido migrar do plano Spark para o **Blaze com orçamento/alerta de gasto configurado** (paga só o que passar da cota gratuita, evita a queda), como alternativa complementar às melhorias de código.

## 2. Segurança e limpeza de código morto (prioridade alta)

1. `server/routes/ai.js` (rota legada `POST /api/process`) está montada em `server/index.js` **antes** de qualquer `requireAuth`, aceita `geminiApiKey` no corpo da requisição sem autenticação nem isolamento por cliente. O comentário no próprio código diz "remover após migração completa do frontend" — a migração já ocorreu (frontend só chama `/api/generate`). Remover essa rota e os arquivos que só ela usa (`server/services/openaiService.js`, `server/services/geminiService.js`, `server/config/prompts.json`), ou, no mínimo, protegê-la com `requireAuth`.
2. Consolidar os **quatro caminhos paralelos de acesso a LLM** (`llmService.js`, `openaiService.js`, `openaiClient.js` com Langfuse, `geminiService.js`) em um único client instrumentado. Hoje `llmService.js` (o usado pelo pipeline real) não passa pela instrumentação Langfuse de `openaiClient.js`, então a observabilidade de custo/trace pode não estar cobrindo as chamadas de produção — verificar e corrigir.
3. Adicionar teto de tamanho de lote no lado do servidor para `POST /api/generate` (hoje só existe `CONCURRENCY = 10` no frontend; o backend aceita array de qualquer tamanho), seguindo o padrão que a feature de categorias já usa (`maxNewNodesPerApproval`, `maxAutoAttachPerBatch`).

## 3. Cobertura de testes (prioridade média-alta)

Hoje 121 testes cobrem quase só a feature de categorias e o núcleo de prompt (`outputValidator`, `promptCache`, `promptCore`). O caminho mais crítico do produto — geração de texto ponta a ponta — não tem teste nenhum. Pedir:

1. Testes para `llmService.js`, `promptResolver.js` (orquestrador de 5 camadas), `ragService.js`, `ruleExtractor.js`.
2. Pelo menos testes de integração leve (com Firestore mockado) para as rotas `generate.js`, `knowledge.js`, `feedback.js`, `clients.js`.
3. Um teste específico para o comportamento de fallback do Firestore descrito na seção 1 (simular `RESOURCE_EXHAUSTED` e verificar que o sistema sinaliza corretamente em vez de falhar silenciosamente).

## 4. Design e UX (prioridade média)

1. Corrigir a inconsistência entre `src/components/ConfigModal.jsx` (linhas do `FALLBACK_DEFAULT_PROMPTS`, que ainda usa `{{title}}`/`{{description}}` como exemplo) e a regra real documentada em `docs/GUIA_EDICAO_PROMPTS.md`, que diz explicitamente que essas variáveis não são substituídas. Isso confunde o operador exatamente no cenário em que o backend está fora (quando o fallback aparece).
2. Levar o log de auditoria do fluxo principal de título/descrição (hoje só em `localStorage` via Zustand em `LogEntry.jsx`) para uma coleção server-side, como já foi feito para categorias (`category_attachments`) — a própria documentação de categorias já reconhece que log local "não serve como auditoria".
3. Revisar `ReviewPanel.jsx` (1094 linhas, o maior componente do projeto) quanto a oportunidades de quebrar em subcomponentes menores, isolando: tabela de revisão, controles de lote, exportação XLSX, e o modal de categoria — vai facilitar manutenção e testes de UI.
4. Avaliar indicadores visuais de estado do sistema no header/dashboard: "Firestore OK / em contingência", contagem de operações não sincronizadas, e algum aviso proativo quando a cota estiver perto do limite (se a API do Firebase expuser isso, ou por contagem própria de operações/dia).
5. Revisar acessibilidade e responsividade das telas principais (ConfigModal, KnowledgeManager, ReviewPanel) — não foi avaliado a fundo na análise inicial, vale um passe dedicado.

## 5. Novas funcionalidades a considerar (prioridade média)

1. Onboarding de operador: hoje a criação do primeiro admin é 100% manual via `server/scripts/createOperator.js` (CLI). Avaliar uma tela de convite/primeiro-acesso, mesmo que simples.
2. Retomar e decidir o destino de `docs/ESPECIFICACAO_BASE_CONHECIMENTO_MULTI_CLIENTE.md` — especifica endpoints (`/analyze`, `/reanalyze`, `/validate-preview`) e um fluxo de `analysisStatus`/detecção de conflitos que **não existem no código ainda**. Confirmar com você se é a próxima entrega ou um rascunho já superado, antes de qualquer trabalho nessa frente.
3. Dashboard de métricas de aprovação/rejeição por cliente (a rota `insights.js` já calcula parte disso) — expor de forma mais visual, já que o projeto usa IA para autorrefinar prompt e isso merece visibilidade para o operador confiar no processo.

## 6. Reestruturação e documentação (prioridade média-baixa)

1. Atualizar `docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md`, que descreve "Fase 1 implementada, Fases 2–5 pendentes" — o código já entrega tudo isso, com testes. A doc subestima o que já foi feito; atualizar para refletir o estado real evita retrabalho.
2. Decidir o destino do arquivo solto `teste.md` na raiz — não tem relação com o restante do projeto (parece um prompt de outra sessão/ferramenta sobre modelagem de schema do AnyMarket) e não é referenciado em lugar nenhum. Mover para `docs/` se for material de referência válido, ou remover se for lixo de sessão.
3. Escrever um `README.md` na raiz (não foi encontrado) com: como rodar localmente, variáveis de ambiente necessárias (Firebase, OpenAI), como rodar os testes, e um diagrama simples do pipeline de geração — hoje esse conhecimento só existe espalhado entre `AGENTS.md` e os docs internos.

---

## Como pedir a execução

Ao entregar este prompt a um agente, você pode:
- Pedir para ele **priorizar a seção 1 (Firebase) primeiro**, já que é o problema que motivou a análise, e tratar as demais seções como um backlog.
- Pedir um **plano** antes de qualquer código (o agente deve usar modo de planejamento), especialmente para a seção 1, já que mexe em código usado por quase todas as rotas.
- Pedir que cada mudança de resiliência do Firebase venha acompanhada do teste correspondente (seção 3).
