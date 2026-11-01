// Déroulés de culte.
//
// ⚠ CE QUE DIT LA SOURCE, ET QUI COMMANDE TOUT LE RESTE :
//
//   « Les formes du service varient d'un pays à l'autre et d'une culture à
//     l'autre. Voici deux formes SUGGÉRÉES » — Manuel d'Église 2022, p. 252.
//
//   Et plus haut : c'est au pasteur, avec l'aide des anciens, qu'il revient
//   d'établir le programme des services spirituels. Il n'existe donc PAS
//   d'ordre du culte obligatoire.
//
// Les modèles ci-dessous sont donc des POINTS DE DÉPART, chacun accompagné de
// sa source, et tous modifiables. L'application ne prescrit pas un culte : elle
// épargne la frappe de quinze lignes qu'on retape chaque semaine, et évite
// l'étape oubliée.
//
// Les deux ordres du culte divin sont repris MOT POUR MOT du Manuel d'Église —
// c'est le seul endroit du projet où l'on ne reformule pas, précisément parce
// que ce libellé est celui que les anciens reconnaissent.

import { newItemId, type PlaylistItem } from "./items";

/** Une étape du déroulé. */
export interface TemplateStep {
  title: string;
  /** Durée indicative, en minutes. Absente quand la source n'en donne pas. */
  minutes?: number;
  /** Ce qu'il y a à préparer ici. Affiché à l'opérateur, pas projeté. */
  note?: string;
}

/**
 * Nature d'un modèle, qui détermine son icône et sa couleur.
 * Volontairement limitée : six familles couvrent la semaine d'une église.
 */
export type TemplateKind =
  | "divine"   // culte divin du sabbat
  | "study"    // École du Sabbat
  | "youth"    // jeunesse
  | "prayer"   // réunion de prière
  | "vespers"  // accueil / clôture du sabbat
  | "communion"; // Sainte Cène

export interface ServiceTemplate {
  id: string;
  label: string;
  /** Quand ce service a lieu, en clair. */
  when: string;
  hint: string;
  kind: TemplateKind;
  /** Référence documentaire, CITÉE dans l'interface. */
  source?: string;
  steps: TemplateStep[];
  /** Fourni par l'application : duplicable, mais pas supprimable. */
  builtin: boolean;
}

/**
 * ORDRE DU CULTE, VARIANTE LONGUE — Manuel d'Église 2022, p. 252.
 *
 * Les durées ne figurent PAS dans le Manuel : celles indiquées ici sont des
 * repères usuels pour un culte d'environ une heure et quart, et l'interface
 * les présente comme tels. Mettre un chiffre officiel là où la source n'en
 * donne aucun serait lui faire dire ce qu'elle ne dit pas.
 */
const SABBATH_LONG: TemplateStep[] = [
  { title: "Prélude musical", minutes: 5, note: "Musique d'entrée, assemblée qui s'installe" },
  { title: "Annonces", minutes: 5, note: "Le Manuel rappelle d'en limiter la durée et d'écarter ce qui ne concerne pas l'Église" },
  { title: "Entrée des participants au service", minutes: 2 },
  { title: "Doxologie", minutes: 3, note: "Cantique de louange à Dieu" },
  { title: "Invocation (prière)", minutes: 2, note: "Brève : adoration et remerciements" },
  { title: "Lecture de la Bible", minutes: 3 },
  { title: "Cantique de louange", minutes: 4 },
  { title: "Prière", minutes: 5, note: "Besoins de l'assemblée et du champ mondial" },
  { title: "Motet ou musique spécialement choisie", minutes: 4 },
  { title: "Offrande", minutes: 5, note: "« Apportez des offrandes, entrez dans les cours de son temple » (Ps 96.8)" },
  { title: "Cantique de consécration", minutes: 4 },
  { title: "Prédication", minutes: 35, note: "« Donner la nourriture spirituelle au troupeau du Seigneur »" },
  { title: "Cantique", minutes: 4 },
  { title: "Bénédiction", minutes: 2 },
  { title: "Prière silencieuse", minutes: 2, note: "Assemblée debout ou assise" },
  { title: "Postlude musical", minutes: 3 },
];

