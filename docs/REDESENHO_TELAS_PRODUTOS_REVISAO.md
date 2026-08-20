# Redesenho estrutural — telas de Produtos e Revisão (2026-08-20)

## 0. Correção de uma premissa

A primeira leitura suspeitou que o brand book não estava na tela, porque os componentes
usavam `slate-*`/`indigo-*` do Tailwind em vez das CSS vars do `index.css` (536 usos contra
143). **Isso estava errado**: o `tailwind.config.js` sobrescreve as duas paletas com os
valores CRIA — `slate-900` = `#111A46` (navy da marca), `slate-950` = `#0a0e2c` =
`--bg-primary`, `indigo-500` = `#336CFF`. As classes Tailwind *já são* a marca. Não houve,
portanto, nenhuma migração de cor: a paleta ficou como estava.

O que sobrou de trabalho real: hierarquia, fluxo, densidade, diff, ícones e a duplicação dos
mapas de token.

## 1. Problemas atacados

| # | Problema | O que era | O que ficou |
|---|---|---|---|
| 1 | Fluxo espalhado | "1./2./3./4." em 3 lugares e 3 pesos visuais; o passo 3 (ação principal) menor que o passo 2 | Numeração removida; o cartão de carga recolhe após a busca; uma ação primária por tela |
| 2 | Três nomes para a mesma ação | "3. Processar com IA", "✨ Criar com o CRIA", "🔄 Refazer IA" | "Gerar com IA" (lote novo) e "Gerar novamente" (refazer) |
| 3 | Revisão não escalava | cards fixos de ~600px × N produtos, sem colapso nem teclado | linha compacta (~44px) que expande; `J/K/Enter/Espaço/A/Esc`; expandir/recolher tudo |
| 4 | Sem diff na hora de decidir | dois textos lado a lado, comparação a olho | diff palavra-por-palavra na própria fila e no editor (`utils/diffUtils.js`) |
| 5 | Ação irreversível explicada em tooltip | "Só aprovar" vs "Aprovar e publicar" só no atributo `title` | linha de legenda visível sob os botões dizendo o que cada um faz |
| 6 | Duas aprovações paralelas | ✅ do card (feedback) e seleção da toolbar não se falavam | aprovar no item também seleciona o produto |
| 7 | Revisão de HTML, não de conteúdo | textarea monoespaçada; prévia era opt-in | 3 modos: **Prévia** (padrão), **Diferenças**, **HTML** |
| 8 | Falso alarme no contador | âmbar entre 70% e 100% → 59/60 (ideal) aparecia como aviso | vermelho só ao estourar; âmbar só se curto demais; com legenda do motivo |
| 9 | Ruído no topo | TokenBar em tamanho de herói + 5 cards mostrando `1/0/0/0/0` | token em uma linha (grande só se faltar); faixa de status proporcional |
| 10 | Emoji como sistema de ícones | ~40 emoji, desenho variando por SO, 👁️ com dois significados | `icons/Icon.jsx`, SVG de traço herdando `currentColor` |
| 11 | Sem hierarquia tipográfica | 52 das 58 declarações de tamanho ≤12px, com `font-extrabold` e caixa alta | escala de 5 níveis (`.t-page/.t-card/.t-body/.t-meta/.t-label`) |
| 12 | Tokens duplicados | `TYPE_BADGE`/`STATUS_LABEL` em 3 arquivos, já divergentes | `ui/productTokens.js` como fonte única |

## 2. Bugs corrigidos no caminho

1. **Seleção partida em duas na Revisão.** O painel usava `useState` local (`selected`)
   enquanto a `FloatingActionBar` lia `ui.selectedIds` do store: na aba Revisão a barra
   mostrava a contagem da aba *Produtos* e os botões agiam sobre outra lista. A seleção
   passou a viver no store (`setSelectedIds`), e a barra flutuante ficou restrita à aba de
   Produtos — a Revisão agora tem sua própria barra fixa, sem duas superfícies de ação
   competindo na mesma tela.

2. **Uma chamada de rede por tecla digitada.** `handleEditTitle`/`handleEditDescription`
   chamavam `submitFeedback(genId, 'edited', …)` a cada `onChange`. Agora o estado local
   atualiza na hora e o envio é debounced em 700ms (`FEEDBACK_DEBOUNCE_MS`), com os timers
   pendentes descartados na desmontagem.

3. **Token gravado no lugar de menor prioridade.** Quem publica lê
   `activeClient.anymarket_token || config.gumgaToken`, mas a `TokenBar` escrevia só no
   segundo — então "Alterar" não surtia efeito em cliente com token próprio cadastrado. A
   edição de um token existente foi para o `ConfigModal` (que grava nos dois), a barra agora
   diz **de onde** vem o token que está valendo, e o campo inline sobrou só para o caso em
   que não existe token nenhum (onde não há precedência a violar).

4. **Aprovar no item ligava e desligava a seleção.** Introduzido nesta rodada e corrigido:
   o botão de aprovar dispara os feedbacks de título e descrição no mesmo tick; ambos liam a
   seleção do closure (defasada) e o segundo `toggle` desfazia o primeiro. Passou a ler
   `useStore.getState().ui.selectedIds`.

5. **Prévia de HTML sem estilo.** `dangerouslySetInnerHTML` sem CSS fazia `<p>` e `<ul>`
   colarem num bloco só — a prévia mentia sobre o resultado. Agora existe `.rich-text`.

## 3. Arquivos

