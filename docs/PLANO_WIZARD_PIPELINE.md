# Plano — Repaginação em Etapas (Wizard) do Fluxo Título → Categoria → Canais → Atributos

## 0. O que muda no ponto de partida

Ao investigar antes de planejar, confirmei que o backend das etapas 2-4 **já existe e já foi testado contra conta real** (ver `docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md` §6-8, e os arquivos abaixo, comitados hoje):

| Etapa | Backend já existente | Onde vive hoje na UI |
|---|---|---|
| 1. Título/Descrição | `server/routes/generate.js`, `promptResolver.js` | `ReviewPanel.jsx` (tabela em lote) |
| 2. Categoria | `categoryService.js` (suggest/approve, já agrupa por `productIds`) | Botão 🗂️ na linha do `ReviewPanel.jsx` → abre `CategoryModal.jsx` |
| 3. Canais (de-para) | `channelBindService.js` + `channelBindResolver.js` (resolução automática com LLM, `propose`/`apply-batch`) | Dentro do `CategoryModal.jsx`, via `ChannelBindingPanel.jsx` |
| 4. Atributos | `categoryAttributesService.js` (`validateProductAttributes`/`saveProductAttributes`) | Rotas prontas (`/api/category-attributes/*`), **sem UI de preenchimento ainda** |

Ou seja: o problema de hoje não é falta de capacidade no backend, é que tudo está **espremido dentro de um único modal por produto**, aberto ad-hoc, sem noção de "cliente só quer parte disso" — exatamente o que você descreveu como confuso.

## 1. Reconciliando "wizard guiado" com "ferramenta de lote"

Seu fluxo descrito (selecionar → título/descrição → categoria → canais → atributos, com opção de pular) lê como um wizard de item único. Mas o CRIA é fundamentalmente uma ferramenta de **lote** (`ReviewPanel` já processa N produtos com `CONCURRENCY = 10`; `category_proposals` já agrupa vários produtos sob a mesma categoria sugerida). Um wizard por produto individual seria um passo atrás na produtividade para quem hoje revisa 50-200 produtos de uma vez.

**Decidido**: wizard de **4 etapas por lote**, não por produto — o operador seleciona N produtos uma vez, e o lote inteiro avança etapa por etapa (gera título/descrição de todos → depois categoriza todos → depois resolve canais de todos → depois preenche atributos de todos), com "pular etapa" pulando a etapa **para o lote inteiro** e "pular este item" pulando só um produto dentro da etapa atual. Isso reaproveita a maior parte do que já existe (a tabela em lote do `ReviewPanel`, o agrupamento por `productIds` da categoria, o `apply-batch` de canais) e é consistente com o resto do produto. O `CategoryModal.jsx` por produto individual continua existindo à parte, para ajuste pontual fora do fluxo de lote.

## 2. Arquitetura proposta

### 2.1 Seleção de etapas — por execução, não fixa no cliente (decidido)
Sem configuração salva por cliente: ao iniciar um lote (produtos selecionados na aba de revisão), a primeira tela do wizard é um checklist simples — "quais etapas você quer rodar neste lote?" — com as 4 opções marcadas por padrão (tudo ligado) e o operador desmarca o que não quiser (ex.: só Categoria, ou só Atributos). Essa escolha vale só para aquela execução; a próxima começa de novo com tudo marcado.

```js
// Não persiste em clients/{id} — vive só no estado do wizard em memória (Zustand),
// enviado junto quando cada etapa dispara sua chamada em lote.
{
  runStages: { content: true, category: true, channels: false, attributes: true }
}
```

Etapa desmarcada não aparece no indicador de progresso daquela execução — o wizard já nasce com 1‑2‑3 (por exemplo), não com um "④ desabilitado" cinza.

### 2.2 Estado do progresso — calculado, não duplicado
Em vez de criar uma nova coleção "de verdade" para rastrear onde cada produto está (risco de desincronizar com a realidade), o status de cada etapa é **derivado** do que já existe:
- Etapa 1 concluída → existe `generations` aprovada para o produto.
- Etapa 2 concluída → produto tem `category.id` diferente do original (via `category_attachments`).
- Etapa 3 concluída → `getBindingStatus` confirma vínculo em todos os canais ativos do cliente.
- Etapa 4 concluída → `validateProductAttributes` não acusa obrigatório faltando.

