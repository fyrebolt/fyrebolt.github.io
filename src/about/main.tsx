import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import AboutApp from './AboutApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AboutApp />
  </StrictMode>,
);
