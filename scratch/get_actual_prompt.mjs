import 'dotenv/config'
import { resolvePrompt } from '../server/services/promptResolver.js'

async function show() {
  const sampleProduct = {
    id: '7132023337',
    title: 'Apple Watch Series 11 GPS Caixa Cinza-espacial de Alumínio 46mm Pulseira Esportiva Preta P/M',
    description: 'O Apple Watch Series 11 traz informações valiosas sobre sua saúde...',
    characteristics: 'Caixa 46mm, Alumínio, GPS, Resistência 50m'
  }

  // Título
  const titleResolved = await resolvePrompt('db1-group', 'titulo', sampleProduct)
  // Descrição
  const descResolved = await resolvePrompt('db1-group', 'descricao', sampleProduct)

  console.log('=== SYSTEM PROMPT DE TÍTULO ===')
  console.log(titleResolved.systemPrompt)
  console.log('\n=== USER MESSAGE DE TÍTULO ===')
  console.log(`Título original: ${sampleProduct.title}\n\nDescrição original: ${sampleProduct.description}\n\nCaracterísticas: ${sampleProduct.characteristics}`)

  console.log('\n======================================================\n')

  console.log('=== SYSTEM PROMPT DE DESCRIÇÃO ===')
  console.log(descResolved.systemPrompt)
  console.log('\n=== USER MESSAGE DE DESCRIÇÃO ===')
  console.log(`Título original: ${sampleProduct.title}\n\nDescrição original: ${sampleProduct.description}\n\nCaracterísticas: ${sampleProduct.characteristics}`)
}

show().catch(console.error)
