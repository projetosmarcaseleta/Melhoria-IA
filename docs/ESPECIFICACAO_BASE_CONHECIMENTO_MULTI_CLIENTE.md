# Especificação: Base de Conhecimento Multi-Cliente com Regras Livres

## 1. Objetivo deste documento

Este documento é uma especificação de implementação para evoluir a base RAG do projeto **Melhoria de Descrição de Produtos**.

O sistema deve aceitar documentos Markdown escritos livremente por clientes diferentes. Cada cliente poderá usar estrutura, vocabulário e nível de detalhamento próprios. O sistema não pode exigir headings, nomes de seções ou templates padronizados no arquivo enviado.

A implementação deve transformar documentos livres em regras operacionais estruturadas, mantendo o documento original como fonte auditável. Regras críticas não podem depender apenas de similaridade semântica ou da capacidade do LLM de lembrar uma instrução no meio de um texto extenso.

Esta especificação deve ser implementada respeitando o `AGENTS.md` do repositório, especialmente:

- Isolamento estrito por `clientId`.
- Preservação das rotas existentes ou atualização coordenada do frontend.
- Persistência de feedback humano.
- Execução obrigatória de `npx vite build` ao final.
- Preservação das alterações locais já existentes no worktree.

## 2. Problema atual

Atualmente o upload de um `.md`:

1. Cria um documento em `clients/{clientId}/knowledge_docs`.
2. Divide o conteúdo em chunks.
3. Gera embeddings.
4. Grava os chunks em `clients/{clientId}/knowledge_chunks`.
5. Na geração, o `promptResolver` inclui todos os chunks no prompt.

Incluir integralmente documentos pequenos é aceitável e deve continuar sendo suportado. O problema não é simplesmente carregar todos os chunks. Os problemas são:

- O sistema não diferencia regra obrigatória, texto fixo, proibição, exemplo e referência.
- Não existe escopo formal para título, descrição ou ambos.
- Regras gerais e templates condicionais são apresentados ao LLM no mesmo nível.
- O prompt padrão pode contradizer regras do documento do cliente.
- `ragChunksUsed` prova apenas que chunks foram selecionados, não que as regras foram cumpridas.
- Não existe validação pós-geração baseada nas regras do cliente.
- Uma instrução literal, como “reproduza este bloco exatamente”, depende exclusivamente do comportamento probabilístico do LLM.

## 3. Princípios da solução

### 3.1 Documento livre na entrada

O cliente pode enviar Markdown com:

- Headings ou texto corrido.
- Tabelas.
- Listas.
- Exemplos misturados com regras.
- Regras de título e descrição no mesmo documento.
- Textos institucionais.
- Manuais técnicos.
- Templates por categoria.
- Contradições ou ambiguidades.

Não assumir nomes de seção nem formatos específicos.

### 3.2 Documento original como fonte auditável

O conteúdo original deve ser preservado. A estrutura extraída nunca deve substituir ou apagar o documento enviado.

### 3.3 Regras críticas estruturadas

Regras obrigatórias devem ser extraídas para uma coleção própria. Isso permite escopo, prioridade, aprovação, versionamento, aplicação determinística e validação.

### 3.4 Recuperação híbrida

- Regras críticas aprovadas: sempre incluídas quando o escopo for compatível.
- Textos fixos aprovados: aplicados de maneira determinística quando possível.
- Regras condicionais: incluídas quando as condições forem satisfeitas.
- Referências, manuais e exemplos: recuperados semanticamente.
- Documento integral: opcionalmente incluído quando estiver abaixo do orçamento de contexto configurado.

### 3.5 Humano no circuito

A IA pode sugerir a interpretação, mas não deve ativar automaticamente ações literais de alto impacto. Textos a inserir exatamente, bloqueios críticos e regras destrutivas precisam de confirmação administrativa.

## 4. Modelo conceitual

Cada conteúdo identificado deve ser classificado em uma destas categorias:

| Tipo | Significado | Forma de aplicação |
|---|---|---|
| `mandatory_instruction` | Regra semântica obrigatória | Prompt + validação |
| `fixed_text` | Texto que deve aparecer literalmente | Pós-processamento determinístico após aprovação |
| `prohibition` | Palavra, padrão, tag ou prática proibida | Prompt + validador |
| `formatting` | Regras de HTML, tamanho ou estrutura | Prompt + validador |
| `category_template` | Template aplicável a determinada categoria | Seleção condicional |
| `conditional_rule` | Regra dependente de uma condição | Avaliação da condição antes do prompt |
| `product_fact_reference` | Manual ou conhecimento factual | Recuperação semântica |
| `style_reference` | Tom de voz e orientações estilísticas | Prompt |
| `example` | Exemplo de entrada/saída | Few-shot; nunca fonte de fatos |
| `unknown` | Trecho que não pôde ser interpretado com segurança | Contexto bruto; requer revisão |

