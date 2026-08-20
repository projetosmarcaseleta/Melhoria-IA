# Alterações — Vínculo de categoria por canal (de-para) e atributos

> Registro do que foi implementado a partir de `docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md`.
> Data: 19–20/08/2026. Escopo: backend, frontend, testes e documentação.
> Estado: **189 testes passando, build ok, validado contra conta real em modo leitura e em
> ensaio de escrita (`ANYMARKET_DRY_RUN`). A gravação real do de-para ainda não foi executada.**

---

## 1. O que a feature entrega

Categoria criada no AnyMarket **nasce sem de-para de canal**, e sem esse vínculo o produto não
publica em nenhum marketplace. Antes, resolver isso era trabalho manual no painel da AnyMarket.
Agora:

1. O CRIA **detecta**, canal por canal, se a categoria tem de-para.
2. O CRIA **decide** o destino em cada canal — sugestão da AnyMarket quando existe, senão busca
   na árvore nativa do canal com matcher determinístico + IA para o que é semântico.
3. O operador **confirma uma vez**, para todos os canais.
4. Depois do vínculo, a etapa de **atributos** mostra o que cada canal exige (a obrigatoriedade
   varia por marketplace) e grava os valores no produto.

O fluxo manual (navegar a árvore do canal) continua disponível, mas como **ajuste** de um canal
específico — não como caminho principal.

### Onde aparece na interface

No modal 🗂️ **Categoria** de um produto:

- depois de aplicar a categoria (fase `done`);
- ou pelo botão **"Canais e atributos"**, quando a categoria já está correta e nada será escrito.

```
Vínculo proposto pelo CRIA · ACESSÓRIO E KIT REVISÃO › Acessórios › Tapetes

☑ Amazon Global Api   ✓ nome idêntico   Casa > Decoração para Casa > Tapetes… (100%)
☑ Mercado Livre       ✓ nome idêntico   Acessórios para Veículos > … > Interior > Tapetes (100%)
☐ Shopee              ⚠ confira         Casa e Decoração > Decoração > Carpetes e Tapetes (14%)
  Nuvemshop           ✕ sem equivalente
  Magazine Luiza      ✕ o canal recusou a operação

                                              [ Confirmar e vincular (2) ]
```

Regra da tela: **nome idêntico vem marcado; proposta duvidosa vem desmarcada; sem equivalente não
é oferecida.** Cada linha tem "como decidiu", com o caminho percorrido e as alternativas.

---

## 2. Arquivos

### Novos — backend

| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `server/services/channelBindClient.js` | 660 | Único módulo que fala com a API interna do painel (`/rest/api`) e com os endpoints v2 desta feature. Normalizadores defensivos, validação dos ids que entram na URL, classificação de erro (token expirado, token errado, contrato mudado, erro do canal). |
| `server/services/channelBindService.js` | 931 | Orquestração: status do de-para, sugestões, drill-down, aplicação sob lock com diário de transação, proposta automática (`proposeBindings`), aplicação em lote (`applyBindingsBatch`), varredura de transmissões. |
| `server/services/channelBindResolver.js` | 529 | A **decisão**: pontuação de candidatos, busca na árvore do canal com backtracking, desempate por IA, cálculo de confiança. Não faz I/O — recebe `fetchLevel` injetado. |
| `server/services/categoryAttributesService.js` | 446 | Atributos por canal: cache em memória + espelho no Firestore, obrigatoriedade por marketplace, validação por produto, montagem do PATCH. |
| `server/routes/channelBinding.js` | 250 | Rotas do vínculo, sob `requireAuth`. |
| `server/routes/categoryAttributes.js` | 101 | Rotas dos atributos, sob `requireAuth`. |

### Novos — frontend

| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `src/components/ChannelBindingPanel.jsx` | 996 | Painel de canais e atributos: proposta automática com confirmação única, ajuste manual por canal, formulário de atributos. |
| `src/services/channelBindingService.js` | 134 | Chamadas HTTP da feature. O token do AnyMarket nunca sai do frontend — o backend resolve pelo `clientId`. |

### Novos — testes

