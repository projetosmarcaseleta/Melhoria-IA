-- ═══════════════════════════════════════════════════════════════
-- Migration: Fase 1 — Fundação Multi-Cliente
-- Execute este SQL no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── Extensões ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════
-- TABELA: operator (perfil dos membros da equipe de cadastro)
-- Vinculado ao auth.users do Supabase Auth
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS operator (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'editor'
                CHECK (role IN ('admin', 'editor')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: client (cada cliente/loja/marca)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    anymarket_token TEXT,
    settings        JSONB NOT NULL DEFAULT '{
        "ai_provider": "openai",
        "model": "gpt-4o-mini",
        "temperature": 1.0,
        "max_description_length": 2000,
        "max_title_length": 60
    }'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: prompt_template (prompts por cliente)
-- client_id NULL = prompt global default
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS prompt_template (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID REFERENCES client(id) ON DELETE CASCADE,
    prompt_type TEXT NOT NULL CHECK (prompt_type IN ('titulo', 'descricao')),
    content     TEXT NOT NULL,
    version     INT NOT NULL DEFAULT 1,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(client_id, prompt_type, version)
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: skill_definition (catálogo de skills disponíveis)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS skill_definition (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    prompt_injection TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: client_skill (skills ativas por cliente)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_skill (
    client_id   UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    skill_id    TEXT NOT NULL REFERENCES skill_definition(id) ON DELETE CASCADE,
    config      JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY(client_id, skill_id)
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: generation (cada título/descrição gerada)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS generation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    operator_id         UUID NOT NULL REFERENCES auth.users(id),
    product_id          TEXT NOT NULL,
    generation_type     TEXT NOT NULL CHECK (generation_type IN ('titulo', 'descricao')),

    -- Input
    input_title         TEXT,
    input_description   TEXT,
    input_characteristics TEXT,

    -- Config no momento da geração
    prompt_version      INT NOT NULL,
    model_used          TEXT NOT NULL,
    temperature_used    REAL NOT NULL,
    rag_chunks_used     TEXT[] DEFAULT '{}',
    skills_applied      TEXT[] DEFAULT '{}',

    -- Resultado
    generated_text      TEXT NOT NULL,

    -- Feedback
    feedback_status     TEXT NOT NULL DEFAULT 'pending'
                        CHECK (feedback_status IN ('pending', 'approved', 'rejected', 'edited')),
    edited_text         TEXT,
    feedback_reason     TEXT,
    feedback_by         UUID REFERENCES auth.users(id),
    feedback_at         TIMESTAMPTZ,

    -- Aplicação
    applied_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: knowledge_document (arquivo .md do cliente)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS knowledge_document (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    uploaded_by UUID REFERENCES auth.users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: knowledge_chunk (pedaço embedado para RAG)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    client_id   UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    embedding   vector(1536),
    chunk_index INT NOT NULL,

    UNIQUE(document_id, chunk_index)
);

-- ═══════════════════════════════════════════════════════════════
-- TABELA: client_insight (métricas calculadas por cliente)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_insight (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    generation_type         TEXT NOT NULL CHECK (generation_type IN ('titulo', 'descricao')),

    total_generations           INT DEFAULT 0,
    total_approved              INT DEFAULT 0,
    total_rejected              INT DEFAULT 0,
    total_edited                INT DEFAULT 0,
    approval_rate               REAL,
    avg_approved_length         INT,
    avg_rejected_length         INT,
    frequently_rejected_terms   JSONB DEFAULT '[]',
    frequently_approved_patterns JSONB DEFAULT '[]',
    recommended_temperature     REAL,

    computed_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(client_id, generation_type)
);

-- ═══════════════════════════════════════════════════════════════
-- ÍNDICES
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_gen_client_type
    ON generation(client_id, generation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gen_client_feedback
    ON generation(client_id, feedback_status);

CREATE INDEX IF NOT EXISTS idx_gen_client_approved
    ON generation(client_id, generation_type, feedback_status)
    WHERE feedback_status IN ('approved', 'edited');

CREATE INDEX IF NOT EXISTS idx_chunk_embedding
    ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_prompt_active
    ON prompt_template(client_id, prompt_type)
    WHERE is_active = true;

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

-- Operadores: apenas o próprio usuário lê seu perfil
ALTER TABLE operator ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
    ON operator FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Users can read all operators"
    ON operator FOR SELECT
    USING (auth.role() = 'authenticated');

-- Clientes: qualquer operador autenticado pode ler
ALTER TABLE client ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read clients"
    ON client FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can manage clients"
    ON client FOR ALL
    USING (auth.role() = 'authenticated');

-- Prompts: acesso autenticado
ALTER TABLE prompt_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage prompts"
    ON prompt_template FOR ALL
    USING (auth.role() = 'authenticated');

-- Gerações: acesso autenticado
ALTER TABLE generation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage generations"
    ON generation FOR ALL
    USING (auth.role() = 'authenticated');

-- Knowledge: acesso autenticado
ALTER TABLE knowledge_document ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage knowledge docs"
    ON knowledge_document FOR ALL
    USING (auth.role() = 'authenticated');

ALTER TABLE knowledge_chunk ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage knowledge chunks"
    ON knowledge_chunk FOR ALL
    USING (auth.role() = 'authenticated');

-- Skills: acesso autenticado
ALTER TABLE skill_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read skills"
    ON skill_definition FOR SELECT
    USING (auth.role() = 'authenticated');

ALTER TABLE client_skill ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage client skills"
    ON client_skill FOR ALL
    USING (auth.role() = 'authenticated');

-- Insights: acesso autenticado
ALTER TABLE client_insight ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read insights"
    ON client_insight FOR SELECT
    USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: auto-update updated_at no client
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_updated_at
    BEFORE UPDATE ON client
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- FUNCTION: compute_client_insights
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION compute_client_insights(p_client_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO client_insight (
        client_id, generation_type,
        total_generations, total_approved, total_rejected, total_edited,
        approval_rate, avg_approved_length, avg_rejected_length, computed_at
    )
    SELECT
        client_id,
        generation_type,
        COUNT(*),
        COUNT(*) FILTER (WHERE feedback_status = 'approved'),
        COUNT(*) FILTER (WHERE feedback_status = 'rejected'),
        COUNT(*) FILTER (WHERE feedback_status = 'edited'),
        ROUND(
            COUNT(*) FILTER (WHERE feedback_status IN ('approved', 'edited'))::numeric
            / NULLIF(COUNT(*) FILTER (WHERE feedback_status != 'pending'), 0),
            3
        ),
        AVG(LENGTH(generated_text)) FILTER (WHERE feedback_status = 'approved'),
        AVG(LENGTH(generated_text)) FILTER (WHERE feedback_status = 'rejected'),
        now()
    FROM generation
    WHERE client_id = p_client_id
      AND feedback_status != 'pending'
    GROUP BY client_id, generation_type
    ON CONFLICT (client_id, generation_type)
    DO UPDATE SET
        total_generations   = EXCLUDED.total_generations,
        total_approved      = EXCLUDED.total_approved,
        total_rejected      = EXCLUDED.total_rejected,
        total_edited        = EXCLUDED.total_edited,
        approval_rate       = EXCLUDED.approval_rate,
        avg_approved_length = EXCLUDED.avg_approved_length,
        avg_rejected_length = EXCLUDED.avg_rejected_length,
        computed_at         = EXCLUDED.computed_at;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- SEED: Prompts globais default (migrados do prompts.json atual)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO prompt_template (client_id, prompt_type, content, version, is_active)
VALUES
    (NULL, 'descricao', E'Você é um redator profissional especializado em e-commerce e SEO para marketplaces, com foco em conversão e ranqueamento.\n\nSua tarefa é reescrever e otimizar a descrição do produto com base nos dados fornecidos, seguindo rigorosamente as diretrizes abaixo.\n\nREGRAS OBRIGATÓRIAS\n\nCorrigir erros ortográficos e gramaticais.\nTornar o texto mais claro, objetivo e persuasivo.\nMelhorar o SEO utilizando apenas palavras presentes nos dados fornecidos.\nManter exatamente o significado e a proposta original do produto.\nNão inventar informações: proibido adicionar especificações técnicas, benefícios, materiais, medidas, compatibilidades ou funcionalidades não informadas.\nNão incluir garantias, promessas comerciais, prazos, políticas ou informações legais não fornecidas.\nTexto final com no máximo 2000 caracteres (incluindo espaços).\n\nOTIMIZAÇÃO PARA CONVERSÃO\n\nIniciar com um parágrafo introdutório direto e comercial, destacando o principal benefício percebido.\nPriorizar clareza e leitura rápida (escaneável).\nEvitar blocos longos de texto.\nUtilizar linguagem simples, objetiva e orientada à decisão de compra.\nEvitar repetições e termos genéricos.\n\nREGRAS DE SEO\n\nInserir naturalmente as principais palavras-chave presentes no título e descrição original.\nNão repetir excessivamente palavras-chave (evitar keyword stuffing).\nPriorizar termos mais relevantes no início do texto.\nNão utilizar sinônimos que não estejam nos dados fornecidos.\n\nFORMATAÇÃO OBRIGATÓRIA\n\nUtilizar apenas HTML simples com as seguintes tags:\n\n<p> para parágrafos\n<ul> e <li> para listas\n\nEstrutura obrigatória:\n\nUm parágrafo introdutório\nUma lista com características técnicas ou funcionais\n\nRESTRIÇÕES\n\nNão usar <h1>, <h2> ou qualquer outro tipo de título.\nNão usar emojis.\nNão usar links.\nNão usar tabelas.\nNão usar imagens.\nNão usar caracteres especiais desnecessários.\nNão inserir as palavras: multicolorido ou multicolorida.\n\nDADOS DISPONÍVEIS (UTILIZAR APENAS ESTES)\n\nTítulo do produto:\n{{title}}\n\nDescrição original:\n{{description}}\n\nPROTOCOLO DE RESPOSTA\n\nRetornar apenas a descrição final.\nSomente HTML válido utilizando <p>, <ul> e <li>.\nNão incluir comentários, explicações ou qualquer texto fora do HTML.', 1, true),
    (NULL, 'titulo', E'Você é um especialista sênior em SEO para marketplaces, focado em algoritmos de busca e conversão.\n\nSua missão é criar o título perfeito para um produto, processando os dados fornecidos e aplicando um filtro rigoroso de otimização. Siga estas diretrizes com precisão absoluta, pois esta é uma tarefa de processamento de dados estruturados.\n\nDIRETRIZES DE CONSTRUÇÃO\n\n1. Hierarquia SEO: O título deve seguir obrigatoriamente a estrutura: [Objeto Principal] + [Marca] + [Modelo] + [Atributo Principal].\n2. Limite Crítico de 60 Caracteres: O título final deve ter no máximo 60 caracteres, incluindo espaços. Se exceder, corte os atributos da direita para a esquerda, preservando sempre o Tipo de Produto e a Marca.\n3. Fidelidade aos Dados: Utilize apenas informações contidas nos campos abaixo. É estritamente proibido inventar adjetivos, benefícios, tecnologias ou características não mencionadas.\n4. Limpeza e Padronização: Use apenas letras e números separados por espaços simples. Remova qualquer caractere especial (*, -, /, !, ?, #), símbolos ou emojis.\n\nRESTRIÇÕES NEGATIVAS (O QUE REMOVER)\n\n- Sem Variações: Proibido incluir cor, tamanho, numeração, voltagem, medidas ou gênero (masculino/feminino).\n- Sem Termos Comerciais: Remova palavras como promoção, oferta, grátis, barato, desconto, envio imediato, melhor, original ou equivalentes.\n- Sem Redundância: Elimine redundâncias e palavras desnecessárias que não contribuam para a identificação técnica do produto.\n\nDADOS DISPONÍVEIS\n\nDescrição:\n{{description}}\n\nTítulo original:\n{{title}}\n\nPROTOCOLO DE RESPOSTA\n\n- Retorne exclusivamente o texto do título otimizado.\n- Uma única linha, sem aspas e sem ponto final.\n- Proibido incluir explicações, notas de rodapé ou comentários.\n- Não utilize letras maiúsculas em todas as palavras (apenas a primeira letra de nomes próprios e marcas).', 1, true)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- SEED: Skills pré-definidas
-- ═══════════════════════════════════════════════════════════════
INSERT INTO skill_definition (id, name, description, prompt_injection)
VALUES
    ('seo_marketplace', 'SEO para Marketplace', 'Otimiza posicionamento em buscas de marketplaces',
     E'INSTRUÇÃO ADICIONAL DE SEO:\nPriorize as palavras-chave mais buscadas no início do texto. Use variações naturais dos termos principais. Estruture o conteúdo para escaneabilidade rápida.'),
    ('brand_voice', 'Voz da Marca', 'Mantém consistência no tom e vocabulário da marca',
     E'INSTRUÇÃO ADICIONAL DE VOZ DA MARCA:\nMantenha o tom de comunicação consistente com a identidade da marca. Use o vocabulário e estilo que ressoam com o público-alvo do cliente.'),
    ('avoid_terms', 'Termos Proibidos', 'Lista de palavras que não devem aparecer no texto gerado',
     E'INSTRUÇÃO ADICIONAL - TERMOS PROIBIDOS:\nNão utilize nenhum dos seguintes termos no texto gerado: {{avoid_list}}'),
    ('html_strict', 'HTML Restrito', 'Reforça formatação HTML e valida output',
     E'INSTRUÇÃO ADICIONAL DE FORMATAÇÃO:\nVerifique que o output contém APENAS tags HTML permitidas (<p>, <ul>, <li>). Não utilize <h1>, <h2>, <h3>, <b>, <strong>, <em>, <i>, <br>, <div>, <span> ou qualquer outra tag.'),
    ('char_limit', 'Limite de Caracteres', 'Enforça limites de caracteres customizados',
     E'INSTRUÇÃO ADICIONAL DE LIMITE:\nO texto final deve ter no máximo {{max_chars}} caracteres incluindo espaços. Priorize informações essenciais se precisar reduzir.')
ON CONFLICT DO NOTHING;
