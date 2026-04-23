# Workflows n8n — Melhoria de Descrição de Produtos

## Arquivo disponível

| Arquivo | Função |
|---------|--------|
| `01-consulta-produtos-por-ids.json` | Recebe IDs via POST e retorna dados completos do banco PostgreSQL |

---

## Como importar no n8n

1. Abra o n8n → **Workflows** → botão **⊕ Add workflow**
2. Clique no menu `⋮` (três pontos) no canto superior direito → **Import from file**
3. Selecione o arquivo `.json` desta pasta
4. Após importar, configure a credencial do **PostgreSQL** no nó `Buscar Produtos no PostgreSQL`
5. Clique em **Save** e depois em **Activate** (toggle no canto superior direito)

---

## Workflow 01 — Consulta Produtos por IDs

### Fluxo interno

```
POST /webhook/consultar-produtos
        ↓
[Receber IDs]          — Webhook node (aguarda o POST)
        ↓
[Preparar IDs para SQL] — Code node (sanitiza e formata IDs para cláusula IN)
        ↓
[Buscar Produtos no PostgreSQL] — Postgres node (executa SELECT com IN clause)
        ↓
[Formatar e Agregar Resposta]  — Code node (normaliza dados e agrupa em array)
        ↓
[Responder ao Webhook]  — Respond to Webhook node (retorna JSON)
```

### Requisição esperada (POST)

```json
{
  "ids": ["12345", "67890", "11111"]
}
```

### Resposta retornada

```json
{
  "products": [
    {
      "ID": "12345",
      "TITULO": "Nome do Produto",
      "DESCRICAO": "Descrição atual do produto...",
      "CARACTERISTICAS": [
        { "index": "Cor", "value": "Preto" },
        { "index": "Material", "value": "Alumínio" }
      ]
    }
  ]
}
```

### URL do webhook

Após ativar o workflow, a URL será:

```
https://SEU-N8N.com/webhook/consultar-produtos
```

Cole essa URL em **⚙️ Configurações** dentro da aplicação web, no campo **URL do Webhook n8n**.

---

## Credencial PostgreSQL necessária

O nó `Buscar Produtos no PostgreSQL` usa a credencial **PRD** (ID: `YnbEc2aEdTjtn8EY`).

Se o seu n8n for diferente, reconfigure o nó após importar:
- Clique no nó → botão de credencial → selecione ou crie a conexão PostgreSQL

---

## Tabelas acessadas

| Tabela | Uso |
|--------|-----|
| `anymarket_prd.product` | ID, título e descrição do produto |
| `anymarket_prd.product_attribute` | Atributos (nome + valor) |

---

## Segurança da query

Os IDs recebidos passam por sanitização no Code node antes de serem inseridos na query:

```javascript
// Aceita apenas: letras, números, hífen, underscore, ponto
const safe = ids.map(id => String(id).replace(/[^\w.-]/g, ''));
```

Isso previne SQL injection. Os IDs são tipicamente numéricos ou UUIDs.