| Arquivo | Casos | Cobre |
|---|---|---|
| `server/tests/channelBind.test.js` | ~50 | Normalização dos payloads (com corpos REAIS capturados), conversão de `completePath`, validação de ids, transação de duas etapas, degradação quando o painel não responde, lock, classificação de transmissões, atributos por canal. |
| `server/tests/channelBindResolver.test.js` | 17 | Pontuação, ambiguidade, descida com backtracking, parada correta, recusa na raiz, sugestão da AnyMarket. Cada caso reproduz um erro que apareceu contra a árvore real. |

### Alterados

| Arquivo | Alteração |
|---|---|
| `server/services/anymarketClient.js` | Parâmetro `baseUrl` (painel herda rate limit/retry/desaceleração por 429); parâmetro `maxRetries` por chamada; `AnymarketApiError` passou a **preservar `code`**; `extractItems` aprendeu o dialeto `values` do painel. |
| `server/services/mockStorage.js` | Dados e estado da conta de teste para canais: árvore falsa por canal, sugestões, características, vínculos e diário de intenções (com merge, igual ao Firestore). |
| `server/routes/clients.js` | Campos novos aceitos: `anymarket_panel_token` e `marketplaces`. |
| `server/index.js` | Registro de `/api/channel-bindings` e `/api/category-attributes`. |
| `src/components/CategoryModal.jsx` | Painel de canais após aplicar a categoria; botão "Canais e atributos"; rodapé das novas fases; texto que mandava configurar o de-para à mão foi atualizado. |
| `src/components/ConfigModal.jsx` | Campo **Token do painel**, separado do token de API, com aviso de que expira. Salva os dois no mesmo PATCH. |
| `docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md` | Correção da premissa da §0 (dois tokens) + §6 (estado), §7 (validação real) e §8 (vínculo automático). |
| `docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md` | Link cruzado para esta fase do roadmap. |

> `server/routes/prompts.js` e `src/components/AdminPanel.jsx` também aparecem como modificados
> no `git status`, mas **já estavam assim antes** deste trabalho — não foram tocados aqui.

---

## 3. Endpoints HTTP novos

Todos sob `requireAuth`. O token do AnyMarket nunca vem no corpo da requisição.

### Vínculo de canal — `/api/channel-bindings`

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/propose` | **Principal.** Resolve o de-para de todos os canais pendentes e devolve propostas com confiança, origem e rastro. Não escreve. |
| `POST` | `/apply-batch` | Aplica as propostas confirmadas. Responde **207** quando parte aplica e parte falha. |
| `GET` | `/status/:clientId/:categoryId` | Estado canal por canal, conferido no hub. Degrada para o espelho local quando o painel não responde. |
| `GET` | `/suggestions/:clientId/:categoryId/:marketplace` | Sugestões da AnyMarket. |
| `GET` | `/tree/:clientId/:marketplace?code=&account=` | Um nível da árvore nativa do canal. |
| `POST` | `/apply` | Aplica UM vínculo (ajuste manual). |
| `GET` | `/marketplaces/:clientId` | Canais do cliente (da conta, via painel; cadastro como reserva). |
| `GET` | `/catalog/:clientId` | Catálogo dos 148 canais da plataforma (`/v2/marketplaces`). |
| `GET` | `/mirror/:clientId/:categoryId` | Só o espelho local, sem ir ao painel. |
| `GET` | `/pending/:clientId` | Transmissões não publicadas, agrupadas por causa provável. |

### Atributos — `/api/category-attributes`

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/:clientId/:categoryId?marketplace=&withValues=&refresh=` | Atributos da categoria, opcionalmente por canal. |
| `GET` | `/product/:clientId/:productId?categoryId=&marketplaces=` | O que falta preencher no produto, canal por canal. |
| `PATCH` | `/product/:clientId/:productId` | Grava valores (`updates: [{ name, value }]`). |

---

## 4. Descobertas sobre a API da AnyMarket

Tudo medido contra conta real. A especificação original errava em pontos que mudaram a implementação.

### 4.1 São DOIS tokens, não intercambiáveis

