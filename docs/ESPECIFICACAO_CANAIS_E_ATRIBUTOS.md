# Especificação — Vínculo de Categoria por Canal (De-Para) e Atributos

> Continuação de `docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md`. Endpoints confirmados por documentação pública da AnyMarket e por engenharia reversa do painel (DevTools), autenticados com o mesmo `gumgaToken` já usado em `anymarketClient.js` — **confirmado que o token público funciona nos endpoints internos**, então toda a automação abaixo é viável direto do backend do CRIA, sem depender de cookie de sessão.


> ⚠ **CORREÇÃO (19/08/2026, medido contra conta real):** a §1 funciona, mas **não com o token que a frase acima supõe**.
> São **dois tokens diferentes e não intercambiáveis**:
>
> | Token | Formato | Serve para | No outro host |
> |---|---|---|---|
> | Token de API | `base64.assinatura` | `api.anymarket.com.br/v2` | painel → 500 genérico |
> | Token do painel | `259…L…E…C…O….I` | `app.anymarket.com.br/rest/api` | v2 → 401 "User not registered" |
>
> Os dois vão no header `gumgaToken` (`Authorization: Bearer` é recusado por ambos). O token do painel é de **sessão e
> expira** — quando vence, o painel responde `403 TOKEN_EXPIRED`. Toda a automação da §1 é viável, desde que o token do
> painel esteja cadastrado e válido. Payloads reais e o que mudou na implementação: §7.

## 0. Nível de confiança dos endpoints

| Fonte | Estabilidade | Endpoints |
|---|---|---|
| API pública documentada | Alta — contrato estável | `/v2/transmissions*`, `/v2/categories/characteristics/groups`, `/v2/products/{id}` |
| API interna do painel (`app.anymarket.com.br/rest/api`), engenharia reversa | **Baixa — sem contrato, pode mudar sem aviso** | Todos os endpoints de `bind` de categoria por canal (seção 1) |

Tratar os endpoints da seção 1 como **acoplamento frágil**: encapsular tudo num módulo isolado (`channelBindClient.js`), nunca espalhar chamadas diretas pelo código, e ter monitoramento de erro específico para detectar rapidamente se a AnyMarket mudar o contrato. Vale abrir um chamado com o suporte da AnyMarket perguntando se existe/vai existir uma versão pública oficial disso.

## 1. Vínculo de categoria por canal (de-para)

Dois identificadores cruzam todas as chamadas:
- `anymarketCategoryId` — id numérico da categoria no hub (o mesmo `anymarketId` já usado em `clients/{id}/anymarket_categories`).
- `codeInMarketPlace` — código da categoria no marketplace de destino (ex.: `MLB63512` no Mercado Livre).

### 1.1 Ler vínculos existentes de uma categoria
```
GET /rest/api/categories/{anymarketCategoryId}
```
Resposta traz `marketPlaces: [{ marketPlace, codeInMarketPlace, removed, ... }]` — um array com o de-para atual em cada canal. **Esta é a chamada a usar para validação** (pergunta original do usuário: "verificar se estão vinculadas").

### 1.2 Detectar pendências em lote (sem precisar checar categoria por categoria)
Via API pública, já documentada anteriormente:
```
GET /v2/transmissions?statusFilter=UNPUBLISHED
```
Usar como sinal em lote de produtos com problema de publicação (categoria sem de-para é uma das causas). Complementar com 1.1 por categoria quando for preciso uma checagem determinística antes de aprovar/exibir na UI.

### 1.3 Sugestões automáticas de vínculo
```
GET /rest/api/categories/bind/{MARKETPLACE}/suggestions/{anymarketCategoryId}
```
Retorna candidatos com `percentage` de confiança (ex.: 66.67%). Útil para pré-preencher a UI de vínculo, no mesmo espírito do funil de sugestão já usado para criação de categoria (`categoryMatcher.js`).

