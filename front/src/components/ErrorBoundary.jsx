import { Component } from 'react';

/**
 * Si una vista falla al pintarse, enseña un aviso en su lugar en vez de dejar la página en blanco.
 * Cambiar `resetKey` (p. ej. la ruta) vuelve a intentarlo.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    console.error(error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.full ? 'center' : 'card'} role="alert">
        <div className="empty">
          <p><b>Algo ha fallado al mostrar esta pantalla.</b></p>
          <p>Tus datos están a salvo. Prueba a recargar; si se repite, el detalle del error está en la consola del navegador.</p>
          <p className="boundary-a">
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Reintentar</button>{' '}
            <button type="button" className="btn pri" onClick={() => window.location.reload()}>Recargar</button>
          </p>
        </div>
      </div>
    );
  }
}