/** ORDRE DU CULTE, VARIANTE COURTE — Manuel d'Église 2022, p. 252. */
const SABBATH_SHORT: TemplateStep[] = [
  { title: "Annonces", minutes: 5 },
  { title: "Cantique", minutes: 4 },
  { title: "Prière", minutes: 3 },
  { title: "Offrande", minutes: 5 },
  { title: "Cantique ou musique spéciale", minutes: 4 },
  { title: "Prédication", minutes: 35 },
  { title: "Cantique", minutes: 4 },
  { title: "Bénédiction", minutes: 2 },
  { title: "Prière silencieuse", minutes: 2, note: "Assemblée debout ou assise" },
];

/**
 * ÉCOLE DU SABBAT.
 *
 * La répartition vient du Sabbath School Handbook de la Division
 * nord-américaine (adapté par la Fédération du Québec) : une heure par classe,
 * dont 25 minutes d'évangélisation et de mission au début, puis 35 minutes de
 * discussion de la leçon ; les segments d'ouverture sont volontairement courts,
 * et le dirigeant prend jusqu'à cinq minutes pour l'accueil.
 *
 * Les quatre missions de l'École du Sabbat — étude de la Parole, communion
 * fraternelle, témoignage, promotion des missions — expliquent cet ordre.
 */
const SABBATH_SCHOOL: TemplateStep[] = [
  { title: "Ouverture — cantique", minutes: 4 },
  { title: "Prière d'ouverture", minutes: 2 },
  { title: "Accueil et bienvenue", minutes: 5, note: "Visiteurs, présences, attention aux membres absents" },
  { title: "Programme du jour", minutes: 10, note: "Chant-thème, témoignages, saynète…" },
  { title: "Rapport missionnaire", minutes: 10, note: "Missions mondiales et projets de la classe" },
  { title: "Offrandes de l'École du Sabbat", minutes: 3 },
  { title: "Étude de la leçon", minutes: 35, note: "Discussion en classes. Le contenu s'ajoute depuis la bibliothèque." },
  { title: "Mise en application et prière", minutes: 5, note: "Trois ou quatre questions d'application pour la semaine" },
  { title: "Cantique final", minutes: 4 },
];

/**
 * CULTE DES JEUNES (JA) — sabbat après-midi.
 *
 * Reconstitué à partir de la pratique documentée des Sociétés de Jeunesse : la
 * congrégation se réunit l'après-midi pour soutenir les jeunes, avec jeux
 * bibliques, saynètes, chants et une courte prédication préparée par eux. Le
 * créneau usuel est 16 h – 17 h 30.
 *
 * Mot d'ordre : « Le message adventiste au monde dans ma génération ».
 */
const YOUTH: TemplateStep[] = [
  { title: "Accueil et chants de louange", minutes: 15 },
  { title: "Prière", minutes: 3 },
  { title: "Promesse et devise JA", minutes: 3, note: "« L'amour du Christ nous presse »" },
  { title: "Jeu biblique ou quiz", minutes: 15, note: "Préparé par les jeunes" },
  { title: "Témoignages", minutes: 10 },
  { title: "Production artistique", minutes: 15, note: "Chant, saynète, poème" },
  { title: "Message", minutes: 20, note: "Courte prédication, portée par un jeune" },
  { title: "Appel et prière de clôture", minutes: 5 },
  { title: "Cantique final", minutes: 4 },
];

/**
 * RÉUNION DE PRIÈRE — en semaine, le mercredi dans beaucoup d'églises.
 *
 * Le Manuel d'Église la mentionne comme réunion hebdomadaire mais n'en donne
 * pas le déroulé. Celui-ci reprend la pratique courante : un temps de
 * méditation, les sujets de prière remontés par l'assemblée, puis la prière.
 */
const PRAYER: TemplateStep[] = [
  { title: "Cantique d'ouverture", minutes: 4 },
  { title: "Prière d'ouverture", minutes: 2 },
  { title: "Méditation de la Parole", minutes: 20, note: "Le Mofon'aina du jour s'ajoute depuis la bibliothèque" },
  { title: "Sujets de prière", minutes: 10, note: "Demandes de l'assemblée, malades, projets" },
  { title: "Temps de prière", minutes: 15, note: "En commun ou en petits groupes" },
  { title: "Témoignages de reconnaissance", minutes: 10 },
  { title: "Cantique final et bénédiction", minutes: 5 },
];