### 1.4 Navegar a árvore nativa do canal (quando o operador quer escolher manualmente, não usar sugestão)
```
GET /rest/api/marketplaces/{MARKETPLACE}/categories                          # raiz
GET /rest/api/marketplaces/{MARKETPLACE}/categories/{codeInMarketPlace}      # drill-down
```
Cada nível retorna `childs[]`, `path[]` (breadcrumb) e `canBeSelected` (true = é folha, pode vincular). `completePath` nesse endpoint usa `/` como separador — **atenção, é diferente do separador usado no PUT de vínculo (ver 1.5)**.

### 1.5 Salvar o vínculo — duas chamadas em sequência, sempre nesta ordem
```
PUT /rest/api/categories/bind/{MARKETPLACE}/cleanBoundAttributes/{anymarketCategoryId}   # corpo vazio
PUT /rest/api/categories/{anymarketCategoryId}/marketplaces/{MARKETPLACE}?suggestionAccepted={true|false}
```
Body da segunda chamada:
```json
{
  "marketPlace": "MERCADO_LIVRE",
  "codeInMarketPlace": "MLB63512",
  "completePath": "Categoria A > Categoria B > Categoria C",
  "removed": false,
  "properties": { "bindIndex": "0" }
}
```
Pontos de atenção para a implementação:
- `completePath` aqui usa `>` (espaço-maior-espaço) — **montar essa string convertendo o `/` que vem do drill-down (1.4)**, não reaproveitar direto.
- `suggestionAccepted: true` quando o vínculo veio de 1.3, `false` quando foi escolha manual via 1.4 — registrar essa origem ajuda a medir a qualidade das sugestões depois (mesmo padrão de métrica que a feature de categoria já tem via `Insights`).
- `cleanBoundAttributes` parece necessário inclusive em re-vínculo (trocar o de-para de uma categoria já vinculada) — sempre chamar antes do PUT principal, mesmo em criação nova.
- Tratar como transação de duas etapas: se 5a (`cleanBoundAttributes`) suceder e 5b falhar, a categoria fica com atributos limpos mas sem vínculo novo — decidir se isso precisa de um mecanismo de compensação/retry ou se é aceitável pedir para o operador tentar de novo.

## 2. Atributos de categoria (obrigatórios/opcionais)

Via API pública, sem necessidade de engenharia reversa:
```
GET /v2/categories/characteristics/groups?limit=50&offset=0
```
- `characteristicItemMarketPlaces[]` traz `required: true/false` **por canal**, confirmando que a obrigatoriedade varia por marketplace mesmo para a mesma categoria do hub.
- Tipos de dado: `TEXT`, `NUMBER`, `LIST`, `BOOLEAN`. Para `LIST`, os valores possíveis vêm de `/v2/variations/{typeId}/values`.
- Leitura de valores já preenchidos num produto: `characteristics[]` dentro de `GET /v2/products/{id}`.
- Gravação: `PATCH /v2/products/{id}` com `characteristics: [{ index, name, value }]`.
- Validação condicional (ex.: atributo B só obrigatório se A = X) não é exposta pela API — é resolvida pelo validador do marketplace na fila de transmissão. O CRIA só pode validar a obrigatoriedade estática (`required`); a condicional só aparece como erro depois, via `transmissionMessage`.
- Detecção em lote de atributo obrigatório faltando: mesmo endpoint de transmissões (`GET /v2/transmissions?statusFilter=UNPUBLISHED`), inspecionando `transmissionMessage`.

## 3. Modelagem de dados proposta

Novas coleções, seguindo o padrão de `clients/{id}/anymarket_categories`:

**`clients/{id}/channel_category_bindings/{anymarketCategoryId}_{marketplace}`**
```js
{
  anymarketCategoryId, marketplace, codeInMarketPlace, completePath,
  suggestionAccepted, source: 'suggestion' | 'manual',
  boundBy, boundAt, removed,
  lastCheckedAt,          // última vez que 1.1 confirmou o vínculo
  lastTransmissionError,  // último erro relevante visto via 2, se houver
}
```

