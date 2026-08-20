# Prompt — Mapeamento e Implementação: De-Para de Canais + Atributos de Categoria

> Objetivo deste prompt: primeiro extrair da LLM/documentação que conhece a API da AnyMarket tudo que é necessário sobre vínculo de categoria por canal e sobre atributos de categoria; só depois, com essas respostas em mãos, implementar no CRIA. Use a Parte A com a LLM que conhece o sistema de APIs. Use a Parte B (já com as respostas) para pedir a implementação.

## Contexto do que já existe no CRIA

O CRIA já tem uma feature madura de sugestão/criação assistida de **categorias no hub AnyMarket** (`server/services/categoryService.js`, `categoryMatcher.js`, `categoryTreeService.js`, `categoryTreeCache.js`, `categoryNormalizer.js`, `anymarketClient.js`, ver `docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md`). Ela cobre: dedup em funil (chave natural → canônica → fuzzy → semântica), aprovação humana, criação de nó na árvore, vínculo produto↔categoria com undo, lock distribuído.

**O que essa feature explicitamente NÃO faz hoje** (confirmado por varredura de código):

1. **Vínculo de categoria por canal/marketplace ("de-para")**: não existe nenhuma chamada de API, coleção, campo ou serviço relacionado a canais. A própria especificação (`docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md`, §9) já registra o risco: *"Criar um nó na árvore do AnyMarket não cria nem altera categoria em nenhum canal de venda — a publicação usa o de-para de categorias por marketplace, configurado à parte. Um nó novo nasce sem esse de-para, e produto em categoria sem de-para pode falhar ou pausar na publicação do canal."* Isso ficou registrado só como aviso textual a exibir na UI, nunca implementado.
2. **Atributos obrigatórios/opcionais de categoria**: zero implementação, zero menção em toda a documentação. `anymarketClient.js` hoje só chama endpoints de árvore de categoria e de produto (`/categories`, `/categories/fullPath`, `/categories/{id}`, `/categories?partnerId=`, `/products/{id}`, `POST /categories`, `PATCH /products/{id}`) — nenhum endpoint de atributo.

Ambas as frentes pedidas agora são **features novas, do zero**, que se encaixam depois do fluxo de categoria já existente.

## O que eu (CRIA) quero construir, em ordem

1. **Validação de de-para por canal**: para cada categoria do hub (própria ou recém-vinculada a um produto), verificar se ela já tem de-para configurado em cada marketplace/canal ativo do cliente. Mostrar isso na UI (ex.: dentro do `CategoryModal.jsx` ou em uma visão nova).
2. **Criação/edição do vínculo de canal quando estiver faltando**: se uma categoria não tiver de-para em um canal, permitir que o operador crie esse vínculo diretamente pelo CRIA (buscar a categoria equivalente no canal, ou seja lá qual mecanismo a API da AnyMarket oferecer para isso).
3. **Depois do vínculo de categoria resolvido (hub + canais)**: preencher os atributos da categoria vinculada — primeiro os **obrigatórios** (bloqueantes para publicação), e depois avaliar cobrir também os **opcionais**.

---

## Parte A — Perguntas para mapear na LLM/documentação da API AnyMarket

Antes de qualquer código, preciso de respostas objetivas (endpoint, método, payload de exemplo, campos de resposta) para cada pergunta abaixo. Not

Pergunte usando o formato: **endpoint, verbo HTTP, parâmetros, exemplo de request/response, limites de rate/paginação, e em qual caso de erro ele retorna (404 categoria sem de-para vs 400 payload inválido, etc.)**.

### A.1 — De-para de categoria por canal
1. Existe um endpoint para **listar os marketplaces/canais ativos** de uma conta AnyMarket? Qual o identificador de canal (ex.: `channelId`, `marketplaceId`) e como descobrir quais estão habilitados para o cliente atual?
2. Existe um endpoint para **consultar o de-para de uma categoria do hub para um canal específico** (ex.: "essa categoria X do hub está mapeada para qual categoria no Mercado Livre?")? Se sim: request/response completos.
3. Existe um endpoint para **listar a árvore de categorias nativa de um canal/marketplace** (para eu poder oferecer ao operador as opções de "para onde" vincular)? Formato da árvore é igual ao de `/categories`/`/categories/fullPath` do hub, ou é outro formato por canal?
4. Existe um endpoint para **criar/atualizar o de-para** (vincular categoria do hub → categoria do canal)? É um PATCH na categoria do hub, um POST em um recurso próprio de mapeamento, ou é feito via outro recurso (ex.: nível de produto, não de categoria)?
5. O de-para é **por conta/cliente** ou **global por par de categorias**? Ou seja, dois clientes diferentes usando a mesma categoria do hub podem ter de-paras diferentes para o mesmo canal?
6. Quando um produto está numa categoria sem de-para configurado em um canal ativo, **qual é o comportamento real hoje**: a publicação falha, fica pausada, ou é publicada numa categoria "genérica"? Existe algum código de erro/status específico que eu deveria monitorar para detectar isso automaticamis (em vez de o operador descobrir manualmente)?
7. Existe algum **webhook ou endpoint de status de publicação por canal** que eu possa consultar em lote (por produto ou por categoria) para saber quais categorias estão sem de-para hoje, sem precisar checar uma por uma?
8. Rate limits e paginação desses endpoints (para reaproveitar o `RateLimiter`/backoff já implementado em `anymarketClient.js`).

