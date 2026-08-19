import type { RefObject } from "react";
import {
  Bold, Italic, Heading1, Heading2, List, ListOrdered, Quote, Code2,
  Link2, Image as ImageIcon, Film, Music, Table, Sigma, Minus, Strikethrough,
} from "lucide-react";

/**
 * Barre d'outils Markdown.
 *
 * Le Markdown n'est pas censé être connu de l'opérateur : chaque bouton écrit
 * la syntaxe à sa place, autour du texte sélectionné quand il y en a un, et
 * repositionne le curseur sur la partie à remplacer. Personne n'a besoin de
 * retenir qu'une image s'écrit `![](fichier.png)`.
 */

type Edit = { next: string; from: number; to: number };

/** Entoure la sélection (ou un exemple) : gras, italique, maths… */
function surround(el: HTMLTextAreaElement, before: string, after: string, sample: string): Edit {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const picked = value.slice(s, e) || sample;
  return {
    next: value.slice(0, s) + before + picked + after + value.slice(e),
    from: s + before.length,
    to: s + before.length + picked.length,
  };
}

/** Préfixe chaque ligne touchée : titres, listes, citations. */
function prefixLines(el: HTMLTextAreaElement, prefix: string | ((i: number) => string)): Edit {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const start = value.lastIndexOf("\n", s - 1) + 1;
  const stop = value.indexOf("\n", e);
  const end = stop === -1 ? value.length : stop;
  const block = value.slice(start, end) || "Texte";
  const lines = block.split("\n").map((line, i) => {
    const p = typeof prefix === "string" ? prefix : prefix(i);
    // Un second clic retire le préfixe : le bouton fait donc bascule.
    return line.startsWith(p) ? line.slice(p.length) : p + line;
  });
  const next = value.slice(0, start) + lines.join("\n") + value.slice(end);
  return { next, from: start, to: start + lines.join("\n").length };
}

/** Insère un bloc sur ses propres lignes : séparateur de diapo, tableau… */
function insertBlock(el: HTMLTextAreaElement, block: string): Edit {
  const { selectionStart: s, value } = el;
  const start = value.lastIndexOf("\n", s - 1) + 1;
  const before = start === 0 ? "" : "\n";
  const text = `${before}${block}\n`;
  return {
    next: value.slice(0, start) + text + value.slice(start),
    from: start + text.length,
    to: start + text.length,
  };
}

interface Tool {
  icon: typeof Bold;
  title: string;
  run: (el: HTMLTextAreaElement) => Edit;
  /** Séparateur visuel APRÈS ce bouton. */
  gap?: boolean;
}

const TOOLS: Tool[] = [
  { icon: Bold, title: "Gras (Ctrl+B)", run: (el) => surround(el, "**", "**", "texte en gras") },
  { icon: Italic, title: "Italique (Ctrl+I)", run: (el) => surround(el, "*", "*", "texte en italique") },
  { icon: Strikethrough, title: "Barré", run: (el) => surround(el, "~~", "~~", "texte barré"), gap: true },

  { icon: Heading1, title: "Grand titre", run: (el) => prefixLines(el, "# ") },
  { icon: Heading2, title: "Sous-titre", run: (el) => prefixLines(el, "## ") },
  { icon: Quote, title: "Citation", run: (el) => prefixLines(el, "> "), gap: true },

  { icon: List, title: "Liste à puces", run: (el) => prefixLines(el, "- ") },
  { icon: ListOrdered, title: "Liste numérotée", run: (el) => prefixLines(el, (i) => `${i + 1}. `), gap: true },

  { icon: Link2, title: "Lien", run: (el) => surround(el, "[", "](https://)", "texte du lien") },
  { icon: ImageIcon, title: "Image", run: (el) => surround(el, "![", "](image.jpg)", "description") },
  { icon: Film, title: "Vidéo", run: (el) => surround(el, "![", "](video.mp4)", "vidéo") },
  { icon: Music, title: "Audio", run: (el) => surround(el, "![", "](son.mp3)", "audio"), gap: true },

  { icon: Code2, title: "Code", run: (el) => surround(el, "`", "`", "code") },
  { icon: Sigma, title: "Formule mathématique", run: (el) => surround(el, "$", "$", "E=mc^2") },
  {
    icon: Table,
    title: "Tableau",
    run: (el) => insertBlock(el, "| Colonne 1 | Colonne 2 |\n| --- | --- |\n| Valeur | Valeur |"),
    gap: true,
  },
  { icon: Minus, title: "Nouvelle diapo", run: (el) => insertBlock(el, "\n---\n") },
];

export function MarkdownToolbar({
  textareaRef, onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
}) {
  const apply = (run: Tool["run"]) => {
    const el = textareaRef.current;
    if (!el) return;
    const { next, from, to } = run(el);
    onChange(next);
    // Le textarea est contrôlé : la nouvelle valeur n'est dans le DOM qu'après
    // le rendu de React. On replace donc le curseur au tour suivant, sinon la
    // sélection retomberait à la fin du texte à chaque clic.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(from, to);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[#202225] bg-[#2b2d31] px-3 py-1.5">
      {TOOLS.map(({ icon: Icon, title, run, gap }, i) => (
        <div key={i} className="flex items-center">
          <button
            type="button"
            title={title}
            /* onMouseDown : on garde le focus (et donc la sélection) du textarea. */
            onMouseDown={(e) => { e.preventDefault(); apply(run); }}
            className="rounded p-1.5 text-gray-400 transition hover:bg-[#5865f2] hover:text-white"
          >
            <Icon size={14} />
          </button>
          {gap && <span className="mx-1 h-4 w-px bg-white/10" />}
        </div>
      ))}
    </div>
  );
}

/** Raccourcis clavier de l'éditeur. Renvoie true si la touche a été traitée. */
export function handleMarkdownShortcut(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange: (value: string) => void
): boolean {
  if (!e.ctrlKey && !e.metaKey) return false;
  const key = e.key.toLowerCase();
  const map: Record<string, Tool["run"]> = {
    b: (el) => surround(el, "**", "**", "texte en gras"),
    i: (el) => surround(el, "*", "*", "texte en italique"),
    k: (el) => surround(el, "[", "](https://)", "texte du lien"),
  };
  const run = map[key];
  if (!run) return false;

  e.preventDefault();
  const el = e.currentTarget;
  const { next, from, to } = run(el);
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(from, to);
  });
  return true;
}
