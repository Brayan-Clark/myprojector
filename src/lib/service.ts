// Le culte comme document.
//
// Ce qui existait : `handleSaveAgenda` écrivait `JSON.stringify(playlist)`, un
// tableau nu. Trois manques, tous rencontrés en usage :
//
//   1. AUCUNE VERSION. Le jour où la forme d'un élément change, les fichiers
//      déjà enregistrés deviennent illisibles sans qu'on puisse même le
//      détecter — on ne sait pas ce qu'on lit.
//   2. AUCUNE MÉTADONNÉE. Un dossier de fichiers `agenda.json`,
//      `agenda(1).json`, `agenda(2).json` ne dit pas lequel est le culte du
//      sabbat prochain.
//   3. AUCUN RETOUR. `catch (e) { console.error(e) }` : un fichier corrompu ne
//      produisait rien à l'écran. L'opérateur cliquait « ouvrir », il ne se
//      passait rien, et aucune console n'était accessible.
//
// Le format ci-dessous ajoute les trois, et sait toujours lire les anciens
// fichiers — c'est la condition pour qu'on puisse le faire évoluer ensuite.

import { newItemId, type PlaylistItem } from "./items";

export const SERVICE_VERSION = 1;

/** Un culte enregistré. */
export interface ServiceDocument {
  /** Marqueur de format. Permet de refuser proprement un fichier étranger. */
  kind: "myprojector.service";
  version: number;
  /** Titre lisible (« Culte du sabbat — 1er novembre »). */
  title: string;
  /** Notes de l'équipe : qui prêche, annonces à ne pas oublier… */
  notes?: string;
  savedAt: string;
  items: PlaylistItem[];
}

/** Ce qu'une lecture peut renvoyer. */
export interface ParseResult {
  document: ServiceDocument;
  /**
   * Format d'origine du fichier lu. `legacy` désigne le tableau nu des
   * versions antérieures — utile à signaler, car l'opérateur a peut-être
   * enregistré avec une version plus ancienne que celle qui relit.
   */
  origin: "current" | "legacy";
  /**
   * Éléments écartés parce qu'inutilisables. On ne refuse PAS tout le fichier
   * pour autant : perdre une diapo est préférable à perdre un culte entier.
   */
  dropped: number;
}

/** Titre par défaut : la date du jour, en clair. */
export function defaultServiceTitle(now = new Date()): string {
  return `Culte du ${now.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })}`;
}

/** Nom de fichier proposé, triable et sans caractère problématique. */
export function defaultServiceFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `culte-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

export function buildService(
  items: PlaylistItem[],
  meta: { title?: string; notes?: string } = {}
): ServiceDocument {
  return {
    kind: "myprojector.service",
    version: SERVICE_VERSION,
    title: meta.title?.trim() || defaultServiceTitle(),
    notes: meta.notes?.trim() || undefined,
    savedAt: new Date().toISOString(),
    items,
  };
}

export function serializeService(document: ServiceDocument): string {
  // Indenté : un opérateur doit pouvoir ouvrir le fichier dans un éditeur de
  // texte et comprendre ce qu'il contient. C'est aussi ce qui permet de le
  // réparer à la main en cas de besoin.
  return JSON.stringify(document, null, 2);
}

/**
 * Garde les éléments réellement projetables.
 *
 * Un élément sans identifiant casse les clés React ; un élément sans `lyrics`
 * donne une diapo vide sans qu'on sache pourquoi. On répare ce qui est
 * réparable (un identifiant manquant est régénéré) et on écarte le reste.
 */
function sanitizeItems(raw: unknown): { items: PlaylistItem[]; dropped: number } {
  if (!Array.isArray(raw)) return { items: [], dropped: 0 };
  const items: PlaylistItem[] = [];
  let dropped = 0;
  const seen = new Set<string>();

  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") { dropped++; continue; }
    const item = candidate as Record<string, unknown>;
    if (typeof item.lyrics !== "string" || typeof item.title !== "string") {
      dropped++;
      continue;
    }
    // Un identifiant absent ou en doublon est réparé plutôt que de coûter
    // l'élément : c'est exactement ce que produisaient les anciens
    // `Date.now()` lors d'un ajout en lot.
    let id = typeof item.id === "string" && item.id ? item.id : newItemId();
    if (seen.has(id)) id = newItemId();
    seen.add(id);
    items.push({ ...(item as any), id } as PlaylistItem);
  }

  return { items, dropped };
}

/**
 * Lit un fichier de culte, quel que soit son âge.
 *
 * Lève une erreur PORTEUSE D'UN MESSAGE quand le fichier n'est pas exploitable :
 * l'appelant doit l'afficher. L'ancien code avalait l'exception, et « rien ne
 * se passe » est le pire retour possible pendant une préparation.
 */
export function parseService(contents: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error("Ce fichier n'est pas un agenda lisible (JSON invalide).");
  }

  // --- Format courant ------------------------------------------------------
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const doc = data as Record<string, unknown>;
    const looksLikeService =
      doc.kind === "myprojector.service" || Array.isArray(doc.items);
    if (!looksLikeService) {
      throw new Error("Ce fichier ne contient pas d'agenda.");
    }
    // Une version PLUS RÉCENTE que la nôtre est refusée explicitement : lire
    // à moitié un format qu'on ne connaît pas ferait perdre des éléments en
    // silence, et l'enregistrement suivant les effacerait pour de bon.
    const version = typeof doc.version === "number" ? doc.version : SERVICE_VERSION;
    if (version > SERVICE_VERSION) {
      throw new Error(
        `Ce culte a été enregistré par une version plus récente de MyProjector `
        + `(format ${version}, cette version lit jusqu'au ${SERVICE_VERSION}). `
        + `Mets l'application à jour pour l'ouvrir.`
      );
    }

    const { items, dropped } = sanitizeItems(doc.items);
    return {
      document: {
        kind: "myprojector.service",
        version: SERVICE_VERSION,
        title: typeof doc.title === "string" && doc.title.trim()
          ? doc.title.trim()
          : defaultServiceTitle(),
        notes: typeof doc.notes === "string" && doc.notes.trim() ? doc.notes.trim() : undefined,
        savedAt: typeof doc.savedAt === "string" ? doc.savedAt : new Date().toISOString(),
        items,
      },
      origin: "current",
      dropped,
    };
  }

  // --- Ancien format : un tableau nu ---------------------------------------
  if (Array.isArray(data)) {
    const { items, dropped } = sanitizeItems(data);
    if (items.length === 0 && dropped === 0) {
      throw new Error("Ce fichier ne contient aucun élément.");
    }
    return {
      document: {
        kind: "myprojector.service",
        version: SERVICE_VERSION,
        title: defaultServiceTitle(),
        savedAt: new Date().toISOString(),
        items,
      },
      origin: "legacy",
      dropped,
    };
  }

  throw new Error("Ce fichier ne contient pas d'agenda.");
}

// Les modèles de déroulé vivent dans `serviceTemplates.ts` : ils sont
// documentés, sourcés et modifiables par l'utilisateur, ce qui n'a rien à
// voir avec la sérialisation d'un culte.
export {
  BUILTIN_TEMPLATES, allTemplates, templateItems, totalMinutes,
  type ServiceTemplate, type TemplateStep,
} from "./serviceTemplates";
