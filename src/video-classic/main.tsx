import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './video.css';
import VideoEditor from './VideoEditor';

createRoot(document.getElementById('video-root')!).render(
  <StrictMode>
    <VideoEditor />
  </StrictMode>,
);