**`clients/{id}/category_attributes_cache/{anymarketCategoryId}`** (cache do `/v2/categories/characteristics/groups`, para não bater na API a cada render da tela)
```js
{
  anymarketCategoryId,
  attributesByMarketplace: {
    MERCADO_LIVRE: [{ id, name, idInMarketplace, required, valueType, allowedValues }],
    MAGAZINE_LUIZA: [...],
  },
  syncedAt,
}
```

**`clients/{id}/product_attribute_values/{productId}`** (o que já foi preenchido, espelhando `characteristics[]` do produto)

Reaproveitar para todas essas coleções o wrapper de resiliência do Firestore já pedido na análise anterior (retry/backoff para erro transitório, sinalização visível quando cair em contingência) — não repetir o padrão de fallback silencioso.

## 4. Plano de implementação (ordem sugerida)

1. `server/services/channelBindClient.js` — client isolado para os endpoints da seção 1 (interno, frágil) e seção 2 (público, estável), com rate limit/retry no mesmo padrão de `anymarketClient.js`.
2. `server/services/channelBindService.js` — orquestra: validar vínculo (1.1), sugerir (1.3), aplicar vínculo (1.5 com as duas chamadas em sequência), tudo com lock distribuído por `anymarketCategoryId+marketplace` (mesmo padrão de `category_locks`).
3. `server/services/categoryAttributesService.js` — cache de atributos (2) e validação de obrigatórios faltando por produto/categoria/canal.
4. Rotas novas em `server/routes/` (ex. `channelBinding.js`, `categoryAttributes.js`) protegidas por `requireAuth`.
5. UI: estender `CategoryModal.jsx` com uma aba/etapa "Canais" mostrando, por marketplace ativo, se está vinculado (com badge) e botão "Vincular" que abre um sub-fluxo (sugestões da 1.3 primeiro, drill-down manual da 1.4 como alternativa). Depois do vínculo, uma segunda etapa "Atributos" com formulário dos `required: true` primeiro, opcionais depois (colapsáveis).
6. Testes: mockar as respostas de `channelBindClient.js` e cobrir o fluxo de "cleanBoundAttributes sucede, bind falha" (ponto de atenção da seção 1.5), e a lógica de obrigatoriedade variável por canal (seção 2).
7. Atualizar esta doc e `docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md` linkando uma na outra como fases seguintes do mesmo roadmap.

## 5. Perguntas ainda em aberto (não bloqueantes, mas valem confirmação)

- O que fazer quando `cleanBoundAttributes` sucede e o PUT principal falha (rede caiu no meio) — vale registrar isso no Firestore antes de disparar a segunda chamada, para permitir retry seguro sem duplicar `cleanBoundAttributes` desnecessariamente?
- Confirmar com o suporte da AnyMarket se existe (ou está nos planos) uma versão pública oficial da seção 1 — decide se vale investir em resiliência extra ou torcer para eles publicarem algo estável.

---

## 6. Estado da implementação (2026-08-19)

> Esta seção descreve o desenho; a **§7 é posterior e manda** onde as duas divergirem — ela traz o que a conta real
> mostrou (dois tokens, payloads de verdade, bugs corrigidos). Em especial: os canais a checar vêm da conta pelo painel,
> não da lista configurada à mão.

Implementado conforme o plano da §4. Nada aqui foi validado contra uma conta real da AnyMarket ainda — ver §7.

| Camada | Arquivo | Cobre |
|---|---|---|
| Client isolado | `server/services/channelBindClient.js` | §1 (painel, frágil) e §2 (v2, estável) |
| Orquestração do vínculo | `server/services/channelBindService.js` | §1.1, §1.2, §1.3, §1.4, §1.5 + lock + diário da transação |
| Atributos | `server/services/categoryAttributesService.js` | §2 + cache em memória e no Firestore |
| Rotas | `server/routes/channelBinding.js`, `server/routes/categoryAttributes.js` | §4.4, sob `requireAuth` |
| UI | `src/components/ChannelBindingPanel.jsx` (usado por `CategoryModal.jsx`) | §4.5 — etapa Canais e etapa Atributos |
| Testes | `server/tests/channelBind.test.js` | §6 — 35 casos, incluindo os dois exigidos |

