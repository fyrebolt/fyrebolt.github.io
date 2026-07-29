import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import AppShell from '../ios/AppShell';
import { Button } from '../ios';
import './printer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_URL = '/resume.pdf';

// The paper never renders wider than --paper-w's ceiling in printer.css; render
// the bitmap for that width at retina density so CSS only ever scales down.
const MAX_PAPER_CSS_WIDTH = 330;

type Status = 'loading' | 'ready' | 'error';

export default function Printer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [ratio, setRatio] = useState<number | null>(null);

  /**
   * Run the "page rises out of the slot" animation from the top.
   *
   * This is a Web Animation rather than a CSS transition because it has to be
   * *replayable*: cancel() + animate() restarts it deterministically, whereas
   * re-triggering a transition depends on a reflow landing between two class
   * writes. `fill: 'both'` leaves the sheet parked at the printed position, so
   * the CSS only has to describe the tucked-away resting state.
   */
  const print = useCallback(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    animRef.current?.cancel();
    animRef.current = paper.animate(
      [
        { transform: 'translate(-50%, 100%)', opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.34 },
        { transform: 'translate(-50%, 0)', opacity: 1, offset: 1 },
      ],
      {
        duration: reduced ? 1 : 1500,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'both',
      },
    );
  }, []);

  useEffect(() => () => animRef.current?.cancel(), []);

  useEffect(() => {
    let cancelled = false;
    let doc: pdfjsLib.PDFDocumentProxy | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        doc = await pdfjsLib.getDocument(PDF_URL).promise;
        const page = await doc.getPage(1);
        // The cleanup may have already fired before `doc` existed to destroy.
        if (cancelled) return void doc.destroy();

        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (MAX_PAPER_CSS_WIDTH / base.width) * dpr });

        // Render into a scratch canvas, not the mounted one: pdf.js refuses to
        // run two renders against a single canvas, and StrictMode (plus HMR)
        // runs this effect twice against the same mounted node. Blitting the
        // finished bitmap also means a cancelled run never leaves a half-drawn
        // page on screen.
        const scratch = document.createElement('canvas');
        scratch.width = Math.floor(viewport.width);
        scratch.height = Math.floor(viewport.height);
        const scratchCtx = scratch.getContext('2d');
        if (!scratchCtx) throw new Error('no 2d context');
        await page.render({ canvasContext: scratchCtx, viewport }).promise;
        if (cancelled) return void doc.destroy();

        canvas.width = scratch.width;
        canvas.height = scratch.height;
        canvas.getContext('2d')?.drawImage(scratch, 0, 0);

        // Let the layout size the sheet from the PDF's own proportions.
        setRatio(base.height / base.width);
        setStatus('ready');
        print();
      } catch (e) {
        if (!cancelled) setStatus('error');
        console.error('Failed to render résumé PDF', e);
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [print]);

  return (
    <AppShell
      title="Printer"
      glyph="🖨️"
      maxWidth={720}
      right={
        <a
          className="ios-btn ios-btn-ghost printer-open"
          href={PDF_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open PDF
        </a>
      }
    >
      <div
        className="printer-stage"
        style={ratio ? ({ '--paper-ratio': ratio } as React.CSSProperties) : undefined}
      >
        <div className="printer-scene">
          {/* Clipped at the slot line so the sheet is genuinely hidden inside
              the printer until it prints. */}
          <div className="printer-paper-clip">
            <div ref={paperRef} className="paper" aria-label="Résumé document">
              <canvas ref={canvasRef} className="paper-canvas" />
            </div>
          </div>

          {/* Stylised printer body — the page rises out of its slot. */}
          <div className="printer-body" aria-hidden>
            <div className="printer-slot" />
            <div className="printer-tray" />
            <span className="printer-led" />
          </div>
        </div>

        <div className="printer-controls">
          <Button variant="secondary" onClick={print} disabled={status !== 'ready'}>
            <span aria-hidden>↻</span> Print again
          </Button>
        </div>

        <p className="printer-caption" role={status === 'error' ? 'alert' : undefined}>
          {status === 'error'
            ? 'Couldn’t load the résumé — open the PDF directly instead.'
            : 'My résumé, printed a page at a time. Grab the full PDF up top.'}
        </p>
      </div>
    </AppShell>
  );
}
