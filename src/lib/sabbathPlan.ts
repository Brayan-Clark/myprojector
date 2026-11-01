// Préparation du sabbat en un geste.
//
// Tout ce qu'il faut est déjà dans l'application, mais éparpillé : la leçon de
// l'École du Sabbat vient de l'API amont, la méditation du jour d'un trimestre
// Mofon'aina installé, le déroulé d'un modèle. Les réunir à la main demande
// une dizaine de clics répartis dans trois écrans, chaque semaine, et c'est
// toujours la même dizaine de clics.
//
// ⚠ Ce module ne promet RIEN qu'il ne puisse tenir. Chaque morceau peut
// manquer — pas de réseau, aucun trimestre installé, leçon pas encore
// publiée — et il le DIT au lieu de livrer un culte à trous que l'opérateur
// découvrirait devant l'assemblée. D'où `included` / `missing`, qui sont
// remontés à l'interface.

import { newItemId, type PlaylistItem } from "./items";
import {
  coversToday, dateRange, fetchIndex, fetchLesson, fetchLessons, isoDate,
} from "./sabbathSchool";
import { listInstalled, meditationToLyrics, readInstalledJson, type MofonainaFile } from "./library";
import { BUILTIN_TEMPLATES, templateItems } from "./serviceTemplates";

/** Ce que la génération a réussi à réunir, et ce qui manque. */
export interface SabbathPlan {
  /** Date du sabbat visé, au format `aaaa-mm-jj`. */
  date: string;
  items: PlaylistItem[];
  /** Morceaux effectivement ajoutés, en clair. */
  included: string[];
  /** Morceaux absents, avec la raison. L'interface DOIT les montrer. */
  missing: string[];
}

/**
 * Le prochain sabbat, ou aujourd'hui si on y est déjà.
 *
 * Le samedi, l'opérateur prépare le culte du jour — pas celui de la semaine
 * suivante. Le reste de la semaine, il prépare celui qui vient.
 */
