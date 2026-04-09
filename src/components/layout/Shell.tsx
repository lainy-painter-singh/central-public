import { ReactNode, useEffect } from 'react'

interface ShellProps {
  children: ReactNode
}

export function Shell({ children }: ShellProps) {
  // Prevent Electron's default behavior of navigating to dropped files.
  // Without this, dropping a file anywhere on the window opens the file
  // instead of letting our React drop handlers process it.
  useEffect(() => {
    const preventNav = (e: DragEvent) => {
      e.preventDefault()
    }
    document.addEventListener('dragover', preventNav)
    document.addEventListener('drop', preventNav)
    return () => {
      document.removeEventListener('dragover', preventNav)
      document.removeEventListener('drop', preventNav)
    }
  }, [])

  return (
    <div className="h-screen bg-surface text-text-primary overflow-hidden">
      {/* Titlebar drag region for macOS */}
      <div className="titlebar-drag h-8 bg-surface flex items-center px-20">
        <span className="text-xs text-text-tertiary font-medium tracking-wide">CENTRAL</span>
      </div>
      <div className="h-[calc(100vh-2rem)]">
        {children}
      </div>
    </div>
  )
}
