---
name: client_onboarding
description: Skill de automação para onboarding de novos clientes no sistema de melhoria de descrição com IA, incluindo criação no Firestore, geração de tokens e injeção de prompts default.
---

# Client Onboarding Skill

Esta skill automatiza a criação de novos clientes na plataforma multi-cliente.

## Ações Executadas:

1. **Criação do Cliente no Firestore:**
   - Cria o documento na coleção `clients` com `name`, `slug`, `anymarket_token`, `isActive: true` e `settings` de IA.

2. **Inicialização dos Prompts Padrão:**
   - Grava a versão inicial (`version 1`) dos prompts de Título e Descrição na subcoleção `clients/{clientId}/prompts/`.

3. **Ativação de Skills Iniciais:**
   - Ativa as habilidades recomendadas (`anti_forbidden_words`, `html_spec_formatter`) na subcoleção `clients/{clientId}/skills/`.

## Script Helper:

Execute via terminal:
```bash
node server/scripts/createClient.js "Nome do Cliente" "slug-do-cliente" "TOKEN_ANYMARKET"
```