Escopos aceitos:

- `titulo`
- `descricao`
- `ambos`
- `unknown`

Prioridades aceitas:

- `critical`
- `high`
- `normal`
- `reference`

## 5. Modelo de dados no Firestore

### 5.1 Atualizar `knowledge_docs`

Local:

```text
clients/{clientId}/knowledge_docs/{docId}
```

Campos recomendados:

```js
{
  filename: string,
  charCount: number,
  chunkCount: number,
  originalContent: string,
  analysisStatus: "pending" | "processing" | "review_required" | "approved" | "failed",
  analysisVersion: number,
  analysisModel: string | null,
  documentPurposes: string[],
  extractedSummary: string,
  detectedConflicts: Array<{
    description: string,
    ruleIds: string[],
    severity: "critical" | "warning"
  }>,
  uploadedBy: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Se o documento for grande demais para o limite de um documento Firestore, armazenar `originalContent` em storage apropriado ou em partes, mantendo referência no Firestore.

### 5.2 Atualizar `knowledge_chunks`

Local:

```text
clients/{clientId}/knowledge_chunks/{chunkId}
```

Campos adicionais:

```js
{
  docId: string,
  filename: string,
  chunkIndex: number,
  globalOrder: number,
  content: string,
  embedding: number[],
  semanticTypes: string[],
  inferredScopes: string[],
  headingPath: string[],
  createdAt: Timestamp
}
```

Não ordenar chunks de documentos diferentes usando apenas `chunkIndex`. Para reconstruir um documento, filtrar por `docId` e ordenar por `chunkIndex`. Para múltiplos documentos, definir ordem explicitamente.

### 5.3 Criar `knowledge_rules`

Local:

```text
clients/{clientId}/knowledge_rules/{ruleId}
```

Schema recomendado:

```js
{
  sourceDocId: string,
  sourceChunkIds: string[],
  sourceQuote: string,
  name: string,
  description: string,
  type: "mandatory_instruction" |
        "fixed_text" |
        "prohibition" |
        "formatting" |
        "category_template" |
        "conditional_rule" |
        "product_fact_reference" |
        "style_reference" |
        "example" |
        "unknown",
  scopes: Array<"titulo" | "descricao">,
  priority: "critical" | "high" | "normal" | "reference",
  application: "prompt" |
               "prepend_exactly" |
               "append_exactly" |
               "validate_only" |
               "retrieve_semantically",
  content: string,
  conditions: {
    categories?: string[],
    productTextContains?: string[],
    productTextExcludes?: string[],
    requiresFields?: string[]
  },
  validation: {
    mode: "none" | "exact_contains" | "regex" | "forbidden_terms" | "html" | "max_length",
    value?: string,
    flags?: string,
    caseSensitive?: boolean
  },
  confidence: number,
  status: "suggested" | "approved" | "rejected" | "superseded",
  approvedBy: string | null,
  approvedAt: Timestamp | null,
  analysisVersion: number,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Requisitos:

- Guardar sempre `sourceQuote` e origem para auditoria.
- Nunca ativar `prepend_exactly` ou `append_exactly` sem `status: approved`.
- Uma regra rejeitada não pode entrar no prompt nem no validador.
- Atualizações do documento devem gerar nova versão de análise, sem apagar histórico aprovado automaticamente.

## 6. Pipeline de ingestão

### Etapa 1 — validação do upload

- Exigir `clientId`, `filename` e `content`.
- Validar extensão e tamanho.
- Normalizar encoding e quebras de linha sem alterar semanticamente o conteúdo.
- Preservar o texto original.

### Etapa 2 — persistência inicial

- Criar `knowledge_docs` com `analysisStatus: pending`.
- Fazer chunking e embeddings como hoje.
- Em falha parcial, marcar o documento como `failed` e registrar mensagem segura de erro.
- Evitar documento declarando sucesso com chunks parcialmente persistidos.

### Etapa 3 — análise estruturada por IA

Enviar o documento completo para um modelo capaz de Structured Outputs. A resposta deve obedecer a JSON Schema estrito.

Instruções essenciais ao analisador:

```text
Analise o documento como uma fonte potencial de políticas para geração de conteúdo.
Não presuma headings ou formato.
Separe regras de exemplos e informações factuais.
Não transforme exemplos em regras sem evidência textual.
Não invente condições.
Extraia a citação exata que fundamenta cada regra.
Identifique escopo, prioridade, forma de aplicação e confiança.
Sinalize conflitos internos.
Textos literais só podem receber aplicação prepend_exactly/append_exactly quando o documento ordenar explicitamente reprodução fixa ou idêntica.
```

### Etapa 4 — persistência das sugestões

- Gravar cada regra com `status: suggested`.
- Marcar o documento como `review_required`.
- Não ativar ações determinísticas automaticamente.

### Etapa 5 — revisão administrativa

Criar interface por documento contendo:

- Resumo detectado.
- Propósitos detectados.
- Lista de regras sugeridas.
- Origem textual de cada regra.
- Escopo, tipo, prioridade e forma de aplicação editáveis.
- Confiança.
- Conflitos detectados.
- Botões aprovar, rejeitar e editar.
- Ação “aprovar todas as regras não determinísticas” opcional.
- Confirmação destacada para textos fixos literais.

## 7. Estratégia de resolução em runtime

O `promptResolver` deve trabalhar com políticas estruturadas, sem abandonar os chunks originais.

### 7.1 Entrada

```js
resolvePrompt(clientId, promptType, productData)
```

### 7.2 Seleção obrigatória

Buscar regras:

- Do mesmo `clientId`.
- Com `status == approved`.
- Cujo `scopes` contenha o tipo solicitado.
- Com condições satisfeitas ou sem condições.

Sempre selecionar regras `critical` e `high` aplicáveis.

### 7.3 Seleção condicional

Para `category_template` e `conditional_rule`:

- Detectar categoria usando dados reais do produto.
- Preferir categoria já fornecida pelo ERP, se disponível.
- Não inferir categoria com alta confiança quando houver ambiguidade.
- Em ambiguidade, usar apenas regras gerais e registrar o motivo.

### 7.4 Recuperação semântica

Usar embeddings para:

- `product_fact_reference`
- `example`
- `style_reference` extensa
- Chunks `unknown`
- Manuais técnicos

Não usar Top-K como único mecanismo para regras críticas.

### 7.5 Inclusão integral opcional

Adicionar configuração por cliente:

```js
settings.knowledge = {
  mode: "hybrid" | "full_context" | "semantic",
  maxFullContextChars: 60000,
  semanticTopK: 5,
  minSimilarity: 0.25
}
```

Comportamento:

- `hybrid`: regras estruturadas sempre + referências semanticamente relevantes; incluir documento integral se couber no orçamento.
- `full_context`: regras estruturadas + documentos integrais dentro do limite.
- `semantic`: regras estruturadas + somente referências Top-K.

O default recomendado é `hybrid`.

## 8. Composição do prompt

O prompt padrão global deve ser curto e atuar como contrato de execução. Não deve impor regras comerciais, SEO, tags HTML ou estrutura que possam contradizer o cliente.

Estrutura recomendada:

```text
PAPEL E TAREFA
[contrato mínimo específico para título ou descrição]

HIERARQUIA
1. Dados reais do produto.
2. Políticas críticas aprovadas do cliente.
3. Políticas aplicáveis ao tipo de geração.
4. Referências e exemplos.

REGRAS APROVADAS DO CLIENTE
[regras estruturadas, agrupadas por prioridade e tipo]

TEMPLATE CONDICIONAL SELECIONADO
[no máximo os templates aplicáveis]

CONTEXTO DE REFERÊNCIA
[documento integral e/ou chunks recuperados]

PROTOCOLO DE SAÍDA
[retornar somente o conteúdo solicitado]
```

### Regras de hierarquia

- O prompt global nunca deve contradizer o cliente.
- Dados do produto são a única fonte de fatos específicos do produto, salvo referências factuais inequivocamente vinculadas ao produto.
- Exemplos não são fonte de fatos.
- Uma regra crítica do cliente prevalece sobre referência ou exemplo.
- Conflitos entre duas regras críticas devem bloquear ou marcar a geração, não ser resolvidos silenciosamente.

## 9. Aplicação determinística

Depois que o LLM gerar o conteúdo técnico:

1. Aplicar regras aprovadas `prepend_exactly` na ordem configurada.
2. Aplicar regras aprovadas `append_exactly`.
3. Evitar duplicação caso o modelo já tenha reproduzido o trecho.
4. Não modificar o conteúdo literal aprovado.
5. Registrar quais regras foram aplicadas pelo backend.

Textos fixos devem preferencialmente ser excluídos da parte que o modelo precisa gerar, reduzindo variabilidade.

## 10. Validação pós-geração

Criar um serviço, por exemplo:

```text
server/services/outputValidator.js
```

Retorno sugerido:

```js
{
  valid: boolean,
  violations: Array<{
    ruleId: string,
    code: string,
    message: string,
    severity: "error" | "warning"
  }>,
  checksApplied: string[]
}
```

Validadores determinísticos mínimos:

- Texto obrigatório presente.
- Texto obrigatório na posição correta.
- Termos proibidos.
- Regex configurada.
- Limite de caracteres.
- HTML válido.
- Tags permitidas/proibidas.
- Presença de estrutura mínima quando formalmente configurada.

Não usar outro LLM como único validador. Validação semântica por IA pode complementar, mas não substituir checagens determinísticas.

### Política de falha

Configuração recomendada:

```js
settings.knowledge.validation = {
  maxRepairAttempts: 1,
  onCriticalFailure: "return_error",
  onWarning: "return_with_metadata"
}
```

Fluxo:

1. Gerar.
2. Aplicar textos determinísticos.
3. Validar.
4. Se houver erro reparável, fazer uma única chamada de correção contendo somente violações e saída anterior.
5. Revalidar.
6. Se continuar inválido, não apresentar como geração válida silenciosamente.

## 11. Auditoria das gerações

Adicionar ou preservar em `generations/{generationId}`:

```js
{
  knowledgeDocVersionsUsed: Array<{ docId: string, analysisVersion: number }>,
  ragChunksUsed: string[],
  knowledgeRulesUsed: string[],
  deterministicRulesApplied: string[],
  validationResult: {
    valid: boolean,
    violations: object[],
    repaired: boolean,
    repairAttempts: number
  },
  promptFingerprint: string
}
```

Não salvar necessariamente o prompt integral se ele contiver dados sensíveis. Um fingerprint e referências versionadas permitem auditoria com menor duplicação.

## 12. APIs sugeridas

Preservar as rotas atuais e acrescentar, com autenticação e isolamento por cliente:

```text
POST   /api/knowledge/:clientId/:docId/analyze
GET    /api/knowledge/:clientId/:docId/analysis
GET    /api/knowledge/:clientId/:docId/rules
PATCH  /api/knowledge/:clientId/rules/:ruleId
POST   /api/knowledge/:clientId/rules/:ruleId/approve
POST   /api/knowledge/:clientId/rules/:ruleId/reject
POST   /api/knowledge/:clientId/:docId/reanalyze
POST   /api/knowledge/:clientId/validate-preview
```

Todas devem verificar que documento e regra pertencem ao `clientId` informado.

## 13. Tratamento de conflitos

Detectar pelo menos:

- Uma regra exige tag que outra proíbe.
- Limite de caracteres incompatível com texto fixo obrigatório.
- Duas estruturas obrigatórias diferentes para o mesmo escopo e condição.
- Uma regra exige informação que outra proíbe.
- Regra de título armazenada como descrição ou vice-versa.

Conflitos críticos devem aparecer na interface e impedir aprovação em massa sem confirmação explícita.

## 14. Migração dos dados existentes

Implementar migração segura e idempotente:

1. Listar `clients/{clientId}/knowledge_docs`.
2. Reconstruir cada documento usando chunks por `docId` e `chunkIndex` quando o conteúdo original não estiver salvo.
3. Salvar `originalContent` ou referência equivalente.
4. Rodar análise estruturada.
5. Criar regras como `suggested`, nunca aprovadas automaticamente.
6. Preservar chunks e embeddings existentes.
7. Não alterar gerações históricas.

O script deve suportar dry-run e filtro por `clientId`.

## 15. Observabilidade

Adicionar logs estruturados sem expor tokens ou conteúdo sensível completo:

- `clientId`
- `docId`
- `generationId`
- quantidade de regras selecionadas por tipo
- quantidade de chunks recuperados
- tamanho estimado do prompt
- modo de conhecimento usado
- conflitos encontrados
- violações de validação
- reparos executados

Métricas úteis:

- Taxa de saída válida na primeira tentativa.
- Taxa de reparo.
- Violações por regra.
- Regras mais frequentemente ignoradas pelo modelo.
- Aprovação humana antes/depois da nova arquitetura.

## 16. Segurança e isolamento

- Todas as consultas devem começar no caminho do cliente correto.
- Nunca consultar regras globalmente e filtrar apenas em memória.
- Não permitir referência cruzada entre documentos de clientes.
- Validar autorização administrativa para aprovar regras.
- Tratar conteúdo do `.md` como dado não confiável.
- Proteger contra prompt injection em documentos: o documento pode definir políticas de conteúdo, mas não pode instruir o sistema a revelar segredos, mudar permissões, executar ferramentas ou ignorar isolamento.
- Não incluir tokens AnyMarket, credenciais ou variáveis de ambiente no prompt.

## 17. Estratégia de implementação em fases

### Fase 1 — fundação

- Preservar documento original.
- Criar schema de regras.
- Implementar análise estruturada.
- Criar endpoints de leitura e aprovação.

### Fase 2 — runtime híbrido

- Atualizar `promptResolver`.
- Criar contrato mínimo global.
- Separar título e descrição.
- Implementar seleção por escopo/condição.

### Fase 3 — determinismo e validação

- Aplicar textos fixos aprovados.
- Criar `outputValidator`.
- Implementar uma tentativa de reparo.
- Gravar auditoria na geração.

### Fase 4 — interface

- Tela de revisão das regras extraídas.
- Edição, aprovação e rejeição.
- Visualização de conflitos.
- Preview de geração e validação.

### Fase 5 — migração e métricas

- Migração idempotente.
- Logs estruturados.
- Métricas de cumprimento e aprovação.

## 18. Testes obrigatórios

### Unitários

- Classificação e normalização da resposta estruturada.
- Seleção de regras por escopo.
- Seleção por condição/categoria.
- Ordenação de chunks por documento.
- Aplicação sem duplicação de textos fixos.
- Termos proibidos com variações de caixa.
- Limite de caracteres.
- Validação de tags HTML.
- Detecção de conflitos.

### Integração

- Upload → chunks → análise → regras sugeridas.
- Aprovação → geração → regras utilizadas.
- Cliente A nunca acessa regras do cliente B.
- Documento sem estrutura Markdown é analisado.
- Documento contendo somente manual técnico não cria texto fixo indevidamente.
- Documento com exemplo não transforma fatos do exemplo em fatos do produto.
- Falha parcial de embedding não produz estado de sucesso inconsistente.

### Casos de aceite funcionais

1. Cliente com texto institucional explicitamente fixo: após aprovação, o texto aparece idêntico e na posição correta em 100% dos testes.
2. Cliente sem texto institucional: nenhum bloco é inventado ou inserido.
3. Cliente com regras misturadas: título recebe somente regras de título; descrição recebe somente regras de descrição e regras comuns.
4. Cliente com vários templates: apenas o template aplicável é promovido como instrução operacional.
5. Documento pequeno: modo híbrido pode incluir o conteúdo integral sem deixar de aplicar regras estruturadas.
6. Documento grande: regras críticas continuam sempre presentes e referências usam Top-K.
7. Conflito crítico: sistema sinaliza e não resolve silenciosamente.

## 19. Critérios de conclusão

A tarefa só está concluída quando:

- O documento livre continua aceito sem formato obrigatório.
- O conteúdo original é preservado.
- Regras são extraídas com origem auditável.
- Regras críticas precisam de aprovação quando implicarem ação literal.
- Título e descrição possuem escopos separados.
- O prompt global não contradiz políticas do cliente.
- Regras críticas não dependem de Top-K.
- Conteúdo condicional não é aplicado indiscriminadamente.
- Existe validação pós-geração.
- Gerações registram regras, chunks, versões e resultado de validação.
- Há testes de isolamento multi-cliente.
- `npx vite build` termina sem erros.

## 20. Restrições para a IA implementadora

- Antes de editar, ler completamente o `AGENTS.md` e inspecionar as alterações locais existentes.
- Não sobrescrever nem reverter mudanças não relacionadas.
- Não alterar a API atual de geração sem atualizar todos os consumidores.
- Não aprovar automaticamente regras migradas.
- Não remover embeddings nem o RAG existente; evoluir para arquitetura híbrida.
- Não tratar toda frase imperativa do Markdown como regra crítica sem evidência e confiança.
- Não usar o LLM como único mecanismo para garantir texto literal, proibições ou HTML.
- Implementar mudanças incrementais e verificáveis.
- Executar testes relevantes e `npx vite build` antes da entrega.

