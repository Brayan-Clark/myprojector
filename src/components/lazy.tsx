import { Suspense, lazy, type ComponentProps, type Ref } from "react";
import type { PdfViewerHandle } from "./PdfViewer";

/**
 * Chargement différé des deux composants lourds de l'application.
 *
 * Le poids en cause :
 *   - `PdfViewer` entraîne `pdfjs-dist` ;
 *   - `MarkdownView` entraîne `react-markdown`, `remark-gfm`, `remark-math`,
 *     `rehype-katex` et `katex`.
 *
 * Ensemble, ils représentaient l'essentiel du morceau unique de 1,4 Mo que le
 * WebView devait télécharger, analyser et exécuter AVANT d'afficher quoi que
 * ce soit. Sur la machine de référence (Celeron deux cœurs, disque lent),
 * c'est du temps pendant lequel l'opérateur regarde une fenêtre vide.
 *
 * ⚠ CE N'EST PAS DU CHARGEMENT « À LA DEMANDE », et c'est volontaire.
 *
 * Ces composants servent dans la fenêtre de PROJECTION. Attendre le clic sur
 * « projeter » pour aller chercher le code reviendrait à montrer un écran vide
 * à l'assemblée le temps du téléchargement — on aurait déplacé l'attente
 * exactement là où elle est inacceptable. `preloadHeavyViews()` est donc
 * appelé dès que l'application est au repos, bien avant le culte : le gain
 * porte sur le DÉMARRAGE, pas sur les octets jamais chargés.
 */

const loadMarkdownView = () =>
  import("./MarkdownView").then((m) => ({ default: m.MarkdownView }));
const loadPdfViewer = () =>
  import("./PdfViewer").then((m) => ({ default: m.PdfViewer }));

const MarkdownViewLazy = lazy(loadMarkdownView);
const PdfViewerLazy = lazy(loadPdfViewer);

/**
 * Déclenche les deux chargements sans rien afficher.
 *
 * Idempotent : un `import()` déjà résolu renvoie le même module. On avale les
 * erreurs ici — si le chargement échoue, c'est au rendu que l'utilisateur doit
 * le voir, avec son message, pas dans une promesse ignorée au démarrage.
 */
export function preloadHeavyViews(): void {
  const run = () => {
    loadMarkdownView().catch(() => {});
    loadPdfViewer().catch(() => {});
  };
  // `requestIdleCallback` n'existe pas dans WebKitGTK : on retombe sur un
  // délai, assez long pour laisser passer le premier rendu et le chargement
  // des recueils.
  const idle = (window as any).requestIdleCallback;
  if (typeof idle === "function") idle(run, { timeout: 3000 });
  else window.setTimeout(run, 1500);
}

/**
 * Pendant le chargement, on n'affiche RIEN.
 *
 * Un indicateur serait projeté à l'assemblée. Le cas ne devrait pas se
 * produire (voir le préchargement ci-dessus) ; s'il se produit, un écran
 * inchangé pendant 200 ms est moins visible qu'une roue qui tourne.
 */
const Blank = null;

export function MarkdownView(props: ComponentProps<typeof MarkdownViewLazy>) {
  return (
    <Suspense fallback={Blank}>
      <MarkdownViewLazy {...props} />
    </Suspense>
  );
}

export function PdfViewer(
  props: ComponentProps<typeof PdfViewerLazy> & { ref?: Ref<PdfViewerHandle> }
) {
  return (
    <Suspense fallback={Blank}>
      <PdfViewerLazy {...props} />
    </Suspense>
  );
}

export type { PdfViewerHandle };
