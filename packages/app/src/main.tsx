import { installScannerCapture } from './utils/scanner-capture';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

import { globalErrorLogger } from './utils/logger';

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { globalErrorLogger.log(error); }
  override render() {
    if (this.state.failed) return <main className="p-6" role="alert">
      <h1>VaporFlow could not display this screen</h1>
      <p>Reopen the app and check Sales before retrying a checkout.</p>
      <button className="vf-btn-primary" onClick={() => window.location.reload()}>Reopen app</button>
    </main>;
    return this.props.children;
  }
}

installScannerCapture();
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <AppBoundary><App /></AppBoundary>
  </StrictMode>,
);
