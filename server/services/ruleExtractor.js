import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * Analisa um arquivo Markdown (.md) usando a API da OpenAI e extrai regras estruturadas
 * para a coleção `knowledge_rules` do cliente.
 *
 * @param {string} markdownContent - Conteúdo completo do arquivo .md
 * @param {string} filename - Nome do arquivo para auditoria
 * @returns {Promise<{ summary: string, documentPurposes: string[], rules: Array<object> }>}
 */
export async function extractRulesFromMarkdown(markdownContent, filename = '') {
  if (!markdownContent || typeof markdownContent !== 'string') {
    return { summary: '', documentPurposes: [], rules: [] }
  }

  const systemPrompt = `Você é um analisador sênior de documentos de regras e diretrizes corporativas de e-commerce.
Sua função é ler um documento Markdown de um cliente e extrair TODAS as regras operacionais, textos institucionais/fixos, proibições e instruções de formatação de forma estruturada.

REGRAS DE EXTRAÇÃO:
1. "fixed_text" (Texto Fixo): Textos que o documento manda incluir exatamente/literalmente (ex: bloco institucional, avisos fixos). A forma de aplicação DEVE ser "prepend_exactly" ou "append_exactly". O 'content' DEVE conter o texto exato HTML/Markdown a ser inserido.
2. "prohibition" (Proibição): Termos, palavras ou práticas proibidas (ex: palavras superlativas, nomes de concorrentes).
3. "mandatory_instruction" (Instrução Obrigatória): Regras operacionais semânticas que o LLM deve obedecer ao redigir.
4. "category_template" (Template por Categoria): Estruturas fixas de seções para categorias específicas (ex: TV, Caixa de Som).
5. "formatting" (Formatação): Regras de HTML, limite de caracteres, caixa de texto.

RESPOSTA OBRIGATÓRIA EM JSON ESTRETO:
Retorne APENAS um objeto JSON válido com a seguinte estrutura:
{
  "summary": "Resumo executivo do documento",
  "documentPurposes": ["diretrizes_descricao", "regras_titulo", "bloco_institucional"],
  "rules": [
    {
      "name": "Nome curto identificador da regra",
      "description": "Explicação detalhada do que a regra exige ou proíbe",
      "sourceQuote": "Trecho/citação exata do documento .md que fundamenta esta regra",
      "type": "fixed_text" | "mandatory_instruction" | "prohibition" | "formatting" | "category_template" | "conditional_rule" | "style_reference" | "example",
      "scopes": ["descricao"] | ["titulo"] | ["ambos"],
      "priority": "critical" | "high" | "normal" | "reference",
      "application": "prepend_exactly" | "append_exactly" | "prompt" | "validate_only",
      "content": "Texto literal a ser inserido (para fixed_text) ou instrução clara (para prompt/prohibition)",
      "confidence": 0.95
    }
  ]
}`

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Documento: ${filename}\n\nConteúdo:\n${markdownContent}` },
      ],
    })

    const rawJson = response.choices[0]?.message?.content
    if (!rawJson) throw new Error('Resposta vazia da OpenAI ao extrair regras.')

    const parsed = JSON.parse(rawJson)

    return {
      summary: parsed.summary || 'Documento analisado com sucesso.',
      documentPurposes: Array.isArray(parsed.documentPurposes) ? parsed.documentPurposes : [],
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    }
  } catch (err) {
    console.error('[RuleExtractor] Erro ao extrair regras do Markdown:', err)
    throw err
  }
}