/**
 * ACCUEIL DU SABBAT — vendredi au coucher du soleil.
 *
 * Aucun canevas officiel n'existe pour les vêpres. Celui-ci reprend la
 * pratique la plus répandue, bâtie autour de l'heure du coucher du soleil —
 * que le livret Mofon'aina publie justement le vendredi et le sabbat
 * (champ `coucher_du_soleil`).
 */
const VESPERS: TemplateStep[] = [
  { title: "Cantique d'accueil du sabbat", minutes: 4 },
  { title: "Prière", minutes: 2 },
  { title: "Lecture biblique", minutes: 3 },
  { title: "Méditation", minutes: 15 },
  { title: "Chants et louange", minutes: 15 },
  { title: "Prière en famille", minutes: 10 },
  { title: "Cantique de clôture", minutes: 4 },
];

/**
 * SAINTE CÈNE — Manuel d'Église 2022, p. 253-254.
 *
 * Service distinct : il s'insère dans le culte, après (ou à la place de) la
 * prédication. Les trois temps sont ceux du Manuel — lavement des pieds, puis
 * le pain, puis le vin — avec les lectures qu'il propose.
 */
const COMMUNION: TemplateStep[] = [
  { title: "Cantique d'ouverture", minutes: 4 },
  { title: "Prière", minutes: 2 },
  { title: "Courte méditation", minutes: 15, note: "Le Manuel autorise le sermon ici plutôt qu'au début" },
  { title: "Lavement des pieds", minutes: 20, note: "Espaces séparés pour les hommes et les femmes" },
  { title: "Cantique", minutes: 4, note: "Pendant que l'assemblée se réunit à nouveau" },
  { title: "Lecture — le pain", minutes: 3, note: "1Co 11.23,24 · Mt 26.26 · Mc 14.22 · Lc 22.19" },
  { title: "Bénédiction et distribution du pain", minutes: 8 },
  { title: "Lecture — le vin", minutes: 3 },
  { title: "Bénédiction et distribution du vin", minutes: 8 },
  { title: "Cantique final", minutes: 4 },
  { title: "Offrande pour les pauvres", minutes: 3 },
  { title: "Bénédiction", minutes: 2 },
];

const MANUAL = "Manuel d'Église (révision 2022), p. 252 — « deux formes suggérées »";

/** Les modèles fournis avec l'application. */
export const BUILTIN_TEMPLATES: ServiceTemplate[] = [
  {
    id: "sabbath-long",
    label: "Culte du sabbat — complet",
    when: "Sabbat matin",
    hint: "L'ordre long du Manuel d'Église, seize étapes du prélude au postlude.",
    kind: "divine",
    source: MANUAL,
    steps: SABBATH_LONG,
    builtin: true,
  },
  {
    id: "sabbath-short",
    label: "Culte du sabbat — court",
    when: "Sabbat matin",
    hint: "L'ordre court du Manuel d'Église, neuf étapes.",
    kind: "divine",
    source: MANUAL,
    steps: SABBATH_SHORT,
    builtin: true,
  },
  {
    id: "sabbath-school",
    label: "École du Sabbat",
    when: "Sabbat matin, avant le culte",
    hint: "Ouverture, mission, puis l'étude de la leçon.",
    kind: "study",
    source: "Sabbath School Handbook (Division nord-américaine) — 25 min de mission, 35 min d'étude",
    steps: SABBATH_SCHOOL,
    builtin: true,
  },
  {
    id: "youth",
    label: "Culte des jeunes (JA)",
    when: "Sabbat après-midi",
    hint: "Louange, jeu biblique, production artistique et message porté par les jeunes.",
    kind: "youth",
    source: "Pratique des Sociétés de Jeunesse Adventiste — créneau usuel 16 h – 17 h 30",
    steps: YOUTH,
    builtin: true,
  },
  {
    id: "prayer",
    label: "Réunion de prière",
    when: "En semaine, souvent le mercredi",
    hint: "Méditation, sujets de prière et temps de prière.",
    kind: "prayer",
    source: "Pratique courante — le Manuel d'Église la mentionne sans en fixer le déroulé",
    steps: PRAYER,
    builtin: true,
  },
  {
    id: "vespers",
    label: "Accueil du sabbat",
    when: "Vendredi, au coucher du soleil",
    hint: "Vêpres d'ouverture du sabbat, en famille ou à l'église.",
    kind: "vespers",
    source: "Pratique courante — aucun canevas officiel",
    steps: VESPERS,
    builtin: true,
  },
  {
    id: "communion",
    label: "Sainte Cène",
    when: "Une fois par trimestre",
    hint: "Lavement des pieds, le pain, puis le vin.",
    kind: "communion",
    source: "Manuel d'Église (révision 2022), p. 253-254",
    steps: COMMUNION,
    builtin: true,
  },
];

