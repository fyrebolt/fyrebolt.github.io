import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import AppStore from './AppStore';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStore />
  </StrictMode>,
);
