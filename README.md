# CRIA — Inteligência que cria anúncios

Agente de criação e enriquecimento de anúncios do ecossistema **AnyTools** (Marca Seleta). O CRIA é uma plataforma multi-cliente com **aprendizado evolutivo contínuo** para otimização de títulos e descrições de produtos em marketplaces (AnyMarket) usando IAs Generativas da OpenAI e infraestrutura Firebase.

---

## 🌟 Principais Recursos

- **🏢 Multi-Cliente Isolado:** Cada cliente possui suas próprias regras, prompts, tokens do AnyMarket e base de conhecimento.
- **🔐 Autenticação & Permissões:** Login via Firebase Auth com papéis de `admin` e `editor`.
- **🧠 Aprendizado Evolutivo com Few-Shot:** Aprende a cada aprovação/edição feita pelo operador humano e reutiliza as 5 avaliações mais recentes como contexto para novas gerações.
- **📚 Base de Conhecimento (.md) com extração de regras por IA:** Upload de manuais e regras da marca em Markdown; a OpenAI classifica o documento em regras tipadas (texto fixo, proibições, instruções obrigatórias, formatação) e o contexto completo é injetado nas gerações.
- **✅ Validação pós-geração:** Cada anúncio gerado é checado contra as regras do cliente (termos proibidos, limite de caracteres, bloco institucional duplicado) e o CRIA avisa o operador do que precisa de revisão.
- **⚡ Habilidades Personalizadas (Skills):** Filtro de palavras banidas por cliente, definição de tom de voz e padronizador de HTML.
- **📈 Insights & Meta-Prompting:** Dashboard de métricas e autorrefinamento de prompts acionado via GPT-4o.
- **🚀 Integração AnyMarket:** Sincronização direta de atualizações (PATCH) via webhooks do n8n.

---

## 🚀 Como Rodar

### 1. Pré-requisitos
Node.js (v18+) e uma conta no Firebase / OpenAI.

### 2. Instalação
```bash
npm install
```

### 3. Configuração (.env)
Copie o arquivo `.env.example` para `.env` e preencha suas credenciais:
```bash
cp .env.example .env
```

### 4. Cadastrar Operador Administrador
```bash
node server/scripts/createOperator.js "admin@empresa.com" "senha123" "Administrador"
```

### 5. Executar Servidores de Desenvolvimento
```bash
npm run dev
```

Acesse a interface no navegador em **http://localhost:5173**.

---

## 📖 Documentação Técnica para IAs e Desenvolvedores

Para entender em detalhes a arquitetura de 4 camadas, esquema das coleções do Firestore, catálogo de rotas e fluxo de código, consulte o arquivo **[AGENTS.md](file:///c:/Users/igor.costa/OneDrive%20-%20DB1%20Group/Documentos/MELHORIA%20DE%20DESCRICAO/MELHORIA%20DE%20DESCRICAO/AGENTS.md)**.