// ---------------------------------------------------------------------------
// Modèles de l'utilisateur
// ---------------------------------------------------------------------------

const USER_KEY = "serviceTemplates";

/**
 * Modèles créés sur ce poste.
 *
 * ⚠ Jamais d'exception vers l'appelant : ce stockage survit aux mises à jour,
 * son contenu n'est pas digne de confiance, et une liste de modèles illisible
 * ne doit pas empêcher d'ouvrir le sélecteur.
 */
export function readUserTemplates(): ServiceTemplate[] {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUsableTemplate).map((t) => ({ ...t, builtin: false }));
  } catch {
    return [];
  }
}

function isUsableTemplate(value: any): value is ServiceTemplate {
  return (
    value &&
    typeof value.id === "string" && value.id !== "" &&
    typeof value.label === "string" && value.label.trim() !== "" &&
    Array.isArray(value.steps) &&
    value.steps.some((s: any) => s && typeof s.title === "string" && s.title.trim() !== "")
  );
}

export function writeUserTemplates(templates: ServiceTemplate[]): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(templates.map((t) => ({ ...t, builtin: false }))));
  } catch {
    // Quota atteint : l'opérateur garde les modèles fournis.
  }
}

/** Tous les modèles disponibles : ceux de l'utilisateur d'abord. */
export function allTemplates(): ServiceTemplate[] {
  return [...readUserTemplates(), ...BUILTIN_TEMPLATES];
}

export function findTemplate(id: string): ServiceTemplate | undefined {
  return allTemplates().find((t) => t.id === id);
}

/**
 * Copie modifiable d'un modèle.
 *
 * Les modèles fournis ne sont pas modifiés sur place : ils sont la référence
 * documentée, et une église qui adapte son déroulé ne doit pas effacer la
 * source pour les autres. On duplique, et c'est la copie qu'on édite.
 */
export function duplicateTemplate(template: ServiceTemplate, label?: string): ServiceTemplate {
  return {
    ...template,
    id: `user-${newItemId()}`,
    label: label?.trim() || `${template.label} (ma version)`,
    // La source de l'original ne vaut plus pour une version modifiée : la
    // garder laisserait croire que le Manuel d'Église dit ce que l'église
    // locale a décidé.
    source: template.source ? `D'après : ${template.source}` : undefined,
    steps: template.steps.map((s) => ({ ...s })),
    builtin: false,
  };
}

export function saveUserTemplate(template: ServiceTemplate): ServiceTemplate[] {
  const existing = readUserTemplates();
  const index = existing.findIndex((t) => t.id === template.id);
  const next = index === -1
    ? [...existing, { ...template, builtin: false }]
    : existing.map((t) => (t.id === template.id ? { ...template, builtin: false } : t));
  writeUserTemplates(next);
  return next;
}

export function deleteUserTemplate(id: string): ServiceTemplate[] {
  const next = readUserTemplates().filter((t) => t.id !== id);
  writeUserTemplates(next);
  return next;
}

// ---------------------------------------------------------------------------
// Utilisation
// ---------------------------------------------------------------------------

/** Durée totale indiquée, en minutes. `0` si aucune étape n'en porte. */
export function totalMinutes(template: ServiceTemplate): number {
  return template.steps.reduce((sum, s) => sum + (s.minutes || 0), 0);
}

/** « 1 h 25 », ou « 45 min ». Vide si la durée est inconnue. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * Construit les éléments d'agenda d'un modèle.
 *
 * ⚠ Les étapes sont des REPÈRES de déroulé, pas des diapos : `lyrics` reste
 * vide. Si elles portaient du texte, « Prédication » partirait en plein écran
 * devant l'assemblée. La note de préparation va dans le titre — visible dans
 * l'agenda, jamais projetée.
 */
export function templateItems(template: ServiceTemplate): PlaylistItem[] {
  return template.steps.map((step) => ({
    id: newItemId(),
    title: step.title,
    number: "📝",
    type: "custom" as const,
    lyrics: "",
  }));
}
