import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import AppShell from '../ios/AppShell';
import { Button } from '../ios';
import './printer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// The résumé PDF. Swap this file (public/resume.pdf) for the real résumé later;
// no code change needed.
const PDF_URL = '/resume.pdf';

type Status = 'loading' | 'ready' | 'error';

export default function Printer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [printing, setPrinting] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        const doc = await pdfjsLib.getDocument(PDF_URL).promise;
        const page = await doc.getPage(1);
        if (cancelled) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssWidth = 380;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (cssWidth / baseViewport.width) * dpr;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        setStatus('ready');
        // Kick off the print animation once the page has actually rendered.
        requestAnimationFrame(() => setPrinting(true));
      } catch (e) {
        if (!cancelled) setStatus('error');
        console.error('Failed to render résumé PDF', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const reprint = () => {
    setPrinting(false);
    setReplayKey((k) => k + 1);
    requestAnimationFrame(() => requestAnimationFrame(() => setPrinting(true)));
  };

  return (
    <AppShell
      title="Printer"
      glyph="🖨️"
      maxWidth={720}
      right={
        <a className="ios-btn ios-btn-ghost printer-open" href={PDF_URL} target="_blank" rel="noopener noreferrer">
          Open PDF
        </a>
      }
    >
      <div className="printer-stage">
        <div className={`printer-scene ${printing ? 'is-printing' : ''}`}>
          <div key={replayKey} className="paper" aria-label="Résumé document">
            <canvas ref={canvasRef} className="paper-canvas" />
            {status === 'loading' && <div className="paper-placeholder">Warming up…</div>}
            {status === 'error' && (
              <div className="paper-placeholder">Couldn’t load the PDF.</div>
            )}
          </div>

          {/* Stylised printer body — the page rises out of its slot. */}
          <div className="printer-body" aria-hidden>
            <div className="printer-slot" />
            <div className="printer-tray" />
            <span className="printer-led" />
          </div>
        </div>

        <div className="printer-controls">
          <Button variant="secondary" onClick={reprint} disabled={status !== 'ready'}>
            <span aria-hidden>↻</span> Print again
          </Button>
        </div>
        <p className="printer-caption">
          A placeholder résumé, rendered to a canvas with pdf.js. Replace{' '}
          <code>public/resume.pdf</code> with the real one anytime.
        </p>
      </div>
    </AppShell>
  );
}
