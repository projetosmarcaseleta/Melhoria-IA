/**
 * Divide um array em lotes de tamanho `size`.
 */
export function chunk(arr, size) {
  const result = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/**
 * Aguarda `ms` milissegundos.
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Processa `items` em paralelo com no máximo `concurrency` workers simultâneos.
 *
 * `fn` recebe (item, index) e deve retornar uma Promise.
 * O retorno é um array de resultados na mesma ordem de `items`.
 * Se `fn` lançar, o erro é capturado e a posição fica com `{ __error: err }`.
 * Use `onProgress(doneCount, total)` para acompanhar o progresso.
 */
export async function parallelProcess(items, concurrency, fn, onProgress) {
  const total   = items.length
  const results = new Array(total)
  let   nextIdx = 0
  let   done    = 0

  async function worker() {
    while (true) {
      const i = nextIdx++
      if (i >= total) break
      try {
        results[i] = await fn(items[i], i)
      } catch (err) {
        results[i] = { __error: err }
      }
      done++
      onProgress?.(done, total)
    }
  }

  const numWorkers = Math.min(concurrency, total)
  await Promise.all(Array.from({ length: numWorkers }, worker))
  return results
}
