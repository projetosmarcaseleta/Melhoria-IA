# Guia de Edição de Prompts do CRIA

> Para quem edita os prompts de **Título** e **Descrição** em ⚙️ Configurações.
> Responde: o que o prompt controla, o que ele **não** controla, e o que quebra se você mudar.

---

## 1. O prompt que você edita é uma de cinco camadas

Toda geração monta um texto único enviado ao modelo. Na ordem:

```
┌─ 1. REGRAS ESTRUTURADAS APROVADAS DO CLIENTE ─────────────┐
│    vêm das regras extraídas dos .md (aba Base RAG)        │
├─ 2. BASE DE CONHECIMENTO DO CLIENTE ──────────────────────┤
│    TODOS os chunks dos .md, em ordem                      │
│    ⚠ só entra em DESCRIÇÃO — título nunca recebe          │
├─ 3. INSTRUÇÕES DE GERAÇÃO E FORMATAÇÃO ───────────────────┤
│    ◄◄◄ É ISTO QUE VOCÊ EDITA NA TELA                      │
├─ 4. EXEMPLOS APROVADOS ANTERIORMENTE ─────────────────────┤
│    as 5 últimas gerações aprovadas/editadas deste cliente │
├─ 5. REGRAS DAS SKILLS ATIVAS ─────────────────────────────┤
│    termos proibidos, tom de voz, formatador HTML…         │
└───────────────────────────────────────────────────────────┘
         +
   Dados do produto (título, descrição e características originais),
   enviados SEPARADAMENTE como mensagem do usuário.
```

Duas consequências práticas:

- **Se a camada 2 tem manual de marca, ele é a autoridade.** Quando o `.md` do cliente
  manda usar uma estrutura de seções e o seu prompt manda outra, o modelo recebe
  ordens conflitantes. O resultado fica imprevisível. Ajuste o `.md`, não o prompt.
- **`{{title}}` e `{{description}}` NÃO funcionam.** Os dados do produto vão em
  mensagem separada; se você escrever essas variáveis no prompt, o modelo lê o texto
  literal `{{title}}`. Não use.

---

## 2. Qual prompt está realmente valendo

Existem quatro origens possíveis para a camada 3, e o sistema escolhe **uma**:

| Origem | Quando é usada |
|---|---|
| **Prompt do cliente** | Existe prompt salvo para este cliente. É o que a tela edita. Vence tudo. |
| **Prompt global** | Não há prompt do cliente e existe um documento em `global_prompts`. |
| **Alinhado à base de conhecimento** | Não há prompt do cliente **e** o cliente TEM `.md`/regras. Um texto curto que delega a estrutura ao manual da marca. |
| **Padrão embutido** | Não há prompt do cliente nem base de conhecimento. |

⚠️ **Cuidado importante:** o texto exibido na tela como *"MODO PADRÃO GLOBAL"* é uma
referência de leitura — ele **não** é necessariamente o que roda. Num cliente com base
de conhecimento e sem prompt próprio, quem roda é o *alinhado à base de conhecimento*,
que é um texto diferente e mais curto.

Para ver o que está valendo de fato, com as camadas ativas:

```bash
GET /api/prompts/:clientId/effective
```

Devolve `source` (qual das quatro origens), o texto-base, o prompt completo montado,
o tamanho em caracteres e a contagem de cada camada.

---

## 3. O que o prompt NÃO controla

Estas regras rodam em **código**, depois do modelo responder. Instrução em prompt não
as altera — e pedir o contrário no prompt só gera conflito:

