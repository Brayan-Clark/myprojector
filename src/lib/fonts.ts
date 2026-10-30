// Catalogue des polices proposées par l'application.
//
// Les fichiers .woff2 sont EMBARQUÉS (public/fonts/, déclarés dans
// src/fonts.css par `node scripts/fetch-fonts.mjs`). Cette liste doit donc
// rester alignée sur la constante FAMILIES du script : une entrée en trop ici
// s'afficherait dans le sélecteur et retomberait silencieusement sur une
// police système à la projection.
//
// Les groupes servent à l'affichage du sélecteur. Ils décrivent un USAGE, pas
// une classification typographique : c'est ce qui aide à choisir vite pendant
// un culte.

export type FontGroup =
  | "Sans"
  | "Condensée"
  | "Serif"
  | "Titre"
  | "Manuscrite"
  | "Monospace"
  | "Système";

export type FontEntry = {
  /** Valeur stockée dans les réglages ET passée à `font-family`. */
  name: string;
  group: FontGroup;
  /** Aide au choix, affichée sous le nom dans le sélecteur. */
  hint?: string;
};

export const FONTS: FontEntry[] = [
  // Sans serif — le choix par défaut, lisible de loin
  { name: "Inter", group: "Sans", hint: "Neutre, très lisible" },
  { name: "Montserrat", group: "Sans", hint: "Ronde, moderne" },
  { name: "Poppins", group: "Sans", hint: "Géométrique" },
  { name: "Open Sans", group: "Sans" },
  { name: "Lato", group: "Sans" },
  { name: "Roboto", group: "Sans" },
  { name: "Nunito", group: "Sans", hint: "Douce, arrondie" },
  { name: "Raleway", group: "Sans" },
  { name: "Work Sans", group: "Sans" },
  { name: "Source Sans 3", group: "Sans" },
  { name: "Figtree", group: "Sans" },

  // Condensées — beaucoup de texte sans réduire la taille
  { name: "Roboto Condensed", group: "Condensée", hint: "Gagne de la place" },
  { name: "Barlow Condensed", group: "Condensée" },
  { name: "Fira Sans Condensed", group: "Condensée" },
  { name: "Oswald", group: "Condensée", hint: "Haute et étroite" },

  // Serif — plus solennelles, bien pour un texte biblique
  { name: "Lora", group: "Serif", hint: "Chaleureuse" },
  { name: "Playfair Display", group: "Serif", hint: "Contrastée, élégante" },
  { name: "Merriweather", group: "Serif", hint: "Robuste à l'écran" },
  { name: "EB Garamond", group: "Serif", hint: "Classique, livresque" },
  { name: "Cormorant Garamond", group: "Serif", hint: "Fine — éviter en petit" },
  { name: "Libre Baskerville", group: "Serif" },
  { name: "Crimson Pro", group: "Serif" },
  { name: "Noto Serif", group: "Serif" },

  // Titres — un verset court ou un titre de cantique en grand
  { name: "Bebas Neue", group: "Titre", hint: "Capitales uniquement" },
  { name: "Anton", group: "Titre", hint: "Très grasse" },
  { name: "Archivo Black", group: "Titre" },
  { name: "Cinzel", group: "Titre", hint: "Capitales, gravée" },

  // Manuscrites — citations, cartons de bienvenue
  { name: "Dancing Script", group: "Manuscrite", hint: "Déconseillée pour un long texte" },
  { name: "Great Vibes", group: "Manuscrite", hint: "Très décorative" },
  { name: "Caveat", group: "Manuscrite", hint: "Écriture à la main" },

  // Monospace — horloge, chiffres alignés
  { name: "Roboto Mono", group: "Monospace", hint: "Chiffres de largeur fixe" },
  { name: "JetBrains Mono", group: "Monospace" },

  // Système — toujours disponibles, utiles si un fichier manque
  { name: "Arial", group: "Système" },
  { name: "Times New Roman", group: "Système" },
];

export const FONT_GROUPS: FontGroup[] = [
  "Sans",
  "Condensée",
  "Serif",
  "Titre",
  "Manuscrite",
  "Monospace",
  "Système",
];

/** Vrai si la police fait partie du catalogue (réglage enregistré encore valide). */
export function isKnownFont(name?: string): boolean {
  return !!name && FONTS.some((f) => f.name === name);
}

/**
 * Pile de repli. On nomme explicitement la famille générique : si le fichier
 * .woff2 manque, le navigateur choisit une police de la même allure plutôt
 * qu'une sans-serif par défaut qui casse la mise en page.
 */
export function fontStack(name?: string): string {
  const entry = FONTS.find((f) => f.name === name);
  if (!entry) return `'${name || "Inter"}', 'Inter', sans-serif`;
  const generic =
    entry.group === "Serif"
      ? "serif"
      : entry.group === "Monospace"
        ? "monospace"
        : entry.group === "Manuscrite"
          ? "cursive"
          : "sans-serif";
  return `'${entry.name}', ${generic}`;
}