### Decisões tomadas

**Nenhum módulo além do `channelBindClient.js` chama `/rest/api`.** Erro nos endpoints internos volta marcado com
`internalApi: true`; 400/404/405/410/415 viram `code: 'internal_contract_changed'` e log com prefixo próprio
(`[ChannelBindClient] ⚠ CONTRATO INTERNO`), e a UI orienta a resolver no painel em vez de mostrar "erro interno".
É o monitoramento pedido na §0.

**Painel e v2 dividem a mesma fila de rate limit** (`anymarketRequest` ganhou o parâmetro `baseUrl`). A cota é do
mesmo `gumgaToken`, então herdar retry, backoff e desaceleração por 429 é o comportamento correto.

**`completePath` é convertido, nunca repassado** (`toBindCompletePath`): "/" do drill-down → " > " do PUT. A função é
idempotente porque o valor chega de três origens (sugestão, drill-down, re-vínculo).

**Vínculo com `removed: true` conta como NÃO vinculado.** O painel mantém o vínculo desfeito no array; tratá-lo como
válido diria "pode publicar" para uma categoria que vai falhar na transmissão.

**Ids validados antes de entrar na URL.** Canal, id de categoria e código do marketplace passam por regex. Categoria
criada com `ANYMARKET_DRY_RUN` é recusada explicitamente — id fictício daria 404 do painel e pareceria contrato quebrado.

**A obrigatoriedade condicional não é prometida.** A resposta de validação de produto carrega um campo `caveat` dizendo
que só a obrigatoriedade estática é verificável — o resto só aparece como erro de transmissão.

**Grupo de características sem categoria não é espalhado para todas as categorias.** Vira contagem `unlinkedGroups`.
Inventar esse vínculo produziria "atributo obrigatório faltando" em categoria que não tem o atributo.

### Resposta à pergunta 1 da §5 (transação de duas etapas)

Sim, vale registrar antes — e é o que foi feito. `applyBinding` grava a intenção em
`clients/{id}/channel_bind_intents/{categoryId}_{marketplace}` com uma fase:

1. `cleaning` — antes de qualquer escrita no AnyMarket;
2. `attributes_cleaned` — a metade destrutiva aconteceu;
3. intenção apagada — transação completa.

Parar em (2) devolve `code: 'bind_failed_after_clean'` com `detail.retrySafe: true` e uma mensagem que diz que a
categoria está sem vínculo neste canal. O retry lê a intenção e **pula** `cleanBoundAttributes` — desde que sejam a
mesma categoria, o mesmo canal, o mesmo `codeInMarketPlace` e dentro de 10 minutos (`canSkipClean`). Trocar o destino
ou passar da janela limpa de novo, porque a limpeza é relativa ao destino que está sendo vinculado.

Não há compensação automática (não existe endpoint para "desfazer a limpeza"), e um retry silencioso do servidor
esconderia do operador que a categoria está temporariamente sem vínculo. O retry é explícito, e é seguro.

### Configuração nova

| Variável | Padrão | Para quê |
|---|---|---|
| `ANYMARKET_PANEL_API_URL` | `https://app.anymarket.com.br/rest/api` | Host da API interna do painel (§1) |
| `ANYMARKET_MARKETPLACES` | vazio | Canais a checar quando o cliente não tem o campo `marketplaces` no cadastro |
| `ANYMARKET_ATTRS_PAGE_SIZE` / `ANYMARKET_ATTRS_MAX_PAGES` | 50 / 200 | Paginação de `/v2/categories/characteristics/groups` |
| `ANYMARKET_TRANSMISSIONS_PAGE_SIZE` / `_MAX_PAGES` | 100 / 20 | Paginação de `/v2/transmissions` |

`ANYMARKET_DRY_RUN=true` continua valendo: cobre também `cleanBoundAttributes`, o PUT de vínculo e o PATCH de
atributos, então dá para ensaiar o fluxo inteiro sem escrever nada.

