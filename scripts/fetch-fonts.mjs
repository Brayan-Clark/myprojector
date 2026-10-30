// Télécharge les polices de projection pour les EMBARQUER dans l'application.
//
// Pourquoi : les polices venaient de fonts.googleapis.com. Le jour d'un culte
// sans Internet, la projection retombait sur une police système — la mise en
// page choisie la veille n'était plus la même. Tout est donc maintenant servi
// depuis le binaire.
//
//   node scripts/fetch-fonts.mjs
//
// Écrit public/fonts/*.woff2 et régénère src/fonts.css. À relancer seulement
// pour ajouter une famille à la liste FAMILIES ci-dessous.

import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "fonts");
const CSS_FILE = path.join(ROOT, "src", "fonts.css");

// On ne garde que ces deux sous-ensembles : `latin` couvre le français,
// `latin-ext` les caractères accentués du malgache et des langues voisines.
// Le cyrillique et le grec tripleraient le poids sans servir.
const KEEP_SUBSETS = new Set(["latin", "latin-ext"]);

// Google Fonts ne renvoie du woff2 que si l'agent utilisateur est reconnu
// comme un navigateur récent ; sinon on reçoit du ttf, deux fois plus lourd.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * `styles` : liste de [italique(0|1), graisse].
 * Les familles d'affichage (Anton, Bebas Neue…) n'ont qu'une seule graisse —
 * demander 700 renverrait une erreur de l'API.
 */
