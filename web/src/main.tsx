import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('No #root element to mount into.');

// The theme choice is applied before first paint by the inline script in
// index.html; this only keeps the attribute in step if it was never set.
if (!document.documentElement.dataset.theme) {
  const stored = localStorage.getItem('amberola-theme');
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