O único estado novo que precisa ser **persistido** é o "pulei essa etapa de propósito" — sem isso, a etapa voltaria a aparecer como pendente toda vez. Proponho um documento leve, `clients/{id}/pipeline_skips/{productId}`, só com `{ content?: true, category?: true, channels?: true, attributes?: true }`. Pequeno, fácil de auditar, fácil de reverter.

### 2.3 UI — shell de 4 etapas
- A aba "Revisão" no menu superior vira o ponto de entrada único: ao selecionar produtos, o operador entra num shell com indicador de etapas (você pediu numeração 1‑2‑3‑4 na parte de baixo — vou seguir isso como uma barra fixa de progresso/ação no rodapé, com "Voltar / Pular esta etapa / Avançar", em vez de abas no topo, que é o padrão comum em wizards de checkout).
- Cada etapa reaproveita/adapta um componente existente:
  - **Etapa 1**: `ReviewPanel.jsx` hoje, só removendo dele a coluna/botão de categoria (isso migra para a etapa 2).
  - **Etapa 2**: tela nova, mas de baixo esforço — já existe agrupamento por `productIds` em `category_proposals`; hoje isso só é exposto por produto individual no `CategoryModal`. Precisa de uma **visão de lote** que já mostre os grupos formados.
  - **Etapa 3**: tela nova que chama `POST /propose` (decidido: resolver automático como padrão) para cada categoria distinta do lote e apresenta os resultados com o rastro de confiança já existente (nome idêntico / resolvida com ressalva / não resolvida — os três desfechos que `channelBindResolver.js` já produz), com um botão único "Confirmar todos os de alta confiança" pré-marcado + revisão manual (árvore, via `browseChannelTree`) para os demais, chamando `apply-batch`. **Isso precisa de uma nova função de orquestração** (`channelBindService` só tem `apply-batch` por categoria única; falta o loop por várias categorias do lote — ver §3 do gap de backend).
  - **Etapa 4**: tela **inteiramente nova** (não existe UI hoje) — formulário de atributos com **uma aba por canal vinculado** dentro de cada produto (decidido: mostra exatamente o que cada marketplace exige, mesmo com nomes parecidos em canais diferentes), usando `GET /api/category-attributes/product/:clientId/:productId` para saber o que falta e `PATCH` para salvar.

### 2.4 O que fica fora do escopo do wizard
O `CategoryModal.jsx` atual (aberto por produto, via 🗂️) pode continuar existindo como atalho de "conferir/corrigir 1 produto pontual fora do fluxo de lote" — não precisa ser removido, só deixa de ser o único caminho.

## 3. Gaps de backend a fechar (novos, não existiam antes)

1. **Orquestração de canais para várias categorias de uma vez** — hoje `propose`/`apply-batch` operam sobre 1 categoria × N canais. Falta um passo que pegue as categorias distintas de um lote de produtos e rode `propose` para cada uma (em paralelo, respeitando rate limit), consolidando um único "confirmar tudo" para o operador. É o item que a própria doc (§8, "o que ainda falta") já sinalizava: "lote por vários produtos/categorias".
2. **Orquestração de atributos por lote** — `validateProductAttributes` é por produto; falta agrupar por categoria+canal (produtos na mesma categoria compartilham o mesmo formulário de atributos obrigatórios) para não o operador preencher o mesmo campo N vezes à toa quando o valor é igual para vários produtos (ex.: "Material: Aço" pode valer para uma linha inteira de produtos).
3. **Endpoint/serviço de skip** — `pipeline_skips` (§2.2) e a leitura consolidada de "status das 4 etapas por produto" para renderizar o indicador de progresso do lote inteiro sem 4 chamadas por produto.
4. **Escrita real de atributo nunca testada** — `saveProductAttributes` existe mas o caminho de gravação (`PATCH /v2/products/{id}` com `characteristics`) nunca rodou contra um produto de verdade com atributo obrigatório de verdade (a conta testada tinha `totalElements: 0` em características). Ver pedido de acesso no §5.

## 3.1 Implementado nesta rodada (2026-08-20)

