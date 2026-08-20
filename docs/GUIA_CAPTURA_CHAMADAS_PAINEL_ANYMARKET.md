# Guia — Capturando chamadas não documentadas do painel AnyMarket (DevTools)

> Objetivo: descobrir os endpoints reais usados pela tela de "Vínculo de Categorias" e pela árvore de categoria nativa do canal, que a doc pública da API não expõe. Sem acesso ao banco, a única fonte confiável é observar o próprio painel fazendo essas chamadas.

## O que ainda falta descobrir (das respostas da Parte A)

1. **Criar/atualizar o de-para** (`category_bind`) — a resposta confirmou que isso "é desenhado para ocorrer na tela de Vínculo de Categorias do painel", ou seja, provavelmente **não tem endpoint público** para escrever. Precisamos capturar o `POST`/`PUT`/`PATCH` que a tela dispara ao salvar um vínculo.
2. **Árvore nativa de categoria do canal** (para popular o "para onde vincular" na UI) — a resposta disse que "não é exposta diretamente via API REST aberta". Precisamos capturar a chamada que a tela faz quando abre o seletor de categoria do Mercado Livre/outro canal.
3. Opcionalmente: a chamada que preenche o formulário de atributos por categoria+canal na tela de cadastro de produto, para confirmar se bate com `/v2/categories/characteristics/groups` ou se há uma variante interna mais específica por canal.

## Passo a passo (Chrome ou Edge — DevTools)

1. **Abra o painel da AnyMarket já logado**, navegue até a tela de "Vínculo de Categorias" (ou onde estiver: configurações → categorias → canal).
2. Abra o DevTools (`F12` ou `Ctrl+Shift+I`) → aba **Network**.
3. Marque **"Preserve log"** (mantém as chamadas mesmo se a página navegar) e **desmarque cache** (checkbox "Disable cache") para garantir que toda chamada realmente vá para a rede.
4. No filtro de tipo, selecione **Fetch/XHR** (remove ruído de imagens, CSS, analytics).
5. Clique no ícone de "limpar" (🚫) para começar com a lista vazia.
6. **Execute manualmente, uma ação por vez**, a operação que você quer capturar:
   - Abrir o seletor de categoria do canal (ex.: escolher "Mercado Livre" e buscar uma categoria) → isso deve disparar a chamada da árvore nativa do canal.
   - Selecionar uma categoria do canal e **salvar o vínculo** → isso deve disparar a chamada de criação/atualização do `category_bind`.
   - Se possível, repita **desfazendo/alterando um vínculo existente** para capturar também o comportamento de update (não só de create).
7. Para cada chamada relevante que aparecer na lista (normalmente vai ser óbvio pelo nome do path, ex. `category-bind`, `marketplace-category`, `characteristics`):
   - Clique na chamada → aba **Headers**: anote **método** (GET/POST/PUT/PATCH), **URL completa**, e os **headers de autenticação** (`gumgaToken`, `Authorization`, ou se for **cookie de sessão** em vez de token — isso muda tudo, ver seção de riscos abaixo).
   - Aba **Payload**/**Request**: copie o corpo exato enviado.
   - Aba **Response**: copie o corpo exato recebido (status 200/201 e o formato do JSON).
   - Botão direito na chamada → **Copy → Copy as cURL (bash)**: isso dá um comando pronto para reproduzir fora do navegador (útil para testar depois se o endpoint aceita chamada direta com o mesmo token).

## Como registrar o que você encontrar

Depois de capturar, documente cada chamada no mesmo formato usado nas respostas da Parte A (endpoint, verbo, payload de exemplo, resposta, erros), mas marcando claramente:

```
⚠ Endpoint não documentado publicamente — obtido por engenharia reversa do painel em [data].
Sujeito a mudar sem aviso da AnyMarket. Revalidar periodicamente e ter fallback
(ex.: instruir o operador a resolver manualmente no painel) se o endpoint parar de responder.
```

Sugiro colar essas descobertas de volta no `docs/PROMPT_VINCULO_CANAIS_E_ATRIBUTOS.md`, completando a Parte A.1 (perguntas 3 e 4) e A.2 (se aplicável) com o que for encontrado.

## Riscos a verificar antes de automatizar em cima disso

1. **Tipo de autenticação**: se a chamada usa **cookie de sessão do painel** (login do usuário) em vez de `gumgaToken`/API key, ela **não é portável para automação server-to-server** sem simular sessão de navegador — isso é bem mais frágil (expira, pode exigir 2FA, pode ser bloqueado por detecção de bot). Confirme isso antes de assumir que dá para chamar esse endpoint direto do backend do CRIA.
2. **Suporte oficial**: como o próprio material já recomendou "confirmar o comportamento exato com o suporte/CS da AnyMarket", vale perguntar explicitamente ao suporte se esse endpoint interno tem uso server-to-server sancionado, ou se estão dispostos a liberar um endpoint público equivalente — evita depender de algo que pode quebrar sem aviso ou violar termos de uso da API.
3. **Não commitar token/cookie reais** nos exemplos salvos em `docs/` — redija (`{{TOKEN}}`, `{{SELLER_OI}}`) antes de colar qualquer payload capturado no repositório, mesmo que seja só para documentação interna.
4. Se o endpoint interno exigir cookie de sessão, o plano B é: o CRIA detecta e sinaliza "de-para faltando" (usando os endpoints públicos de transmissão que já temos — `GET /v2/transmissions?statusFilter=UNPUBLISHED`), mas a **ação de vincular continua sendo feita pelo operador no painel da AnyMarket**, com o CRIA só linkando/abrindo a tela certa — mais simples e mais robusto do que replicar uma chamada de sessão.

## Depois de capturar

Volte com o que encontrar (URL, payload, tipo de auth) que eu ajusto o plano de implementação (`Parte B` do prompt anterior) considerando se dá para automatizar o vínculo direto pelo CRIA ou se o fluxo correto é "detectar e direcionar o operador para o painel".