| Etapa (código) | O que faz | Consequência |
|---|---|---|
| `sanitizeLLMOutput` | Remove cercas markdown (```` ```html ````) | Pedir "não use markdown" é redundante, mas inofensivo |
| `toTitleCase` | **Sempre** aplica Title Case pt-BR no título | Pedir título em CAIXA ALTA ou minúsculas **não funciona** |
| `applyDeterministicRules` | Insere blocos fixos (`prepend_exactly` / `append_exactly`) das regras aprovadas | O bloco institucional entra por código; **não repita no prompt** ou aparecerá duplicado |
| `enforceMaxLength` | Corta o título por palavra inteira no limite da skill | O limite da skill vence o número escrito no prompt |
| `validateOutput` | Acusa termo proibido, cerca markdown, excesso de caracteres e bloco fixo duplicado | Vira aviso no card do produto, não bloqueio |

Limites padrão de validação: **título 60** e **descrição 2000** caracteres.

---

## 4. O que você pode mudar com segurança

Estas mudanças afetam o **conteúdo** e não a mecânica:

- Ordem e prioridade dos atributos no título (ex.: modelo antes da marca)
- Quais atributos importam para a categoria do cliente (voltagem, material, capacidade)
- Tom de voz e vocabulário (embora o ideal seja a skill *Tom de Voz*)
- Estrutura de seções da descrição (parágrafo + lista, mais seções, ordem)
- Ênfase em SEO: quais termos priorizar, o que evitar
- Instruções de fidelidade ("não inventar especificação não informada")
- Exemplos dentro do prompt, para ancorar o formato

---

## 5. O que NÃO mudar — quebra o pipeline

O texto gerado vai **direto** para o campo do anúncio no AnyMarket. Não existe etapa
humana entre a resposta do modelo e o campo. Portanto:

### Título — mantenha sempre

```
- Retorne exclusivamente o texto do título otimizado.
- Uma única linha, sem aspas e sem ponto final.
- Proibido incluir explicações, notas de rodapé ou comentários.
```

**Se você remover isso**, o modelo pode responder `Aqui está o título otimizado: Panela
de Pressão 4,5L` — e esse texto inteiro, com o preâmbulo, vai para o marketplace.

### Descrição — mantenha sempre

```
Retornar apenas a descrição final.
Somente HTML válido utilizando <p>, <ul> e <li>.
Não incluir comentários, explicações ou qualquer texto fora do HTML.
```

E mantenha a proibição de `<h1>`/`<h2>`, tabelas, imagens e links: o campo de descrição
do AnyMarket é replicado para os marketplaces, e vários rejeitam ou desconfiguram essas
tags.

### Nunca faça

| Não faça | Por quê |
|---|---|
| Pedir JSON, markdown ou lista de opções | O texto vai cru para o campo do anúncio |
| Pedir "explique sua escolha" | A explicação virá dentro do título/descrição |
| Pedir mais de uma sugestão | O sistema usa a resposta inteira, não escolhe uma |
| Usar `{{title}}` / `{{description}}` | Não são substituídos |
| Repetir o bloco institucional fixo | O código já o insere; ficaria duplicado |
| Traduzir o protocolo de resposta para outro idioma | Some com a garantia de formato |

---

## 6. Permissões e rede de segurança

Qualquer operador autenticado edita os prompts do cliente. O controle não é quem pode
editar, e sim **a reversibilidade**:

- Cada gravação **arquiva a versão anterior** em `prompt_history`, com autor e data.
- `GET /api/prompts/:clientId/history/:type` lista as versões.
- `POST /api/prompts/:clientId/restore` com `{ type, historyId }` volta para uma versão,
  ou com `{ type, useDefault: true }` volta ao padrão do sistema.
- A restauração também arquiva o estado que está saindo — nenhum estado se perde.

---

## 7. Método recomendado para mudar um prompt

1. **Duplique antes de editar**: use *Copiar para Customizado* e trabalhe na cópia.
2. **Mude uma coisa por vez.** Alterar tom, estrutura e limites juntos torna impossível
   saber o que causou a piora.
3. **Teste em 5 produtos variados** — não em um. Um prompt que acerta uma categoria
   costuma errar outra.
4. **Compare com o histórico de aprovações.** Se a taxa de rejeição do cliente subir na
   aba Insights depois da mudança, restaure.
5. **Prefira a camada certa:**

| Objetivo | Onde mexer |
|---|---|
| Estrutura de seções da descrição por categoria | `.md` da Base RAG |
| Palavras proibidas | Skill *Filtro de Termos Proibidos* |
| Tom de voz | Skill *Estilo e Tom de Voz* |
| Limite de caracteres do título | Skill *Limite de Caracteres* |
| Bloco institucional fixo | Regra `prepend_exactly` na Base RAG |
| Raciocínio, prioridades, o que considerar | **Prompt** |

O prompt é para *como pensar*. As skills e o `.md` são para *o que é obrigatório*.
Regra prática: se precisa valer 100% das vezes, não deixe no prompt — o prompt é o
melhor esforço do modelo, e as outras camadas são garantidas por código.
