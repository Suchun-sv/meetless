// Base styles first, so block stylesheets (imported by the components below) come after them.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { resolveBridge } from './app/bridge';
import { ErrorBoundary } from './app/ErrorBoundary';

// public/boot.js (a classic script that runs first) shows any error raised before this point.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App bridge={resolveBridge()} />
  </ErrorBoundary>,
);
window.__meetlessMounted = true;
