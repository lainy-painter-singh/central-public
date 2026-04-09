/// <reference types="vite/client" />

interface Window {
  central: import('./lib/ipc').CentralAPI
}
