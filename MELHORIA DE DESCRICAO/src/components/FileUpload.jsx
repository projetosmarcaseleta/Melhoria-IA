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
      className={`
        border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400 hover:bg-blue-50'}
        ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}
      `}
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
      <p className="text-sm font-medium text-gray-700">
        Arraste ou clique para selecionar a planilha
      </p>
      <p className="text-xs text-gray-500 mt-1">
        Excel (.xlsx / .xls) ou CSV contendo a coluna <strong>ID</strong>
      </p>
    </div>
  )
}