export function nextSabbath(from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // getDay() : 0 = dimanche … 6 = samedi.
  const delta = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/** `aaaa-mm-jj` local — jamais en UTC (voir Mofon'aina). */
export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Les morceaux de contenu trouvés, avant assemblage. */
export interface PlanParts {
  /** Méditation du jour, déjà convertie en diapos. */
  meditation?: { title: string; lyrics: string };
  /** Leçon du sabbat, déjà convertie en Markdown. */
  lesson?: { title: string; markdown: string; subtitle?: string };
}

/**
 * Assemble le culte à partir des morceaux disponibles.
 *
 * Séparé de la récupération réseau pour être vérifiable : c'est ici que se
 * décide l'ORDRE, et l'ordre d'un culte n'est pas un détail.
 *
 * Le contenu réel vient AVANT le déroulé : à l'ouverture de l'agenda,
 * l'opérateur doit voir ce que la génération a trouvé, pas neuf repères vides
 * qu'il faut faire défiler.
 */
export function assembleSabbathPlan(date: string, parts: PlanParts): SabbathPlan {
  const items: PlaylistItem[] = [];
  const included: string[] = [];
  const missing: string[] = [];

  if (parts.lesson) {
    items.push({
      id: newItemId(),
      title: parts.lesson.title,
      number: "📘",
      type: "markdown",
      lyrics: parts.lesson.markdown,
    });
    included.push(`École du Sabbat : ${parts.lesson.subtitle || parts.lesson.title}`);
  } else {
    missing.push("La leçon de l'École du Sabbat n'a pas pu être récupérée.");
  }

  if (parts.meditation) {
    items.push({
      id: newItemId(),
      title: parts.meditation.title,
      number: "📖",
      type: "text",
      lyrics: parts.meditation.lyrics,
    });
    included.push(`Mofon'aina : ${parts.meditation.title}`);
  } else {
    missing.push("Aucune méditation Mofon'aina pour cette date (trimestre non installé ?).");
  }

  // L'ordre LONG : c'est celui que le Manuel d'Église détaille, et une
  // étape en trop se supprime plus vite qu'une étape oubliée ne se
  // retrouve.
  const template = BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-long");
  if (template) {
    items.push(...templateItems(template));
    included.push(`Déroulé du culte : ${template.steps.length} étapes`);
  }

  return { date, items, included, missing };
}

/**
 * Méditation du jour, cherchée dans les trimestres INSTALLÉS.
 *
 * Aucun réseau : si le trimestre est sur le disque, la préparation marche en
 * salle sans connexion. On parcourt tous les trimestres installés plutôt que
 * de deviner lequel couvre la date — le livret ne suit pas le calendrier (le
 * trimestre 4 de 2026 commence le 27 septembre).
 */
async function findMeditation(date: string): Promise<PlanParts["meditation"]> {
  const files = await listInstalled("mofonaina").catch(() => []);
  for (const file of files) {
    try {
      const data = JSON.parse(await readInstalledJson("mofonaina", file.filename)) as MofonainaFile;
      const found = data.meditations?.find((m) => m.date === date);
      if (found) {
        return { title: found.titre_du_jour, lyrics: meditationToLyrics(found) };
      }
    } catch {
      // Un fichier illisible ne doit pas empêcher de regarder les suivants.
    }
  }
  return undefined;
}

/**
 * Choisit le trimestre à prendre.
 *
 * ⚠ Plusieurs trimestres couvrent la même semaine dans la même classe. En
 * malgache, « Lesona Lehibe » publie à la fois la leçon principale et son
 * livre compagnon « Boky Mivelatra ». Prendre simplement le premier de la
 * liste donnait le COMPAGNON — vérifié contre l'API : utile en étude
 * personnelle, mais ce n'est pas la leçon que la classe suit.
 *
 * Le chemin d'API distingue les deux : la leçon principale s'écrit
 * `<langue>/ss/<année>-<trimestre>`, les variantes ajoutent un suffixe
 * (`-cc` pour le compagnon, `-cq` pour les jeunes, `-pb`…). On préfère donc
 * la forme sans suffixe.
 *
 * Choisir la CLASSE reste un parti pris assumé : il n'y a pas de bonne réponse
 * automatique entre « Classe des Adultes » et « InVerse ». La génération sert
 * à gagner du temps, pas à se substituer au jugement de l'opérateur — d'où le
 * trimestre retenu, nommé explicitement dans `included`.
 */
export function pickQuarterly<T extends { index: string; startDate?: string; endDate?: string }>(
  quarterlies: T[],
  lang: string
): T | undefined {
  const current = quarterlies.filter((q) => coversToday(q.startDate, q.endDate));
  const pool = current.length > 0 ? current : quarterlies;
  const mainPath = new RegExp(`^${lang}/ss/\\d{4}-\\d{2}$`);
  return pool.find((q) => mainPath.test(q.index)) ?? pool[0];
}

/** Leçon de la semaine pour une langue donnée. */
async function findLesson(lang: string, date: string): Promise<PlanParts["lesson"]> {
  const { data: index } = await fetchIndex(lang);
  const quarterly = pickQuarterly(index.quarterlies, lang);
  if (!quarterly) return undefined;

  const { data: lessons } = await fetchLessons(quarterly.index);
  const lesson =
    lessons.find((l) => {
      const start = isoDate(l.startDate);
      const end = isoDate(l.endDate);
      return start && end && start <= date && date <= end;
    }) ?? lessons[0];
  if (!lesson) return undefined;

  const { data: content } = await fetchLesson(lesson.index);

  // Le segment du jour visé, sinon la leçon entière : un sabbat dont le
  // segment n'est pas encore publié vaut mieux complet qu'absent.
  const segment = content.segments.find((s) => isoDate(s.date) === date);
  const markdown = segment
    ? segment.markdown
    : content.segments
        .map((s) => (s.title ? `## ${s.title}\n\n${s.markdown}` : s.markdown))
        .join("\n\n---\n\n");

  const label = segment
    ? `${lesson.name} · ${segment.title || content.title}`
    : `${lesson.name} · ${content.title || lesson.title}`;

  return {
    title: label,
    markdown,
    subtitle: `${quarterly.groupTitle} — ${quarterly.title} (${dateRange(lesson.startDate, lesson.endDate)})`,
  };
}

/**
 * Construit le culte du sabbat.
 *
 * Ne lève jamais : chaque morceau est tenté indépendamment, et un échec
 * devient une ligne dans `missing`. Un réseau coupé doit donner un culte
 * partiel accompagné d'une explication, pas une erreur et rien.
 */
export async function buildSabbathPlan(
  options: { lang: string; from?: Date } = { lang: "mg" }
): Promise<SabbathPlan> {
  const target = localIso(nextSabbath(options.from));

  const [meditation, lesson] = await Promise.all([
    findMeditation(target).catch(() => undefined),
    findLesson(options.lang, target).catch(() => undefined),
  ]);

  return assembleSabbathPlan(target, { meditation, lesson });
}

/** Libellé du sabbat visé, pour l'annoncer à l'opérateur. */
export function describeSabbath(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
}