**Novos**
- `src/components/icons/Icon.jsx` — ~50 ícones SVG de traço; segue a convenção do `CriaSymbol.jsx`.
- `src/components/ui/productTokens.js` — `TYPE_BADGE`, `STATUS`, `TONE`, `canPatchProduct`, `blockReason`, `titleMeter`.
- `src/components/ui/primitives.jsx` — `Button`, `IconButton`, `Badge`, `TypeBadge`, `Panel`, `PanelHeader`, `Meter`, `DiffText`, `EmptyState`, `Kbd`.
- `src/utils/diffUtils.js` — `wordDiff` (LCS), `diffSummary`, `htmlToText`.
- `src/components/ReviewProductRow.jsx` — a linha/editor de um produto na fila.

**Reescritos** — `ProductTable.jsx`, `ReviewPanel.jsx`, `Header.jsx`, `StatusDashboard.jsx`,
`TokenBar.jsx`, `FloatingActionBar.jsx`, `PipelineWizard.jsx` (só apresentação).

**Editados** — `index.css` (escala tipográfica, `.diff-add/.diff-del`, `.rich-text`, `.kbd`,
`.sticky-toolbar`), `store/useStore.js` (ação `setSelectedIds`).

Nenhuma alteração no backend, nos serviços ou nos handlers de negócio: os fluxos de
`processProductsWithAI`, `patchProduct`, `submitFeedback`, `parallelProcess` e o modal de
produtos bloqueados seguem com a mesma lógica.

## 4. Verificação

- `npm run build` — ok (268 módulos, exit 0).
- `npm test` — 189/189 testes do backend passando.
- Servidor de dev sobe e transforma todos os módulos novos (200 em `/edit/src/...`; atenção
  que o `vite.config.js` usa `base: '/edit/'`).
- **Não verificado**: renderização em navegador de verdade. O ambiente desta rodada não tem
  browser, e a tela exige login no Firebase. Os atalhos de teclado, a rolagem da fila longa e
  o comportamento da barra fixa precisam de um passo manual.

## 5. Pendências deixadas de propósito

1. **Emoji no resto do app.** Só as telas em escopo foram convertidas. Continuam com emoji:
   `AdminPanel` (21), `HelpCenter` (21), `ConfigModal` (15), `KnowledgeManager` (12),
   `ChannelBindingPanel` (10), `ClientDashboard` (10), `CategoryModal` (9), e outros menores.
   O `Icon.jsx` já cobre o vocabulário necessário.
2. **A entrada do wizard não foi promovida a ação primária.** "Processar em etapas" saiu de
   4º-de-6 para posição visível, mas o primário continua "Aprovar e publicar": pelo §3.1 do
   `PLANO_WIZARD_PIPELINE.md` só a Etapa 3 do wizard existe de fato. Promover antes disso
   empurraria o operador para um fluxo com três quartos de placeholder.
3. **"Pular esta etapa" e "Avançar" ainda são o mesmo handler** no wizard — o registro de
   `pipeline_skips` (§2.2 do plano) não existe, então pular é literalmente seguir adiante.
4. **Sem virtualização na fila.** A linha compacta reduziu a altura por item em ~13×; se um
   lote de 200+ ainda pesar, o próximo passo é virtualizar, não voltar a encolher a linha.
5. **`ProcessingBar` e `StatusToast`** ainda têm emoji e tipografia própria — ficaram de fora
   por serem transversais a telas não redesenhadas.

## 6. Ajustes após o primeiro uso (2026-08-20)

### 6.1 O diff no título confundia mais do que ajudava

O título aparecia com marcação palavra-por-palavra em três lugares ao mesmo tempo: na linha da
fila, num bloco de diff no editor e no campo editável. Misturar `Palio(2pcs)` riscado com
`Palio` novo na mesma frase obrigava a decodificar a frase em vez de ler o resultado.

**Corrigido**: voltou a apresentação em painéis rotulados — **Título atual** | **Título gerado
(IA)**, com o campo editável no painel da direita, como era antes. Na linha da fila o título
gerado aparece limpo, sem marcação. O diff continua disponível num modo à parte
(`Atual / Gerado` ↔ `Diferenças`), com o comparativo como padrão.

### 6.2 A prévia da descrição saía como parágrafo corrido

Diagnóstico: o `.rich-text` estava correto no bundle — o problema era o conteúdo. O prompt de
descrição exige HTML (`promptResolver.js`, item 6: apenas `<p>`, `<strong>`, `<ul>`, `<li>`),
mas o modelo às vezes devolve texto puro com quebras de linha, e o backend não normaliza —
`sanitizeLLMOutput` só remove cercas markdown. Resultado: a aba **Diferenças** mostrava as
quebras (porque preserva `\n`) e a **Prévia** colapsava tudo (porque HTML ignora `\n`). As duas
estavam certas; o conteúdo é que não era HTML.

**Corrigido**:
- A prévia ganhou destaque: 2/3 da largura, rotulada "Como vai aparecer no anúncio", com a
  descrição atual como referência secundária em 1/3.
- Quando o conteúdo não tem tag de bloco (`hasBlockHtml`), a prévia renderiza as quebras de
  linha **e** exibe um aviso de que o publicado é texto puro — sem embelezar escondido, porque
  o marketplace mostraria corrido de verdade.
- Botão **Converter em HTML** no aviso: aplica `plainTextToHtml` ao conteúdo gerado (`<p>` por
  bloco, `<br>` por linha), deixando o publicado igual à prévia.

**Não feito, decisão em aberto**: normalizar no backend, dentro de `sanitizeLLMOutput` ou
depois dele, para que toda descrição sem tag de bloco já saia como HTML. Resolveria na fonte
(inclusive para o que é publicado sem passar por revisão), mas muda o conteúdo gravado em
`generations` e o que vai para a AnyMarket — está fora de "redesenho de telas" e precisa de
decisão.
