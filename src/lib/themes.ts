// Thèmes : une apparence complète, enregistrée sous un nom.
//
// Pourquoi : l'apparence se règle maintenant sur cinq axes (texte, image de
// fond, traitement du fond, entête, transition). Préparer un culte de Noël,
// puis revenir à l'habituel le dimanche suivant, demandait de tout refaire
// réglage par réglage — et de se souvenir des valeurs.
//
// Un thème est un INSTANTANÉ, pas un lien : l'appliquer recopie les valeurs
// dans la portée en cours. Modifier ensuite la diapo ne touche pas au thème,
// et modifier le thème ne touche pas aux diapos déjà réglées. C'est le
// comportement auquel on s'attend d'un « enregistrer sous ».

export type ThemeValue = {
  textSettings?: any;
  bgImage?: string;
  bgFilters?: any;
  header?: any;
  transition?: any;
};

export type Theme = {
  id: string;
  name: string;
  value: ThemeValue;
};

const KEY = "appThemes";

export function loadThemes(): Theme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveThemes(themes: Theme[]) {
  localStorage.setItem(KEY, JSON.stringify(themes));
}

/**
 * Ce qu'un thème retient.
 *
 * On recopie en profondeur : sans ça, le thème pointerait sur les objets de
 * réglage en cours et « suivrait » les modifications suivantes, au lieu de
 * garder l'état du jour où on l'a enregistré.
 */
export function captureTheme(name: string, context: ThemeValue, idSeed: string): Theme {
  return {
    id: idSeed,
    name: name.trim() || "Sans nom",
    value: JSON.parse(JSON.stringify({
      textSettings: context.textSettings,
      bgImage: context.bgImage,
      bgFilters: context.bgFilters,
      header: context.header,
      transition: context.transition,
    })),
  };
}

/** Résumé lisible d'un thème, pour la liste. */
export function describeTheme(t: Theme): string {
  const parts: string[] = [];
  if (t.value.textSettings?.fontFamily) parts.push(t.value.textSettings.fontFamily);
  if (t.value.textSettings?.fontSize) parts.push(`${t.value.textSettings.fontSize} %`);
  if (t.value.bgImage) {
    const file = String(t.value.bgImage).split(/[/\\]/).pop();
    if (file) parts.push(file.length > 18 ? `${file.slice(0, 17)}…` : file);
  }
  return parts.join(" · ");
}