| Token | Formato | Serve para | No outro host |
|---|---|---|---|
| Token de API | `base64.assinatura` | `api.anymarket.com.br/v2` | painel → 500 genérico em qualquer caminho |
| Token do painel | `259…L…E…C…O….I` | `app.anymarket.com.br/rest/api` | v2 → 401 `"User not registered"` |

Ambos no header `gumgaToken`; `Authorization: Bearer` é recusado pelos dois. O token do painel é
de **sessão e expira** — quando vence: `403 {"response":"TOKEN_EXPIRED"}`. Isso contradiz a §0 da
especificação, que afirmava que o token público abria os endpoints internos.

### 4.2 Endpoints novos, não previstos na especificação

- `GET /v2/marketplaces` — catálogo de **148 canais** `{code, name}` (público).
- `GET /rest/api/marketplaces` — **canais ativos da conta** (array de strings). Substituiu a
  lista configurada à mão como fonte primária.
- `GET /rest/api/marketplaces/accounts` — contas por canal `[{id, name, marketplace, accountDefault}]`.

### 4.3 Formatos que obrigaram a mudar código

| Observado | Consequência |
|---|---|
| `completePath` dos **filhos** vem `null` (só o nó aberto e o breadcrumb trazem) | O caminho do filho é **derivado** do breadcrumb; sem isso o PUT iria com o campo vazio |
| `canBeSelected` só existe no nível atual, e **não** é sinônimo de folha | O botão de vincular fica no nó aberto; filhos são navegação |
| `removed` vem `null`, não `false`, quando o vínculo está ativo | Coberto por teste com payload real |
| `accountIdentifier` por vínculo (Nuvemshop `202`, Shopee `1974`) | Preservado na normalização e enviado no PUT |
| Shopee/Nuvemshop **exigem** `accountIdentifier` na árvore (`500 "Cannot parse null string"`) | Conta resolvida uma vez por proposta e propagada |
| Sugestões vêm em `{ suggestions: [...] }` e podem passar de 25s | Desembrulho explícito + timeout próprio de 90s |
| Paginação do painel usa `{pageSize, count, start, values[]}` | `extractItems` aprendeu `values` |
| `500 {code:"MarketPlaceIntegrationException"}` | Erro do CANAL, não do CRIA: código próprio, não aborta os outros canais |
| `GET /v2/marketplaces/{code}` → `500 "restricted for ANYMARKET use"` | Só a listagem é liberada |
| `/v2/categories/characteristics/groups` → `totalElements: 0` nesta conta | Formato dos atributos segue **não confirmado** |

---

## 5. Decisões de projeto

**Isolamento do caminho frágil.** Nenhum módulo além de `channelBindClient.js` chama `/rest/api`.
Se a AnyMarket publicar uma versão oficial, o conserto é em um arquivo.

**Transação de duas etapas com diário** (responde a pergunta aberta da §5 da especificação).
`applyBinding` grava a intenção em `channel_bind_intents/{categoryId}_{marketplace}` **antes** da
chamada destrutiva (`cleanBoundAttributes`). Fases: `cleaning` → `attributes_cleaned` → apagada.
Parar no meio devolve `code: 'bind_failed_after_clean'` com `detail.retrySafe: true`, e o retry
**não repete a limpeza** — desde que sejam a mesma categoria, canal, código e dentro de 10 min.
Falha na própria limpeza apaga a intenção (nada foi destruído).

**Falha do Firestore é visível, nunca silenciosa.** O espelho é cache/auditoria; perdê-lo não
derruba o vínculo, mas sobe `degraded: true` até a tela.

**Degradação em vez de tela de erro.** Sem token do painel (ou expirado), `GET /status` devolve o
último estado conhecido com `hubUnavailable: true`, `canBindHere: false` e **`checkedAt: null`** —
nunca finge que conferiu agora. A UI então orienta a resolver no painel.

**Decisão auditável.** Toda proposta carrega o `trail`: por qual ramo desceu, com que score, quais
eram as alternativas e onde voltou atrás. É o que torna a confirmação informada.

