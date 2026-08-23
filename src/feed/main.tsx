import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import FeedApp from './FeedApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedApp />
  </StrictMode>,
);