Canais por cliente: campo `marketplaces` (array de códigos, ex. `["MERCADO_LIVRE"]`) no doc `clients/{id}`. Sem ele e
sem a variável de ambiente, a tela mostra só os canais que a categoria já tem vinculados e pede a configuração — em
vez de inventar uma lista de canais.


## 7. Validação contra conta real (19/08/2026)

Rodada em duas etapas: primeiro só com o token de API (tudo da §1 falhou), depois com o **token do painel** — e aí a §1
inteira respondeu. O aprendizado central está na nota do topo: são dois tokens distintos.

### O que responde, com qual token

| Chamada | Token | Resultado medido |
|---|---|---|
| `GET /v2/categories`, `/v2/products/{id}`, `/v2/transmissions?statusFilter=UNPUBLISHED` | API | ✅ 200 |
| `GET /v2/marketplaces` | API | ✅ 200 — catálogo de **148 canais** `{code, name}` |
| `GET /v2/marketplaces/{code}` | API | ❌ 500 `"This method is restricted for ANYMARKET use."` |
| `GET /v2/categories/characteristics/groups` | API | ⚠ 200 com `totalElements: 0` nesta conta |
| `GET /rest/api/marketplaces` | Painel | ✅ **canais ATIVOS da conta**: `["AMAZON_GLOBAL_API","MAGAZINE_LUIZA","MERCADO_LIVRE","NUVEMSHOP","SHOPEE"]` |
| `GET /rest/api/categories/{id}` (§1.1) | Painel | ✅ 200 com `marketPlaces[]` |
| `GET /rest/api/categories/bind/{MP}/suggestions/{id}` (§1.3) | Painel | ✅ 200 `{ suggestions: [] }` — vazio nas categorias testadas |
| `GET /rest/api/marketplaces/{MP}/categories[/{code}]` (§1.4) | Painel | ✅ 200 — 32 raízes no ML, drill-down completo |
| `PUT` da §1.5 | Painel | ⚠ ensaiado com `ANYMARKET_DRY_RUN=true`: corpo montado e conferido, **escrita real ainda não executada** |
| Token do painel na v2 | — | 401 `"User not registered"` |
| Token de API no painel | — | 500 genérico em **qualquer** caminho, inclusive path inexistente |
| Token do painel **expirado** | — | 403 `{"response":"TOKEN_EXPIRED","operation":"geral"}` |

### Payloads reais e o que eles obrigaram a mudar

**1. `completePath` dos FILHOS vem `null`.** No drill-down, só o nível atual e o breadcrumb trazem o caminho; a lista de
filhos vem com `completePath: null`. Como o PUT da §1.5 exige esse campo, vincular um filho direto da lista mandaria
string vazia. `normalizeMarketplaceLevel` agora **deriva** o caminho do filho (breadcrumb + nome). Confirmado no ensaio:
o corpo saiu com `"Alimentos e Bebidas > Mercearia > Macarrões"`.

**2. `canBeSelected` só existe no nível atual**, não na lista de filhos. A UI então põe o botão de vincular no nó
aberto, e as linhas de filhos são navegação. E não é sinônimo de folha: `MLB1403` (Alimentos e Bebidas, nível 1) é
selecionável e tem 7 filhos.

**3. `removed` vem `null`, não `false`,** quando o vínculo está ativo. `Boolean(null)` já resolvia; agora está coberto
por teste com o payload real, para ninguém "consertar" isso depois.

**4. `accountIdentifier` existe por vínculo** — `NUVEMSHOP: "202"`, `SHOPEE: "1974"`. Canal com múltiplas contas
identifica a conta aí; o campo é preservado na normalização.

**5. Sugestões vêm em `{ suggestions: [...] }`** e podem demorar: numa categoria com 3.275 produtos passou de 25s.
Timeout próprio de 90s (`ANYMARKET_SUGGESTIONS_TIMEOUT_MS`) — com o padrão isso apareceria como "erro de rede" numa
chamada que só estava lenta.