**Determinístico antes de IA.** O matcher resolve os níveis fáceis; a IA entra onde o texto não
decide. A pergunta ao modelo é de **navegação** ("por qual ramo se chega até o alvo?"), não de
escolha final — perguntar "qual destes é a categoria?" fazia o modelo responder "nenhum" nos
níveis intermediários, que era tecnicamente correto e inútil.

**Cada canal é uma transação independente** no lote: um que falhe não desfaz nem impede os
outros, e a resposta lista aplicados e falhados em separado.

---

## 6. Bugs corrigidos (encontrados pela execução real)

1. **Containment dando falsa certeza** — "Chave de Roda" casou 1.0 com "Rodas" e saiu como
   correspondência exata. Chave de roda é ferramenta, roda é peça. Troca de `scoreNames` por
   `scoreForReuse`: a mesma decisão, pelo mesmo motivo, que `categoryMatcher.js` já havia tomado
   para reuso de categoria ("Panelas" ⊂ "Panelas de Pressão").
2. **Corte de candidatos escondendo a resposta** — mandar ao LLM só os 10 melhores por score
   textual descartava o ramo certo antes de alguém poder escolhê-lo. Agora vão todos (teto 80).
3. **Parada precoce** — a busca parava num nó vinculável ruim quando "nenhum filho melhora o
   score", e "Tapetes" estava sob "Interior" (que não casa por texto com nada).
4. **Beco sem saída sem volta** — sem backtracking, "Macacos" parava em `Peças de Carros e
   Caminhonetes` (24%) em vez de `Ferramentas para Veículos > Elevação > Macacos` (100%).
5. **Recusa na raiz abortava a busca** — a raiz cobre o catálogo inteiro do marketplace; recusar
   ali é leitura errada do modelo, não resposta.
6. **Propor qualquer coisa** — para "Chaveiros" a busca terminava oferecendo "Agro" com selo de
   "confira". Agora devolve **não resolvido** com o palpite de lado.
7. **Lock com falso "ocupado"** — `acquireLock` tratava qualquer falha do Firestore fora de uma
   lista de casos conhecidos como "lock ocupado": sem credencial (`Unable to detect a Project Id`)
   o vínculo respondia *"Outro processo já está vinculando"*, falso e sem saída. Agora só
   `ALREADY_EXISTS` (gRPC 6) é lock; o resto degrada com aviso.
8. **`AnymarketApiError` descartava `code`** — bug pré-existente: o campo já era passado por
   chamadores (inclusive o `token_missing` do fluxo antigo de categorias) e chegava `null` na
   resposta HTTP, então a UI não conseguia escolher o botão certo.
9. **Retry inútil no painel** — três tentativas para um 500 sistemático. Agora `maxRetries: 1`.
10. **Mock divergindo do Firestore** — `saveMockBindIntent` substituía o documento em vez de fazer
    merge, e o retry repetia a limpeza só no ambiente de teste: divergência exatamente no caso que
    a especificação pede para acertar.

---

## 7. Configuração

### Por cliente, em `clients/{id}`

| Campo | Uso |
|---|---|
| `anymarket_token` | API v2 (já existia) |
| `anymarket_panel_token` | **Novo.** API interna do painel. Expira — editável em ⚙️ Configurações |
| `marketplaces` | **Novo.** Reserva para quando o painel não responder |

### Variáveis de ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `ANYMARKET_PANEL_API_URL` | `https://app.anymarket.com.br/rest/api` | Host da API do painel |
| `ANYMARKET_PANEL_TOKEN` | — | Token do painel para desenvolvimento |
| `ANYMARKET_MARKETPLACES` | — | Canais quando não há painel nem cadastro |
| `ANYMARKET_SUGGESTIONS_TIMEOUT_MS` | 90000 | Sugestões são lentas em categoria grande |
| `ANYMARKET_ATTRS_PAGE_SIZE` / `_MAX_PAGES` | 50 / 200 | Paginação das características |
| `ANYMARKET_TRANSMISSIONS_PAGE_SIZE` / `_MAX_PAGES` | 100 / 20 | Paginação das transmissões |
| `ANYMARKET_BIND_MIN_SUGGESTION` | 50 | Confiança mínima (0–100) para aceitar a sugestão da AnyMarket |
| `ANYMARKET_BIND_MIN_SCORE` | 0.5 | Piso do score textual para seguir sem IA |
| `ANYMARKET_BIND_LOW_CONFIDENCE` | 0.65 | Abaixo disto a proposta vem desmarcada |
| `ANYMARKET_BIND_AMBIGUITY_GAP` | 0.1 | Diferença entre 1º e 2º que aciona a IA |
| `ANYMARKET_BIND_MAX_BACKTRACKS` | 2 | Orçamento de voltas por canal |
| `ANYMARKET_BIND_MAX_DEPTH` | 8 | Profundidade máxima |
| `ANYMARKET_BIND_LLM_CANDIDATES` | 80 | Teto de ramos enviados à IA por nível |

