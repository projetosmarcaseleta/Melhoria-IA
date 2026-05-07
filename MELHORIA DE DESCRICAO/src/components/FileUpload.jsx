import { useRef, useState } from 'react'

export default function FileUpload({ onIdsLoaded, disabled }) {
  const inputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const processFile = async (file) => {
    if (!file) return
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      onIdsLoaded(null, 'Formato inválido. Use arquivos .xlsx, .xls ou .csv')
      return
    }
    onIdsLoaded(file, null)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    processFile(file)
  }

  const onFileChange = (e) => {
    processFile(e.target.files[0])
    e.target.value = ''
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className="rounded-xl p-6 text-center cursor-pointer transition-all"
      style={{
        border: `2px dashed ${isDragging ? 'var(--accent-indigo)' : 'var(--border-default)'}`,
        background: isDragging ? 'var(--accent-indigo-glow)' : 'var(--bg-input)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => { if (!disabled && !isDragging) { e.currentTarget.style.borderColor = 'var(--accent-indigo-light)'; e.currentTarget.style.background = 'rgba(99,102,241,0.05)' } }}
      onMouseLeave={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--bg-input)' } }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={onFileChange}
        disabled={disabled}
      />
      <div className="text-3xl mb-2">📂</div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        Arraste ou clique para selecionar a planilha
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        Excel (.xlsx / .xls) ou CSV contendo a coluna <strong style={{ color: 'var(--text-secondary)' }}>ID</strong>
      </p>
    </div>
  )
}
