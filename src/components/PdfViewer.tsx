import { useEffect, useRef, useState, useLayoutEffect, forwardRef, useImperativeHandle } from "react";
// Use the *legacy* build: it is transpiled to older syntax and ships the
// polyfills pdf.js needs (e.g. Promise.withResolvers). The modern build can
// crash on older WebKitGTK shipped in the AppImage — which is exactly why the
// PDF looked fine in `tauri dev` but broke after `tauri build`.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// Bundled worker — Vite emits a hashed URL that also works inside the packaged
// app (tauri:// origin), so PDF rendering behaves identically in dev and build.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfViewerProps {
  /** blob: or http URL pointing to the PDF. */
  url?: string;
  /**
   * "single" → one page rendered fit-to-screen (used for projection / mirror).
   * "scroll" → all pages stacked in a vertical scroll view (used for reading).
   */
  mode?: "single" | "scroll";
  /** 1-based page to display in "single" mode. */
  page?: number;
  /** Manual zoom multiplier (1 = fit-to-screen in single, fit-to-width in scroll). */
  zoom?: number;
  /** Called once the document is loaded, with the total page count. */
  onLoaded?: (numPages: number) => void;
  /** "scroll" mode only: fires with the 1-based page currently centred in view. */
  onVisiblePageChange?: (page: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export interface PdfViewerHandle {
  /** Smooth-scroll to a 1-based page (scroll mode). */
  goToPage: (page: number) => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({
  url,
  mode = "single",
  page = 1,
  zoom = 1,
  onLoaded,
  onVisiblePageChange,
  className,
  style,
}: PdfViewerProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const docUrlRef = useRef<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [aspect, setAspect] = useState(0.707); // w/h, refined from page 1
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);

  // Track the container size so we can re-fit on window/panel resize.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // (Re)load the document only when the URL changes.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!url) {
      setDoc(null);
      setNumPages(0);
      docUrlRef.current = null;
      return;
    }
    if (docUrlRef.current === url && doc) return;

    const task = pdfjsLib.getDocument(url);
    task.promise
      .then(async (pdf: any) => {
        if (cancelled) return;
        docUrlRef.current = url;
        setDoc(pdf);
        setNumPages(pdf.numPages);
        onLoaded?.(pdf.numPages);
        try {
          const first = await pdf.getPage(1);
          const vp = first.getViewport({ scale: 1 });
          if (!cancelled) setAspect(vp.width / vp.height);
        } catch {
          /* keep default aspect */
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Impossible d'ouvrir le PDF");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Imperative scroll-to-page, used by the presentation window to jump pages
  // (from keyboard / on-screen buttons / operator commands).
  useImperativeHandle(
    ref,
    () => ({
      goToPage: (n: number) => {
        const el = containerRef.current;
        if (!el || mode !== "scroll") return;
        const total = numPages || 1;
        const clamped = Math.min(Math.max(1, n), total);
        const cssWidth = Math.max(40, (size.width - 24) * zoom);
        const stride = cssWidth / aspect + 12;
        // Instant jump: reliable on WebKitGTK and avoids a scroll animation
        // being shown to the audience during projection.
        el.scrollTop = (clamped - 1) * stride;
      },
    }),
    [mode, numPages, size.width, aspect, zoom]
  );

  const baseStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    background: "#111",
    ...style,
  };

  if (error) {
    return (
      <div ref={containerRef} className={className} style={{ ...baseStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#f87171", fontSize: 12, padding: 16, textAlign: "center" }}>{error}</span>
      </div>
    );
  }

  // ---- SCROLL mode: continuous, lazily-rendered pages (reading) -------------
  if (mode === "scroll") {
    // zoom 1 ⇒ fit page width to the container (minus a little padding).
    const cssWidth = Math.max(40, (size.width - 24) * zoom);
    const pageStride = cssWidth / aspect + 12; // page height + bottom margin
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      if (!onVisiblePageChange || numPages === 0) return;
      const el = e.currentTarget;
      const center = el.scrollTop + el.clientHeight / 2 - 12; // minus top padding
      const p = Math.min(numPages, Math.max(1, Math.floor(center / pageStride) + 1));
      onVisiblePageChange(p);
    };
    return (
      <div
        ref={containerRef}
        className={className}
        onScroll={handleScroll}
        style={{ ...baseStyle, overflowY: "auto", overflowX: "auto", padding: "12px 0" }}
      >
        {doc &&
          size.width > 0 &&
          Array.from({ length: numPages }).map((_, i) => (
            <PdfPage key={i} pdf={doc} pageNumber={i + 1} cssWidth={cssWidth} aspect={aspect} />
          ))}
      </div>
    );
  }

  // ---- SINGLE mode: one page fit-to-screen (projection / mirror) ------------
  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...baseStyle, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
    >
      {doc && size.width > 0 && (
        <SinglePage pdf={doc} pageNumber={Math.min(Math.max(1, page), numPages || 1)} container={size} zoom={zoom} />
      )}
    </div>
  );
});

// One page scaled to fully fit the container ("contain") times zoom.
function SinglePage({ pdf, pageNumber, container, zoom }: { pdf: any; pageNumber: number; container: { width: number; height: number }; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let pageObj: any;
      try {
        pageObj = await pdf.getPage(pageNumber);
      } catch {
        return;
      }
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const base = pageObj.getViewport({ scale: 1 });
      const fit = Math.min(container.width / base.width, container.height / base.height);
      const viewport = pageObj.getViewport({ scale: Math.max(0.05, fit * zoom) * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
      const t = pageObj.render({ canvasContext: ctx, viewport });
      taskRef.current = t;
      try { await t.promise; } catch { /* cancelled */ }
    })();
    return () => {
      cancelled = true;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
    };
  }, [pdf, pageNumber, container.width, container.height, zoom]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

// A page in the scroll view: keeps a fixed-aspect placeholder and only renders
// to canvas while near the viewport (lazy), to keep memory bounded on big PDFs.
function PdfPage({ pdf, pageNumber, cssWidth, aspect }: { pdf: any; pageNumber: number; cssWidth: number; aspect: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setVisible(e.isIntersecting)),
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!visible) {
      // Free GPU/CPU memory for pages scrolled far away.
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    (async () => {
      let pageObj: any;
      try {
        pageObj = await pdf.getPage(pageNumber);
      } catch {
        return;
      }
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const base = pageObj.getViewport({ scale: 1 });
      const viewport = pageObj.getViewport({ scale: (cssWidth / base.width) * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssWidth / aspect}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
      const t = pageObj.render({ canvasContext: ctx, viewport });
      taskRef.current = t;
      try { await t.promise; } catch { /* cancelled */ }
    })();
    return () => {
      cancelled = true;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
    };
  }, [visible, cssWidth, aspect, pageNumber, pdf]);

  return (
    <div
      ref={wrapRef}
      style={{ width: cssWidth, height: cssWidth / aspect, margin: "0 auto 12px", background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.35)" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