**6. Paginação do painel é outro dialeto:** `{pageSize, count, start, values[]}`. `extractItems` aprendeu `values`.

**7. `GET /rest/api/marketplaces` substituiu a lista configurada à mão** como fonte primária de "quais canais checar".
O campo `marketplaces` do cliente e `ANYMARKET_MARKETPLACES` continuam como reserva para quando o painel não responder.

### Bugs encontrados pela execução real

1. **Lock com falso "ocupado"** — `acquireLock` tratava qualquer falha do Firestore fora de uma lista de casos
   conhecidos como "lock ocupado", então num ambiente sem credencial (`Unable to detect a Project Id`) o vínculo
   respondia "Outro processo já está vinculando" — falso e sem saída. Agora só `ALREADY_EXISTS` (gRPC 6) é lock.
2. **`AnymarketApiError` descartava `code`** — o campo já era passado por chamadores (inclusive o `token_missing` do
   fluxo antigo de categorias) e chegava `null` na resposta HTTP.
3. **Retry inútil no painel** — três tentativas para um 500 sistemático. Agora `maxRetries: 1` nas chamadas do painel.
4. **Intenção pendurada** — quando a limpeza falha, nada foi destruído, então o diário não deve ficar em `cleaning`.

### Diagnóstico por código de erro

| `code` | Significado | Ação do operador |
|---|---|---|
| `panel_token_missing` | Cliente sem token do painel cadastrado | Salvar em ⚙️ Configurações → Token do painel |
| `panel_token_expired` | Token de sessão venceu (o caso mais comum) | Capturar um novo no painel e salvar |
| `panel_token_unsupported` | Token do tipo errado no campo | Conferir se não colou o token de API |
| `internal_contract_changed` | AnyMarket mudou a API não documentada | Fazer no painel e avisar o time |
| `bind_failed_after_clean` | Limpeza feita, vínculo não gravado | Clicar de novo — o retry não repete a limpeza |

Em todos eles `GET /status` **degrada em vez de falhar**: devolve o último estado conhecido com `hubUnavailable: true`,
`canBindHere: false` e `checkedAt: null` — nunca finge que conferiu agora. A detecção em lote (§1.2) e os atributos (§2)
seguem funcionando, porque são API pública.

### Configuração

Por cliente, em `clients/{id}`: `anymarket_token` (API, já existia), **`anymarket_panel_token`** (novo) e `marketplaces`
(reserva). Editáveis em ⚙️ Configurações; `ANYMARKET_PANEL_TOKEN` no ambiente serve para desenvolvimento.

### O que continua sem confirmação

- **Escrita real da §1.5.** O ensaio com dry-run montou e conferiu o corpo, mas o `PUT` de verdade não foi executado —
  ele chama `cleanBoundAttributes`, que é destrutivo. Falta rodar numa categoria de teste.
- **Formato de `/v2/categories/characteristics/groups`** — a conta testada tem zero grupos. O normalizador aceita três
  formas de vínculo com categoria (`categories[]`, `category{}`, `categoryId`) por isso mesmo.
- **`characteristics[]` no produto** — o produto lido não tinha o campo; o caminho de gravação segue não exercitado.
- **Sugestões com resultado não-vazio** — só vimos `{ suggestions: [] }`, então a forma de cada item (`percentage`,
  `codeInMarketPlace`) segue baseada na doc, não em observação.

### Renovação do token do painel

É o ponto frágil da operação: token de sessão, validade curta, capturado à mão no DevTools. Enquanto não houver
credencial de serviço para o painel, o vínculo por canal vai exigir recolar o token periodicamente. Vale perguntar ao
suporte da AnyMarket se existe token de API com escopo de painel — isso eliminaria o trabalho manual.

## 8. Vínculo automático — o CRIA decide, o operador confirma (20/08/2026)

A §1 descrevia as chamadas; o que faltava era a **decisão**. Escolher categoria na árvore do
Mercado Livre à mão já é o que o painel do AnyMarket faz — o CRIA só acrescenta valor se
resolver o de-para e pedir **uma** confirmação. É o que esta seção implementa.

