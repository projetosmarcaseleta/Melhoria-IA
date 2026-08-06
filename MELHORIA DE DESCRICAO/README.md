# 🛍️ Melhoria de Descrição de Produtos (Plataforma de Agentes de IA Evolutivos)

Plataforma multi-cliente com **aprendizado evolutivo contínuo** para otimização de títulos e descrições de produtos em marketplaces (AnyMarket) usando IAs Generativas da OpenAI e infraestrutura Firebase.

---

## 🌟 Principais Recursos

- **🏢 Multi-Cliente Isolado:** Cada cliente possui suas próprias regras, prompts, tokens do AnyMarket e base de conhecimento.
- **🔐 Autenticação & Permissões:** Login via Firebase Auth com papéis de `admin` e `editor`.
- **🧠 Aprendizado Evolutivo com Few-Shot:** Aprende a cada aprovação/edição feita pelo operador humano e reutiliza automaticamente como contexto para novas gerações.
- **📚 Base de Conhecimento RAG (.md):** Upload de manuais e regras da marca em Markdown com busca por similaridade semântica (OpenAI `text-embedding-3-small`).
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
