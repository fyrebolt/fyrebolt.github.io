import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import Printer from './Printer';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Printer />
  </StrictMode>,
);