Arquivo: `server/services/channelBindResolver.js` (decisão) + `proposeBindings` /
`applyBindingsBatch` em `channelBindService.js` (orquestração).

### Como a decisão é tomada

1. **Sugestão da AnyMarket** (§1.3), se vier com confiança ≥ 50%. É a resposta mais barata e
   endossada pelo hub. Medido: veio vazia (`{ suggestions: [] }`) em todas as categorias
   testadas, então ela não pode ser o único caminho.
2. **Busca na árvore nativa do canal** (§1.4), nível a nível:
   - pontuação determinística com o matcher que já existe (`categoryMatcher.scoreForReuse`);
   - o LLM decide **só** onde o texto não decide (empate ou nada acima do piso);
   - **com retorno (backtracking)**: beco sem saída faz voltar e tentar o ramo seguinte.

A pergunta feita ao LLM é de **navegação**, não de escolha final: "por qual ramo se chega até
o alvo?". Perguntar "qual destes É a categoria?" fazia o modelo responder "nenhum" num nível
intermediário — corretamente, porque nenhum daqueles nomes era a categoria; eles apenas
levavam até ela.

### Resultado medido na conta real (categoria "Acessórios > Tapetes", 5 canais)

| Canal | Resultado |
|---|---|
| AMAZON_GLOBAL_API | ✅ `Casa > Decoração para Casa > Tapetes, Forros e Protetores > Tapetes` — 100%, nome idêntico |
| MERCADO_LIVRE | ✅ `Acessórios para Veículos > Aces. de Carros e Caminhonetes > Interior > Tapetes` — 100%, nome idêntico |
| SHOPEE | ✅ `Casa e Decoração > Decoração > Carpetes e Tapetes` — 14%, marcado para conferência |
| NUVEMSHOP | ✕ não resolvido (o modelo não reconheceu ramo compatível) |
| MAGAZINE_LUIZA | ✕ o canal recusou a chamada (erro interno da integração, do lado da AnyMarket) |

Outras categorias do mesmo cliente, com o rastro completo: "Macacos" →
`Ferramentas para Veículos > Elevação > Macacos` (100%, **depois de uma volta**: o modelo
entrou primeiro em "Peças de Carros e Caminhonetes", bateu no beco e voltou); "Chave de Roda"
→ `Rodas > Rodas de Carros e Caminhonetes` (25%, conferência); "Chaveiros" → não resolvido.

### Três desfechos, três tratamentos na tela

- **Nome idêntico** (`exactLeafMatch`, confiança alta) → vem **marcada** para confirmar.
- **Resolvida com ressalva** (confiança baixa, nome diferente) → vem **desmarcada**, com o
  rastro das decisões visível. Marcar por padrão transformaria a confirmação em carimbo.
- **Não resolvida** → não é oferecida como vínculo. O palpite descartado aparece como
  informação, e o ajuste manual (drill-down) continua ali para esse canal.

A confirmação é um clique para N canais (`POST /apply-batch`), e cada canal é uma transação
independente: um que falhe não desfaz nem impede os outros, e a resposta 207 lista aplicados e
falhados separadamente.

### Armadilhas que a execução real revelou (todas com teste de regressão)

