/// <reference types="vite/client" />

import type { TialynnApi } from '../shared/api'

declare global {
  interface Window {
    api: TialynnApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}