### A.2 — Atributos de categoria
1. Existe um endpoint para **listar os atributos de uma categoria** (do hub e/ou por canal)? Ele diferencia atributos **obrigatórios** vs **opcionais** explicitamente em algum campo (ex.: `required: true/false`)?
2. Qual é o **tipo de dado** de cada atributo (texto livre, número, seleção única, múltipla escolha, boolean)? Para os de seleção, existe um endpoint de **valores possíveis** (enum) por atributo?
3. Atributos são **por categoria do hub** ou **por categoria de canal**? Ou seja: se uma categoria do hub está vinculada a 3 canais, os atributos obrigatórios são os mesmos nos 3, ou cada canal pode exigir atributos diferentes para "a mesma" categoria?
4. Existe um endpoint para **ler os valores de atributo já preenchidos em um produto**, e outro para **gravar/atualizar** esses valores? Isso é feito via `PATCH /products/{id}` (o mesmo endpoint que já usamos para trocar categoria) ou é um recurso separado (ex.: `/products/{id}/attributes`)?
5. Existe alguma **validação de atributo condicional** (ex.: atributo B só é obrigatório se atributo A tiver um certo valor)? Se sim, como isso é exposto pela API (algum campo tipo `dependsOn`)?
6. Quando um produto tem atributo obrigatório faltando, **o que acontece na publicação**: bloqueia, publica com aviso, ou publica incompleto? Existe forma de consultar em lote quais produtos/categorias têm atributos obrigatórios pendentes?
7. Rate limits e paginação desses endpoints.

### A.3 — Perguntas de modelagem (para eu, não para a LLM da API)
Depois de ter as respostas de A.1/A.2, preciso decidir:
- Onde persistir o de-para e os valores de atributo: novas coleções Firestore (`clients/{id}/channel_category_mapping`, `clients/{id}/category_attributes_cache`?) ou embutido em `anymarket_categories`?
- Se o de-para/atributo deve entrar no mesmo funil de aprovação humana que já existe para categoria (sugestão → aprovação → aplicação), reaproveitando `category_proposals`/lock distribuído, ou se merece um fluxo mais simples (já que aqui não há ambiguidade de "qual categoria", só "preencher os campos que a API pede").

---

## Parte B — Depois de ter as respostas da Parte A, pedido de implementação

Com as respostas de A.1/A.2 em mãos, monte um plano (não implemente direto) cobrindo:

1. **Nova camada de acesso à API** em `anymarketClient.js` (ou um novo arquivo, ex. `channelMappingClient.js`) para: listar canais ativos, ler de-para de uma categoria por canal, criar/atualizar de-para, ler atributos por categoria (com flag obrigatório/opcional e enum de valores), ler/gravar atributos de produto. Reaproveitar o padrão de rate limit/retry já existente.
2. **Nova validação server-side**: dado um `clientId` + lista de categorias (ou produtos), retornar quais têm de-para faltando por canal, e quais têm atributos obrigatórios faltando — pensada para rodar tanto sob demanda (um produto) quanto em lote (revisão do `ReviewPanel.jsx`).
3. **UI**: estender `CategoryModal.jsx` (ou criar um modal irmão, ex. `ChannelMappingModal.jsx`) para: (a) mostrar por canal se a categoria está vinculada ou não, com ação de vincular quando faltar; (b) depois de vinculada, formulário para preencher atributos obrigatórios primeiro, opcionais depois — reaproveitando o padrão visual já usado no `CategoryModal.jsx` de "De → Para".
4. **Persistência**: nova(s) coleção(ões) Firestore para de-para e valores de atributo, seguindo o mesmo cuidado de resiliência já pedido para o restante do Firestore (ver análise de robustez do Firebase feita anteriormente) — não repetir o padrão de fallback silencioso para escrita crítica.
5. **Testes**: cobertura para o client de API novo e para a lógica de validação de "falta de-para"/"falta atributo obrigatório", seguindo o padrão de teste já usado em `categoryMatcher.test.js`/`anymarketClient.test.js`.
6. Atualizar `docs/ESPECIFICACAO_CRIACAO_CATEGORIAS_ANYMARKET.md` (ou criar um documento novo, ex. `docs/ESPECIFICACAO_CANAIS_E_ATRIBUTOS.md`) formalizando isso como as próximas fases do roadmap de categorias, já que hoje o de-para de canal só existe como observação de risco na §9 e atributos não existem em lugar nenhum da doc.
