import { Component, ReactNode } from 'react'

/** Evita a tela em branco: se algo quebrar ao desenhar a página, mostra o motivo e um botão para recarregar. */
export default class ErroTela extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null }
  static getDerivedStateFromError(erro: Error) { return { erro } }
  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-16 max-w-lg rounded-md border border-red-200 bg-white p-6 text-slate-700 shadow">
        <h1 className="text-lg font-bold text-navy">Não foi possível abrir esta tela</h1>
        <p className="mt-2 text-sm">Tente recarregar. Se continuar, envie esta mensagem ao suporte:</p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{String(this.state.erro.message || this.state.erro)}</pre>
        <button className="mt-4 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => location.reload()}>Recarregar</button>
      </div>
    )
  }
}
