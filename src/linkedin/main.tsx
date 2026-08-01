import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import LinkedInTracker from './LinkedInTracker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LinkedInTracker />
  </StrictMode>,
);
