import { useState, useCallback, useRef } from 'react'
import { getAPI } from '../../lib/ipc'

interface FileDropZoneProps {
  onFileDrop: (filePath: string) => Promise<void>
}

export function FileDropZone({ onFileDrop }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setIsDragOver(true)
    setDropError(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounter.current = 0
    setDropError(null)

    const files = e.dataTransfer.files
    if (files.length === 0) {
      setDropError('No files detected in drop')
      return
    }

    setProcessing(true)
    let successCount = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // In Electron 20+ with contextIsolation, file.path is empty.
      // Use webUtils.getPathForFile() exposed through the preload bridge.
      const filePath = getAPI().utils.getFilePathFromDrop(file)
      if (filePath) {
        try {
          await onFileDrop(filePath)
          successCount++
        } catch (err: any) {
          console.error('File drop error:', err)
          setDropError(`Error reading ${file.name}: ${err.message}`)
        }
      } else {
        console.warn('Dropped file missing .path property:', file.name)
        setDropError(`Cannot read "${file.name}" — file path not available`)
      }
    }

    setProcessing(false)
  }, [onFileDrop])

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-default ${
        isDragOver
          ? 'border-accent bg-accent/5'
          : 'border-border-subtle hover:border-text-tertiary'
      }`}
    >
      {processing ? (
        <p className="text-xs text-text-tertiary">Reading files...</p>
      ) : (
        <>
          <p className="text-xs text-text-tertiary">
            {isDragOver ? 'Drop files here' : 'Drag & drop PDFs, Excel, or text files'}
          </p>
          <p className="text-[10px] text-text-tertiary mt-1 opacity-60">
            PDF, XLSX, CSV, TXT, MD
          </p>
        </>
      )}
      {dropError && (
        <p className="text-[10px] text-red-400 mt-1.5">{dropError}</p>
      )}
    </div>
  )
}