`ANYMARKET_DRY_RUN=true` cobre também `cleanBoundAttributes`, o PUT do vínculo e o PATCH de
atributos — dá para ensaiar o fluxo inteiro sem escrever nada.

### Coleções novas no Firestore

- `clients/{id}/channel_category_bindings/{categoryId}_{marketplace}` — espelho do de-para.
- `clients/{id}/channel_bind_intents/{categoryId}_{marketplace}` — diário da transação.
- `clients/{id}/channel_bind_locks/{categoryId}_{marketplace}` — exclusão mútua.
- `clients/{id}/category_attributes_cache/{categoryId}` — cache de atributos.
- `clients/{id}/product_attribute_values/{productId}` — valores gravados.

---

## 8. Códigos de erro e o que o operador faz

| `code` | Significado | Ação |
|---|---|---|
| `panel_token_missing` | Cliente sem token do painel | Salvar em ⚙️ Configurações → Token do painel |
| `panel_token_expired` | Token de sessão venceu (mais comum) | Capturar um novo no painel e salvar |
| `panel_token_unsupported` | Token do tipo errado no campo | Conferir se não colou o token de API |
| `internal_contract_changed` | AnyMarket mudou a API não documentada | Resolver no painel e avisar o time |
| `marketplace_integration_error` | O canal recusou a operação | Problema do canal/AnyMarket; os outros seguem |
| `bind_failed_after_clean` | Limpeza feita, vínculo não gravado | Clicar de novo — o retry não repete a limpeza |
| `dry_run_category` | Categoria criada em modo simulado | Criar a categoria de verdade antes de vincular |

---

## 9. Testes

`npm test` → **189 casos, todos passando** (eram 156 antes desta feature).

O que é coberto sem rede: normalizadores com payloads reais capturados, conversão de `completePath`,
validação dos ids, a transação de duas etapas com o retry seguro, degradação sem painel, o lock,
obrigatoriedade por canal, montagem do PATCH, e a mecânica completa da busca (descer, voltar,
parar, recusar). A IA é injetada nos testes de busca — teste de mecânica não deve depender do humor
de um modelo.

Validação contra conta real (fora da suíte, com script): leitura de tudo confirmada; fluxo
automático de ponta a ponta com o corpo do PUT conferido em `ANYMARKET_DRY_RUN`.

---

## 10. Pendências

1. **Executar a gravação real do de-para.** Todo o resto foi validado; falta rodar numa categoria
   de teste com o dry-run desligado, porque a primeira chamada é destrutiva.
2. **Cadastrar o token do painel** por cliente — e resolver a renovação: é token de sessão,
   capturado à mão no DevTools. Vale perguntar ao suporte da AnyMarket se existe token de API com
   escopo de painel.
3. **Confirmar o formato dos atributos** — a conta testada tem zero grupos de características, e o
   `characteristics[]` do produto lido estava ausente.
4. **Aprender com a correção do operador.** Quando ele ajusta um canal na mão, isso deveria
   alimentar as próximas propostas (mesmo espírito do few-shot que a criação de categoria já usa).
   Hoje só fica registrado `source: 'manual'`.
5. **Proposta em lote por vários produtos/categorias** — hoje é por categoria.
6. **Magazine Luiza** recusa a árvore com erro interno da própria AnyMarket; nada a fazer do lado
   do CRIA além de reportar por canal, que já acontece.
7. **Commitar** — 13 arquivos novos e 8 alterados, nada versionado ainda.
