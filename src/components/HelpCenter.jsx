import { useState } from 'react'
import useStore from '../store/useStore'

export default function HelpCenter() {
  const setTab = useStore((s) => s.setTab)
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [openFaq, setOpenFaq] = useState('err-1') // Primeira aberta por padrão

  const steps = [
    {
      step: '01',
      title: 'Selecione o Cliente',
      desc: 'No topo da página, escolha a empresa/cliente ativa para carregar suas regras e prompts customizados.',
      icon: (
        <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      action: 'Trocar Cliente',
      onClick: () => useStore.getState().setActiveClient(null),
    },
    {
      step: '02',
      title: 'Importe os Produtos',
      desc: 'Na aba "Produtos", consulte seus anúncios via AnyMarket ou carregue sua lista de produtos.',
      icon: (
        <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      action: 'Ir para Produtos',
      onClick: () => setTab('products'),
    },
    {
      step: '03',
      title: 'Gere os Textos com IA',
      desc: 'Selecione os itens e clique em "Processar com IA". A IA criará títulos e descrições focados em SEO.',
      icon: (
        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      step: '04',
      title: 'Revise & Ensine a IA',
      desc: 'Na aba "Revisão", clique em Aprovar (✅) ou Edite (✏️). Cada aprovação ensina o estilo do cliente.',
      icon: (
        <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
      action: 'Ir para Revisão',
      onClick: () => setTab('review'),
    },
    {
      step: '05',
      title: 'Sincronize no Marketplace',
      desc: 'Envie os anúncios aprovados diretamente para atualizar o AnyMarket com 1 clique.',
      icon: (
        <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      ),
    },
  ]

  const faqs = [
    {
      id: 'err-1',
      category: 'erros',
      tag: 'Token & Conexão',
      question: 'Erro: Token AnyMarket inválido ou expirado. O que fazer?',
      answer: 'O token de integração Gumga expira periodicamente por segurança. Para resolver: clique na engrenagem (⚙️) no topo ou na barra amarela de aviso de token, cole a nova chave Gumga fornecida pelo cliente e salve. O sistema atualizará as chamadas imediatamente.',
    },
    {
      id: 'err-2',
      category: 'erros',
      tag: 'Integração',
      question: 'Os produtos não estão carregando do AnyMarket. Como solucionar?',
      answer: 'Confirme se o token do cliente está atualizado e se a API do n8n está respondendo. Você pode verificar detalhes de falhas técnicas na aba "Logs" (📋) no topo da aplicação.',
    },
    {
      id: 'err-3',
      category: 'erros',
      tag: 'Sessão',
      question: 'Erro 401: Não autorizado / Sessão expirada.',
      answer: 'Sua sessão de operador expirou por segurança. Clique no ícone de logout (↪) no canto superior direito e faça login novamente com seu e-mail e senha de operador.',
    },
    {
      id: 'err-4',
      category: 'erros',
      tag: 'Regras de Texto',
      question: 'O título gerado pela IA ultrapassou 60 caracteres.',
      answer: 'Navegue até a aba "Skills" (⚡) e certifique-se de que a habilidade "Filtro de Termos e Tamanho" está ativada. Você também pode ajustar a instrução do prompt em Configurações (⚙️).',
    },
    {
      id: 'err-5',
      category: 'erros',
      tag: 'Categorias',
      question: 'Ao abrir 🗂️ Categoria aparece "árvore de categorias não sincronizada".',
      answer:
        'É esperado no primeiro uso de cada cliente. O CRIA precisa ler a árvore de categorias do AnyMarket uma vez para poder comparar e não criar duplicata. No próprio aviso há o botão "⟳ Sincronizar árvore agora" — leva cerca de um minuto em contas grandes, e o ritmo é lento de propósito para não estourar o limite de requisições da API do AnyMarket. Se a sincronização for interrompida no meio, clicar de novo continua de onde parou. Depois disso, as próximas análises são instantâneas.',
    },
    {
      id: 'err-6',
      category: 'erros',
      tag: 'Permissões',
      question: 'Erro: "Token AnyMarket não gravado no cadastro deste cliente".',
      answer:
        'A sugestão de categorias usa somente o token salvo no cadastro do cliente — nunca o que fica no navegador. Se você digitou o token na barra de aviso e não salvou em Configurações (⚙️) → Token AnyMarket, o envio de título e descrição funciona, mas as categorias não. A gravação no cadastro do cliente exige perfil admin: peça a um administrador para salvar uma vez.',
    },
    {
      id: 'feat-1',
      category: 'funcionalidades',
      tag: 'Aprendizado IA',
      question: 'Como a IA aprende os padrões de escrita de cada cliente?',
      answer: 'Toda vez que você clica em Aprovar (✅) ou edita um texto na aba Revisão, essa versão é salva no Firestore. Nas próximas gerações do mesmo cliente, o sistema consulta os últimos 5 exemplos aprovados e os injeta no System Prompt (aprendizado dinâmico Few-Shot).',
    },
    {
      id: 'feat-2',
      category: 'funcionalidades',
      tag: 'RAG & Arquivos',
      question: 'Para que serve a aba Base RAG (📚)?',
      answer:
        'A aba Base RAG permite subir arquivos Markdown (.md) com manuais, diretrizes da marca ou regras de SEO. Importante: o CRIA injeta o conteúdo INTEIRO do arquivo no prompt de descrição, na ordem original — não recorta "os trechos mais relevantes". Isso é intencional: um manual de marca vale por completo para qualquer produto, e recortar por relevância fazia partes obrigatórias (como o bloco institucional) ficarem de fora. Observação: a Base RAG entra apenas no prompt de DESCRIÇÃO, nunca no de título.',
    },
    {
      id: 'feat-3',
      category: 'funcionalidades',
      tag: 'Workflow',
      question: 'Qual a diferença entre "Aprovar" e "Sincronizar AnyMarket"?',
      answer: '"Aprovar" apenas valida o texto na plataforma e ensina o modelo de IA. "Sincronizar AnyMarket" envia os títulos e descrições aprovados diretamente para atualizar o anúncio real no marketplace via webhook.',
    },
    {
      id: 'feat-4',
      category: 'funcionalidades',
      tag: 'Meta-Prompting',
      question: 'O que faz a função Meta-Prompting na aba Insights (📈)?',
      answer: 'A função Meta-Prompting aciona o modelo GPT-4o para analisar o histórico recente de acertos e rejeições do cliente e reescrever o prompt base automaticamente, aperfeiçoando a redação da IA.',
    },
    {
      id: 'trouble-1',
      category: 'troubleshooting',
      tag: 'Palavras Banidas',
      question: 'A IA está gerando palavras comerciais banidas (ex: "promoção", "grátis").',
      answer: 'Acesse a aba "Skills" (⚡), ative a habilidade "Filtro de Termos Proibidos" e digite a lista de palavras que devem ser estritamente bloqueadas. Salve as alterações para aplicar em todas as novas gerações.',
    },
    {
      id: 'trouble-2',
      category: 'troubleshooting',
      tag: 'Configurações',
      question: 'Como restaurar os prompts originais do sistema?',
      answer:
        'Abra as Configurações (⚙️) → aba Prompts e use o botão "↺ Voltar ao padrão do sistema", dentro de "🕐 Histórico de versões". Ele descarta a personalização do cliente e volta ao núcleo padrão. A versão que estava valendo é arquivada no histórico, então você pode voltar atrás se se arrepender. Atenção: apenas apagar o texto da caixa e salvar NÃO restaura nada — caixa vazia significa "sem personalização" e o sistema simplesmente não grava.',
    },
    {
      id: 'nov-1',
      category: 'novidades',
      tag: 'Categorias',
      question: 'Para que serve o botão 🗂️ Categoria no card do produto?',
      answer:
        'Ele analisa o título e a descrição do produto e sugere a categoria correta dentro da árvore do AnyMarket. Ao clicar, abre um resumo "de → para": a categoria atual do produto, a sugerida nível por nível (✓ verde = já existe, ✦ azul = será criada) e um bloco dizendo exatamente o que acontece se você confirmar. Só depois da sua confirmação o CRIA cria a categoria que falta e move o produto. É opcional e por produto: nada roda em lote automático. Se o botão não aparecer, a habilidade "🗂️ Sugestão de Categorias" está desativada para esse cliente na aba Skills (⚡).',
    },
    {
      id: 'nov-2',
      category: 'novidades',
      tag: 'Categorias',
      question: 'Por que às vezes o CRIA diz que a categoria já existe ou sugere usar outra?',
      answer:
        'Porque ele compara a sugestão com a árvore real do cliente antes de criar qualquer coisa, ignorando diferenças de caixa, acento e plural: "AUTOMOTIVO", "Automotivo" e "automotivos" são a mesma categoria para o CRIA. Três resultados possíveis: (1) o produto já está na categoria certa — aparece um aviso verde e nenhum botão de escrita, porque não há nada a fazer; (2) o caminho existe inteiro — ele só move o produto, sem criar nada; (3) existe algo parecido em outro galho — aparece a lista de "Categorias parecidas que já existem" com um botão "Usar esta" em cada uma, para você reaproveitar em vez de criar duplicata.',
    },
    {
      id: 'nov-3',
      category: 'novidades',
      tag: 'Categorias',
      question: 'Criei a categoria errada. Como desfazer?',
      answer:
        'A troca de categoria do produto é reversível: vá na aba Logs (📋), encontre o registro com a linha CATEGORIA e clique em "↩️ Desfazer". O produto volta para a categoria anterior, que fica gravada no momento da troca. Já a categoria criada na árvore do AnyMarket NÃO é apagada pelo desfazer — ela fica lá, vazia e inofensiva. Se quiser removê-la de fato, isso é feito no painel do AnyMarket.',
    },
    {
      id: 'nov-4',
      category: 'novidades',
      tag: 'Prompts',
      question: 'Agora eu consigo editar o prompt. Preciso reescrever tudo?',
      answer:
        'Não — e não deve. O prompt tem duas partes: o NÚCLEO DO SISTEMA (regras de SEO, fidelidade aos dados e o protocolo de resposta), que vale sempre e é somente leitura; e as INSTRUÇÕES DESTE CLIENTE, que é a caixa que você edita. O que você escreve SOMA ao núcleo e tem prioridade sobre ele. Então bastam duas ou três linhas do que é específico daquele cliente — por exemplo "sempre inclua a voltagem em eletroportáteis" — sem copiar o prompt inteiro. Cliente sem nenhuma personalização funciona normalmente, só com o núcleo.',
    },
    {
      id: 'nov-5',
      category: 'novidades',
      tag: 'Prompts',
      question: 'Editei o prompt e o resultado piorou. Como voltar?',
      answer:
        'Em Configurações (⚙️) → Prompts, abra "🕐 Histórico de versões". Cada alteração salva arquiva a versão anterior com autor, data e prévia do texto, e você restaura com um clique. A restauração também arquiva a versão que está saindo, então nada se perde e você pode ir e voltar quantas vezes quiser. Dica: mude uma coisa por vez e teste em 5 produtos variados — prompt que acerta uma categoria costuma errar outra.',
    },
    {
      id: 'nov-6',
      category: 'novidades',
      tag: 'Prompts',
      question: 'O que NÃO devo mudar no prompt?',
      answer:
        'O texto gerado vai direto para o campo do anúncio, sem ninguém no meio. Por isso o PROTOCOLO DE RESPOSTA ("retorne apenas o texto, sem explicação") é obrigatório e o sistema o reforça automaticamente no fim do prompt — sem ele, a IA responderia "Aqui está o título otimizado: ..." e isso inteiro viraria o título do anúncio. Também não adianta pedir coisas que o sistema faz por código: o título é sempre convertido para Title Case, o limite de caracteres da Skill sempre corta, e blocos institucionais fixos são inseridos automaticamente (repeti-los no prompt gera texto duplicado).',
    },
    {
      id: 'nov-7',
      category: 'novidades',
      tag: 'RAG & Arquivos',
      question: 'Reenviei o mesmo .md e o antigo desapareceu. Isso é normal?',
      answer:
        'Sim, agora é o comportamento correto: subir um arquivo com o MESMO nome substitui a versão anterior, em vez de acumular duas cópias. Antes, o reenvio criava um segundo documento idêntico — e como o CRIA injeta todos os chunks no prompt, as diretrizes da marca entravam duplicadas em toda descrição. Atenção a um efeito colateral: as regras que você havia aprovado daquele documento também são removidas, porque foram extraídas do conteúdo antigo. Depois de reenviar, revise as regras na aba Base RAG.',
    },
    {
      id: 'nov-8',
      category: 'novidades',
      tag: 'RAG & Arquivos',
      question: 'Um documento aparece com "0 chunk(s)" na Base RAG. O que significa?',
      answer:
        'Que o upload não terminou: o registro do arquivo foi criado, mas o conteúdo não foi indexado — então esse documento não influencia nenhuma geração, mesmo aparecendo na lista. Acontecia com arquivos grandes, e já foi corrigido. Se você vê um documento com muitos caracteres e 0 chunks, exclua e reenvie. Documento saudável mostra a contagem de chunks e de regras extraídas.',
    },
  ]

  const filteredFaqs = faqs.filter((item) => {
    const matchesCategory = activeCategory === 'all' || item.category === activeCategory
    const matchesSearch =
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tag.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-16 animate-fadeIn">
      {/* Hero Banner */}
      <div className="relative rounded-2xl p-8 overflow-hidden border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-indigo-950/20 to-slate-900 shadow-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
              <span>❓ Suporte & Documentação</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Central de Ajuda & Guia Rápido
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Consulte como operar a plataforma, solucione dúvidas sobre integrações do AnyMarket e resolva erros comuns em segundos.
            </p>
          </div>

          {/* Search Input */}
          <div className="w-full md:w-80 relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Buscar erro, dúvida ou recurso..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-slate-950/80 border border-slate-700/60 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Fluxo de 5 Passos (Workflow Grid) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <h2 className="text-base font-bold text-white tracking-wide">
              Como Funciona a Plataforma (Fluxo de 5 Passos)
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            Guia Operacional
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
          {steps.map((s, i) => (
            <div
              key={i}
              className="group relative bg-slate-900/90 border border-slate-800 hover:border-indigo-500/40 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5 hover:-translate-y-0.5"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/50 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/30 transition-colors">
                    {s.icon}
                  </div>
                  <span className="text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                    PASSO {s.step}
                  </span>
                </div>
                <h3 className="text-xs font-bold text-slate-100 group-hover:text-indigo-300 transition-colors">
                  {s.title}
                </h3>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {s.desc}
                </p>
              </div>

              {s.action && (
                <button
                  onClick={s.onClick}
                  className="mt-2 w-full py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 hover:border-indigo-500 transition-all flex items-center justify-center gap-1 group/btn"
                >
                  <span>{s.action}</span>
                  <span className="group-hover/btn:translate-x-0.5 transition-transform">→</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* FAQ Section com Filtros */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <h2 className="text-base font-bold text-white tracking-wide">
              Perguntas Frequentes & Solução de Erros (FAQ)
            </h2>
          </div>

          {/* Categories Segmented Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl">
            {[
              { id: 'all', label: 'Todas' },
              { id: 'novidades', label: '🆕 Novidades' },
              { id: 'erros', label: '🔴 Erros' },
              { id: 'funcionalidades', label: '⚡ Recursos' },
              { id: 'troubleshooting', label: '🛠️ Soluções' },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeCategory === cat.id
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Accordion List */}
        {filteredFaqs.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-200">
              Nenhuma dúvida encontrada para "{searchQuery}"
            </p>
            <p className="text-xs text-slate-400">
              Tente buscar por termos como "token", "título", "skills" ou "401".
            </p>
            <button
              onClick={() => { setSearchQuery(''); setActiveCategory('all') }}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white"
            >
              Limpar Filtros
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredFaqs.map((item) => {
              const isOpen = openFaq === item.id

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                    isOpen
                      ? 'bg-slate-900/95 border-indigo-500/50 shadow-lg shadow-indigo-500/5'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : item.id)}
                    className="w-full p-4 text-left flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Selo NOVO destaca o que mudou nesta versão sem obrigar o
                          operador a filtrar por categoria para descobrir. */}
                      {item.category === 'novidades' && (
                        <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                          Novo
                        </span>
                      )}
                      <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 border border-slate-700 text-indigo-300">
                        {item.tag}
                      </span>
                      <h3 className="text-xs md:text-sm font-semibold text-slate-100 group-hover:text-indigo-300 transition-colors truncate">
                        {item.question}
                      </h3>
                    </div>

                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                      isOpen ? 'bg-indigo-600 border-indigo-500 text-white rotate-180' : 'bg-slate-800 border-slate-700 text-slate-400 group-hover:text-white'
                    }`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4.5 pt-1 border-t border-slate-800/60 bg-slate-950/40 animate-fadeIn">
                      <p className="text-xs text-slate-200 leading-relaxed font-normal">
                        {item.answer}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Support Footer Card */}
      <div className="rounded-2xl p-6 bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">
              Precisa de ajuda com configurações avançadas?
            </h4>
            <p className="text-xs text-slate-300">
              Acesse o painel de configurações para gerenciar tokens Gumga e prompts customizados.
            </p>
          </div>
        </div>

        <button
          onClick={() => setConfigOpen(true)}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all shrink-0"
        >
          ⚙️ Configurações do Cliente
        </button>
      </div>
    </div>
  )
}