const FAMILIES = [
  // ---- Sans serif, lisibles de loin : le corps de texte d'une projection
  { name: "Inter", styles: [[0, 400], [0, 600], [0, 700], [0, 900]], group: "Sans" },
  { name: "Montserrat", styles: [[0, 400], [0, 700], [1, 400], [0, 900]], group: "Sans" },
  { name: "Poppins", styles: [[0, 400], [0, 700], [1, 400]], group: "Sans" },
  { name: "Open Sans", styles: [[0, 400], [0, 700], [1, 400]], group: "Sans" },
  { name: "Lato", styles: [[0, 400], [0, 700], [1, 400]], group: "Sans" },
  { name: "Roboto", styles: [[0, 400], [0, 700], [1, 400]], group: "Sans" },
  { name: "Nunito", styles: [[0, 400], [0, 700], [1, 400]], group: "Sans" },
  { name: "Raleway", styles: [[0, 400], [0, 700], [1, 400]], group: "Sans" },
  { name: "Work Sans", styles: [[0, 400], [0, 700]], group: "Sans" },
  { name: "Source Sans 3", styles: [[0, 400], [0, 700]], group: "Sans" },
  { name: "Figtree", styles: [[0, 400], [0, 700]], group: "Sans" },

  // ---- Condensées : beaucoup de texte sur une diapo sans réduire la taille
  { name: "Roboto Condensed", styles: [[0, 400], [0, 700]], group: "Condensée" },
  { name: "Barlow Condensed", styles: [[0, 400], [0, 700]], group: "Condensée" },
  { name: "Fira Sans Condensed", styles: [[0, 400], [0, 700]], group: "Condensée" },
  { name: "Oswald", styles: [[0, 400], [0, 700]], group: "Condensée" },

  // ---- Serif : plus solennelles, bien pour un texte biblique
  { name: "Lora", styles: [[0, 400], [0, 700], [1, 400]], group: "Serif" },
  { name: "Playfair Display", styles: [[0, 400], [0, 700], [0, 900]], group: "Serif" },
  { name: "Merriweather", styles: [[0, 400], [0, 700], [1, 400]], group: "Serif" },
  { name: "EB Garamond", styles: [[0, 400], [0, 700], [1, 400]], group: "Serif" },
  { name: "Cormorant Garamond", styles: [[0, 400], [0, 700]], group: "Serif" },
  { name: "Libre Baskerville", styles: [[0, 400], [0, 700]], group: "Serif" },
  { name: "Crimson Pro", styles: [[0, 400], [0, 700]], group: "Serif" },
  { name: "Noto Serif", styles: [[0, 400], [0, 700]], group: "Serif" },

  // ---- Titres : pour un verset court ou un titre de cantique en grand
  { name: "Bebas Neue", styles: [[0, 400]], group: "Titre" },
  { name: "Anton", styles: [[0, 400]], group: "Titre" },
  { name: "Archivo Black", styles: [[0, 400]], group: "Titre" },
  { name: "Cinzel", styles: [[0, 400], [0, 700]], group: "Titre" },

  // ---- Manuscrites : citations, invitations, cartons de bienvenue
  { name: "Dancing Script", styles: [[0, 400], [0, 700]], group: "Manuscrite" },
  { name: "Great Vibes", styles: [[0, 400]], group: "Manuscrite" },
  { name: "Caveat", styles: [[0, 400], [0, 700]], group: "Manuscrite" },

  // ---- Monospace : horloge, compte à rebours, chiffres alignés
  { name: "Roboto Mono", styles: [[0, 400], [0, 700]], group: "Monospace" },
  { name: "JetBrains Mono", styles: [[0, 400], [0, 700]], group: "Monospace" },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function cssUrl(family) {
  // Les styles doivent être triés (italique puis graisse) : l'API refuse
  // « 0,700;0,400 » avec une 400 Bad Request.
  const styles = [...family.styles].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hasItalic = styles.some(([i]) => i === 1);
  const spec = hasItalic
    ? `ital,wght@${styles.map(([i, w]) => `${i},${w}`).join(";")}`
    : `wght@${styles.map(([, w]) => w).join(";")}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.name).replace(/%20/g, "+")}:${spec}&display=swap`;
}

/** Découpe la feuille de style Google en blocs { subset, family, style, weight, url, range }. */
function parseFaces(css) {
  const faces = [];
  // Chaque @font-face est précédé d'un commentaire nommant le sous-ensemble.
  const re = /\/\*\s*([a-z0-9-\[\]]+)\s*\*\/\s*@font-face\s*{([^}]*)}/gi;
  let m;
  while ((m = re.exec(css))) {
    const [, subset, body] = m;
    const pick = (prop) => (body.match(new RegExp(`${prop}:\\s*([^;]+);`, "i")) || [])[1]?.trim();
    const url = (body.match(/url\(([^)]+)\)/) || [])[1];
    if (!url) continue;
    faces.push({
      subset,
      style: pick("font-style") || "normal",
      weight: pick("font-weight") || "400",
      range: pick("unicode-range"),
      url,
    });
  }
  return faces;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const blocks = [];
  let total = 0;

  for (const family of FAMILIES) {
    const css = await fetchText(cssUrl(family));
    const faces = parseFaces(css).filter((f) => KEEP_SUBSETS.has(f.subset));
    if (faces.length === 0) throw new Error(`Aucun sous-ensemble latin pour ${family.name}`);

    for (const face of faces) {
      const italic = face.style === "italic" ? "-italic" : "";
      const file = `${slug(family.name)}-${face.weight}${italic}-${face.subset}.woff2`;
      const bytes = Buffer.from(
        await (await fetch(face.url, { headers: { "User-Agent": UA } })).arrayBuffer()
      );
      await writeFile(path.join(OUT_DIR, file), bytes);
      total += bytes.length;

      blocks.push(
        [
          "@font-face {",
          `  font-family: '${family.name}';`,
          `  font-style: ${face.style};`,
          `  font-weight: ${face.weight};`,
          "  font-display: swap;",
          `  src: url('/fonts/${file}') format('woff2');`,
          face.range ? `  unicode-range: ${face.range};` : null,
          "}",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
    console.log(`✓ ${family.name} — ${faces.length} fichier(s)`);
  }

  const header = [
    "/* Polices embarquées — NE PAS MODIFIER À LA MAIN.",
    "   Généré par `node scripts/fetch-fonts.mjs`.",
    "   Les fichiers .woff2 vivent dans public/fonts/ et sont servis par",
    "   l'application elle-même : la projection garde ses polices hors ligne. */",
    "",
  ].join("\n");

  await writeFile(CSS_FILE, `${header}${blocks.join("\n\n")}\n`);

  const files = await readdir(OUT_DIR);
  console.log(
    `\n${FAMILIES.length} familles · ${files.length} fichiers · ${(total / 1024 / 1024).toFixed(2)} Mo`
  );
  console.log(`→ ${path.relative(ROOT, CSS_FILE)}`);
}

main().catch((e) => {
  console.error("Échec :", e.message);
  process.exit(1);
});
