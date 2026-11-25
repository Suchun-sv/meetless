// Base styles first, so block stylesheets (imported by the components below) come after them.
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { resolveBridge } from './app/bridge';

createRoot(document.getElementById('root')!).render(<App bridge={resolveBridge()} />);