Escopo entregue: o checklist de etapas, o shell do wizard e a Etapa 3 (Canais) — a única
totalmente desbloqueada, já que 1, 2 e 4 dependem de decisões/acessos ainda pendentes ou
foram deixadas para uma próxima rodada por escopo.

| Arquivo | O que faz |
|---|---|
| `src/components/PipelineWizard.jsx` | Shell: checklist de etapas (sem persistência — decidido em §2.1), barra de progresso 1‑2‑3‑4 no rodapé do card, Voltar/Pular/Avançar. Etapas 1, 2 e 4 mostram um aviso "ainda não migrada" com o atalho para o fluxo atual, em vez de fingir suporte que não existe. |
| `src/components/PipelineChannelsStage.jsx` | Etapa 3 de verdade: resolve a categoria atual de cada produto selecionado (`fetchCurrentCategory`, em paralelo via `parallelProcess`), agrupa por categoria distinta e renderiza um `AutoBindStep` por grupo. |
| `src/components/ChannelBindingPanel.jsx` | `AutoBindStep` passou a ser exportado — é reaproveitado pelo wizard em vez de duplicado. |
| `src/components/ReviewPanel.jsx` | Novo botão "🧭 Processar em etapas" na toolbar de ações em lote, abre o wizard com os produtos selecionados. |

**Decisão de implementação que vale registrar**: em vez de criar o endpoint de orquestração
`propose-batch` (que o §3 original apontava como gap), a Etapa 3 reaproveita o `AutoBindStep`
já existente **uma vez por categoria distinta do lote** — cada grupo resolve e confirma de
forma independente (React monta os N grupos em paralelo, cada um chamando `/propose`). Isso
evita duplicar ~180 linhas de lógica de proposta/confirmação testada, ao custo de não ter um
único botão "confirmar tudo" entre categorias — o operador confirma grupo por grupo. Se isso
incomodar no uso real, o `propose-batch` + um "confirmar tudo" unificado continuam sendo o
próximo passo natural (permanece como gap em aberto).

**Ainda faltam, antes de considerar a Etapa 3 pronta para uso real**: a escrita de verdade
nunca foi exercitada (só dry-run, ver §7), e a interface não foi testada num navegador de
verdade nesta rodada — só validado que o build (`npm run build`) e a suíte de testes do
backend (`npm test`, 189 testes) continuam passando. Migrar as Etapas 1, 2 e 4 para o wizard
continua pendente — depende também das respostas do §5 para a Etapa 4.

## 4. Decisões tomadas (2026-08-20)

1. **Granularidade**: lote inteiro avança etapa por etapa (não produto-a-produto).
2. **Seleção de etapas**: escolha manual a cada execução, via checklist no início do wizard — sem padrão salvo por cliente (ver §2.1).
3. **Formulário de atributos**: uma aba por canal vinculado dentro de cada produto.
4. **Resolução de canais**: automática por padrão (`proposeBindings`), com confirmação em lote e ajuste manual (árvore) disponível para os itens não resolvidos ou de baixa confiança.

## 5. O que preciso que você me traga (acesso/tokens) para continuar mapeando

1. **Um `anymarket_panel_token` válido de um cliente de teste**, para eu poder executar de verdade (fora do `ANYMARKET_DRY_RUN`) pelo menos um vínculo de canal — a escrita real da §1.5 nunca rodou de verdade, só em simulação. Sem isso, a etapa 3 do wizard vai ao ar sem nunca ter confirmado que o PUT de vínculo funciona de ponta a ponta.
2. **Um cliente/categoria cuja conta realmente tenha atributos/características cadastrados no Mercado Livre (ou outro canal)** — a conta usada até agora nos testes veio com `totalElements: 0` em `/v2/categories/characteristics/groups`, então a etapa 4 inteira foi desenhada sem nunca ter visto um atributo obrigatório real. Preciso disso antes de fechar o formato do formulário da etapa 4.
3. Se a pergunta 2 não resolver (a característica continuar vindo vazia pela API pública), **peço para repetir a captura de DevTools** (mesmo método de antes) na tela do painel onde o operador cadastra atributos de um produto — para checar se, nesta conta, atributos também dependem de uma API interna do painel (como aconteceu com o de-para de categoria), e não só da pública.