**1. Containment dando falsa certeza.** "Chave de Roda" casou 1.0 com "Rodas" e foi proposta
como correspondência exata. Chave de roda é ferramenta, roda é peça. A correção foi trocar
`scoreNames` por **`scoreForReuse`** — a mesma decisão, pelo mesmo motivo, que
`categoryMatcher.js` já havia tomado para o reuso de categoria ("Panelas" ⊂ "Panelas de
Pressão"). Containment continua valendo como pista de ROTA, onde errar custa uma descida.

**2. Corte de candidatos escondendo a resposta.** Mandar ao LLM só os 10 melhores por score
textual descartava o ramo certo antes de alguém poder escolhê-lo — num nível intermediário
esse score é ruído. Agora vão todos os ramos do nível (teto de 80).

**3. Parada precoce.** A busca parava num nó vinculável quando "nenhum filho melhora o score",
mesmo com o nó atual sendo uma correspondência ruim (0.15). Nenhum dos dois lados casar é
justamente quando o significado precisa ser consultado: "Tapetes" estava sob "Interior".
Agora a parada por esse critério exige que o nó atual já seja uma correspondência decente.

**4. Beco sem saída sem volta.** Sem backtracking, um ramo errado terminava numa categoria
intermediária de baixa confiança. Com retorno (orçamento de 2), "Macacos" passou de
`Peças de Carros e Caminhonetes` (0.24) para `Elevação > Macacos` (1.0).

**5. Recusa na raiz.** O modelo recusou a raiz do Mercado Livre para "Chaveiros" — a raiz cobre
o catálogo inteiro, então recusar ali é leitura errada, não resposta. A busca segue pelo melhor
score, marcando a decisão como fraca.

**6. Propor qualquer coisa é pior que admitir que não achou.** Para "Chaveiros", a busca
terminava oferecendo "Agro" com selo de "confira". Agora, quando nem o melhor nó visitado se
aproxima do alvo, a resposta é **não resolvido** com o palpite de lado.

**7. Canal com múltiplas contas exige `accountIdentifier`.** Shopee e Nuvemshop respondem
`500 "Cannot parse null string"` sem ele. A conta vem de `GET /rest/api/marketplaces/accounts`
(novo endpoint mapeado: `[{ id, name, marketplace, accountDefault }]`), é resolvida uma vez por
proposta e viaja até o corpo do PUT — que é como os vínculos reais desses canais aparecem.

**8. Erro do canal ≠ contrato quebrado.** `500 { code: "MarketPlaceIntegrationException" }` é
falha da integração daquele marketplace (medido: Magazine Luiza), não do CRIA nem do painel.
Recebe código próprio (`marketplace_integration_error`) e não aborta a proposta dos outros
canais.

### Custo e ritmo

Uma proposta de 5 canais levou ~22s: são chamadas ao painel por nível de árvore mais os
desempates do LLM. Os níveis já visitados ficam em cache por processo (1h), então a segunda
categoria do mesmo cliente é bem mais rápida. `gpt-4o-mini` com temperatura 0.1; a decisão
determinística resolve os níveis fáceis sem gastar chamada.

### Ajustes por ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `ANYMARKET_BIND_MIN_SUGGESTION` | 50 | confiança mínima (0–100) para aceitar a sugestão da AnyMarket |
| `ANYMARKET_BIND_MIN_SCORE` | 0.5 | piso do score textual para seguir sem LLM |
| `ANYMARKET_BIND_LOW_CONFIDENCE` | 0.65 | abaixo disto a proposta vem desmarcada |
| `ANYMARKET_BIND_AMBIGUITY_GAP` | 0.1 | diferença entre 1º e 2º que aciona o LLM |
| `ANYMARKET_BIND_MAX_BACKTRACKS` | 2 | orçamento de voltas por canal |
| `ANYMARKET_BIND_MAX_DEPTH` | 8 | profundidade máxima da árvore do canal |
| `ANYMARKET_BIND_LLM_CANDIDATES` | 80 | teto de ramos enviados ao LLM por nível |

### O que ainda falta

- **A escrita real nunca foi executada** — todo o fluxo automático foi validado com
  `ANYMARKET_DRY_RUN=true`, que monta e confere o corpo do PUT sem gravar. Falta rodar numa
  categoria de teste com o dry-run desligado.
- **Aprender com a correção do operador.** Quando ele ajusta um canal na mão, isso deveria
  virar sinal para as próximas propostas (mesmo espírito do few-shot que a criação de
  categoria já usa via `generations`). Hoje só fica registrado `source: 'manual'`.
- **Lote por vários produtos/categorias.** Hoje a proposta é por categoria. O caminho natural é
  propor para todas as categorias pendentes de uma vez, com uma confirmação por tela.
