import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Versão exibida no menu: no Cloudflare Pages vem do commit publicado (CF_PAGES_COMMIT_SHA); localmente fica "dev".
const versao = (process.env.CF_PAGES_COMMIT_SHA || '').slice(0, 7) || 'dev'
export default defineConfig({ plugins: [react()], define: { __APP_VERSAO__: JSON.stringify(versao) } })
