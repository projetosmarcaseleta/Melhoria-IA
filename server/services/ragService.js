import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Divide o texto Markdown em chunks de aproximadamente `maxChunkSize` caracteres,
 * tentando respeitar quebras de parágrafo/seção.
 */
export function chunkMarkdown(text, maxChunkSize = 800, overlap = 100) {
  if (!text || typeof text !== 'string') return []

  // Dividir por parágrafos duplos ou cabeçalhos #
  const paragraphs = text.split(/(?=\n#{1,6} )|\n\n+/)
  const chunks = []
  let currentChunk = ''

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    if (currentChunk.length + trimmed.length + 2 <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed
    } else {
      if (currentChunk) {
        chunks.push(currentChunk)
      }
      // Se um único parágrafo for maior que maxChunkSize, corta em pedaços
      if (trimmed.length > maxChunkSize) {
        let start = 0
        while (start < trimmed.length) {
          const end = start + maxChunkSize
          chunks.push(trimmed.slice(start, end))
          start = end - overlap
        }
        currentChunk = ''
      } else {
        currentChunk = trimmed
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}

/**
 * Gera o vetor de embedding de um texto usando a OpenAI (text-embedding-3-small).
 * Retorna Array<number> de 1536 dimensões.
 */
export async function generateEmbedding(text) {
  if (!text || !text.trim()) {
    throw new Error('Texto para embedding não pode ser vazio.')
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000), // limite seguro de caracteres
  })

  return response.data[0].embedding
}

/**
 * Calcula a similaridade de cosseno entre dois vetores.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Busca os Top-K chunks mais similares no array de chunks carregados do Firestore.
 */
export function findTopKSimilarChunks(queryEmbedding, chunks, topK = 3, minSimilarity = 0.3) {
  if (!Array.isArray(chunks) || chunks.length === 0) return []

  const scored = chunks.map((chunk) => {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding)
    return { ...chunk, similarity }
  })

  return scored
    .filter((item) => item.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}
