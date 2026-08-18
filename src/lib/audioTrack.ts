// Résolution unifiée de l'audio associé à un élément projeté :
//  - un cantique  -> son playback (collection `c_playbacks`, piste = numéro) ;
//  - un chapitre biblique -> l'enregistrement malgache correspondant.
//
// La carte biblique est embarquée dans l'application (elle ne change pas) :
// aucun réseau n'est nécessaire pour connaître l'URL d'un chapitre.

import bibleAudioMap from "../data/bible-audio-map.json";

/** Versions bibliques dont le texte correspond à l'enregistrement (MG 1965). */
const MALAGASY_AUDIO_VERSIONS = /^(mg65|mg1965)\b/i;

export interface TrackRef {
  /** Libellé affiché dans le lecteur. */
  label: string;
  /** Sous-dossier de stockage hors ligne : data/audio/<collection>/ */
  collection: string;
  /** Nom du fichier local. */
  filename: string;
  /** URL distante, ou null si elle doit être cherchée en ligne. */
  directUrl: string | null;
  /** true quand l'URL demande une requête réseau pour être connue. */
  needsLookup: boolean;
  /** Collection de playback du cantique, si c'en est un. */
  playbackCollection?: string;
  /** Numéro du cantique, si c'en est un. */
  hymnNumber?: string;
}

const map = bibleAudioMap as Record<string, string>;

/**
 * Renvoie la piste audio d'un élément, ou null s'il n'en a pas.
 * Ne fait aucun accès réseau.
 */
export function trackForSong(song: any): TrackRef | null {
  if (!song) return null;

  // --- Cantique ------------------------------------------------------------
  if (song.playback && song.number != null) {
    const number = String(song.number).trim();
    if (!number) return null;
    return {
      label: `${song.title} · n°${number}`,
      collection: song.playback,
      filename: `${number}.mp3`,
      directUrl: null,
      needsLookup: true, // l'URL vit dans le manifeste distant du recueil
      playbackCollection: song.playback,
      hymnNumber: number,
    };
  }

  // --- Chapitre biblique ---------------------------------------------------
  const version = String(song.version || "");
  if (song.book_index && song.number != null && MALAGASY_AUDIO_VERSIONS.test(version)) {
    const chapter = String(song.number).trim();
    const key = `${song.book_index * 10}-${chapter}`;
    const url = map[key];
    if (!url) return null;
    return {
      label: `${song.book} ${chapter}`,
      collection: "bible-mg",
      filename: `${song.book_index}-${chapter}.mp3`,
      directUrl: url,
      needsLookup: false,
    };
  }

  return null;
}

/** Nombre de chapitres couverts par la carte audio (diagnostic). */
export const BIBLE_AUDIO_ENTRIES = Object.keys(map).length;
