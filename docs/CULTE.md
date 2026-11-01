# Le culte : agenda, document, déroulés

## 1. Un élément d'agenda (`src/lib/items.ts`)

**⚠ Le champ `lyrics` ne contient pas toujours des paroles.**

| Nature | `lyrics` contient |
|---|---|
| `hymnes`, `bible`, `custom`, `text`, `markdown` | du **texte** à projeter |
| `image`, `video`, `audio`, `document` | un **chemin** de fichier |
| `youtube` | un **identifiant** de vidéo |
| `link` | une **URL** |

C'est un héritage : la première version ne projetait que des chants, et le
champ a été réemployé au fil des ajouts. Le renommer casserait tous les agendas
enregistrés. On ne le lit donc plus à la main — `textOf()` et `sourceOf()`
disent lequel des deux sens s'applique, et renvoient `null` dans l'autre cas.

`textOf()` teste l'appartenance aux natures TEXTUELLES, pas la non-appartenance
aux natures média. Une nature ajoutée demain et oubliée dans les deux listes
sera donc traitée comme un média — rien ne s'affiche, on le voit tout de suite
— plutôt que comme du texte, ce qui projetterait un chemin de fichier à
l'assemblée.

**Il y a onze natures, pas quatre.** `hymnes` et `bible` sont posées par le
backend (`song_type`), `custom` par le bouton « Programme libre ». Une
condition écrite sur une liste partielle laisse passer les natures ajoutées
ensuite : c'est arrivé deux fois dans l'historique. D'où les prédicats
`isFromDatabase()`, `isBibleChapter()`, `isPdf()`, qui testent une INTENTION.

⚠ `isBibleChapter()` renvoie un `boolean`, **pas** un prédicat
`item is SongItem` : un cantique et un chapitre sont tous deux des `SongItem`,
et prétendre restreindre le type réduisait
`isFromDatabase(x) && !isBibleChapter(x)` à `never`.

### Identifiants

`newItemId()`, jamais `Date.now()`. Plusieurs éléments créés dans la même
milliseconde — un ajout en lot, la génération d'un culte — recevaient des
identifiants **identiques**, donc des `key` React dupliquées, donc une diapo
qui en remplace une autre à l'écran sans raison visible.

---

## 2. Le culte comme document (`src/lib/service.ts`)

Format versionné, marqué `kind: "myprojector.service"`, avec titre, notes et
horodatage.

Ce qui existait avant : `JSON.stringify(playlist)`, un tableau nu — sans
version (impossible de faire évoluer la forme), sans métadonnée (un dossier de
`agenda.json`, `agenda(1).json`… ne dit pas lequel est le culte prochain), et
sans aucun retour en cas d'échec (`catch { console.error }`, alors qu'aucune
console n'est accessible).

- `parseService()` lit **aussi** le tableau nu des versions antérieures, et le
  signale (`origin: "legacy"`).
- Une version **plus récente** est refusée explicitement : lire à moitié un
  format inconnu ferait perdre des éléments en silence, et l'enregistrement
  suivant les effacerait pour de bon.
- Les éléments inutilisables sont écartés et **comptés** (`dropped`) — perdre
  une diapo vaut mieux que perdre un culte. Un identifiant manquant ou en
  doublon est réparé.
- Les erreurs portent un **message affichable**. L'appelant doit le montrer.

Côté interface : ouvrir un culte demande confirmation quand l'agenda en cours
n'est pas vide, et le bouton « vider » aussi — il effaçait tout d'un clic, à
côté de « enregistrer ».

---

## 3. Déroulés de culte (`src/lib/serviceTemplates.ts`)

**⚠ Ce que dit la source, et qui commande tout le reste :**

> « Les formes du service varient d'un pays à l'autre et d'une culture à
> l'autre. Voici deux formes **suggérées**. »
> — Manuel d'Église (révision 2022), p. 252

Et plus haut : c'est au pasteur, avec l'aide des anciens, qu'il revient
d'établir le programme des services spirituels. **Il n'existe pas d'ordre du
culte obligatoire.** Les modèles sont donc des points de départ, chacun
accompagné de sa source — affichée dans l'interface, pas enfouie dans le code.

| Modèle | Quand | Source |
|---|---|---|
| Culte du sabbat — complet (16 étapes) | Sabbat matin | Manuel d'Église 2022, p. 252, variante longue |
| Culte du sabbat — court (9 étapes) | Sabbat matin | Manuel d'Église 2022, p. 252, variante courte |
| École du Sabbat | Sabbat matin | Sabbath School Handbook (Division nord-américaine) : 25 min de mission, 35 min d'étude |
| Culte des jeunes (JA) | Sabbat après-midi | Pratique des Sociétés de Jeunesse ; créneau usuel 16 h – 17 h 30 |
| Réunion de prière | En semaine, souvent le mercredi | Pratique courante ; le Manuel la mentionne sans en fixer le déroulé |
| Accueil du sabbat | Vendredi, au coucher du soleil | Pratique courante ; aucun canevas officiel |
| Sainte Cène | Une fois par trimestre | Manuel d'Église 2022, p. 253-254 |

Les deux ordres du culte divin sont repris **mot pour mot** : c'est le seul
endroit du projet où l'on ne reformule pas, précisément parce que ce libellé
est celui que les anciens reconnaissent. Un test le verrouille.

**Les durées ne figurent pas dans le Manuel.** Celles affichées sont des
repères usuels, présentés comme tels. Mettre un chiffre officiel là où la
source n'en donne aucun serait lui faire dire ce qu'elle ne dit pas.

### Étapes = repères, jamais des diapos

`templateItems()` produit des éléments `custom` dont `lyrics` est **vide**.
Si les étapes portaient du texte, « Prédication » partirait en plein écran
devant l'assemblée. Les notes de préparation ne sont jamais projetées.

### Modifiables

Un modèle fourni n'est jamais modifié sur place : il est la référence
documentée. « Adapter à mon église » le **duplique**, et c'est la copie qu'on
édite (`localStorage.serviceTemplates`). La source de l'original est alors
requalifiée en « D'après : … » — la garder laisserait croire que le Manuel
d'Église dit ce que l'église locale a décidé.

### Aucune image embarquée, et c'est un choix

Des photographies de culte seraient soit sous licence (un risque juridique
pour une application distribuée aux églises), soit des banques d'images
génériques qui ne ressemblent à aucune assemblée réelle. L'identité visuelle
est donc construite — dégradé, icône, couleur par famille de service : même
promesse visuelle, zéro octet, net sur un vidéoprojecteur. Un fond photo reste
ajoutable par l'opérateur, qui a les images de SON église.

---

## 4. Préparer le sabbat (`src/lib/sabbathPlan.ts`)

Un geste qui réunit la leçon de l'École du Sabbat de la semaine, la méditation
Mofon'aina du jour et le déroulé du culte.

- `nextSabbath()` : le samedi, on prépare le culte **du jour** ; les autres
  jours, celui qui vient.
- `localIso()`, jamais `toISOString()` : à Madagascar (UTC+3) l'UTC désigne
  encore la veille jusqu'à 3 h du matin.
- La méditation est cherchée dans les trimestres **installés** — aucun réseau,
  donc la préparation marche en salle sans connexion. On parcourt tous les
  trimestres plutôt que de deviner lequel couvre la date : le livret ne suit
  pas le calendrier.

⚠ **`pickQuarterly()` préfère la leçon principale aux variantes.** Plusieurs
trimestres couvrent la même semaine dans la même classe : en malgache,
« Lesona Lehibe » publie la leçon principale ET son livre compagnon « Boky
Mivelatra ». Prendre le premier de la liste donnait le **compagnon** (vérifié
contre l'API). Le chemin les distingue : la leçon principale s'écrit
`<langue>/ss/<année>-<trimestre>`, les variantes ajoutent un suffixe (`-cc`,
`-cq`, `-pb`…).

**Rien n'est promis qui ne puisse être tenu.** Chaque morceau peut manquer —
pas de réseau, aucun trimestre installé, leçon non publiée — et
`included` / `missing` le disent, affichés dans l'agenda. Un culte à trous
découvert devant l'assemblée serait pire que pas de génération du tout.

Choisir la CLASSE reste un parti pris : il n'y a pas de bonne réponse
automatique entre « Classe des Adultes » et « InVerse ». Le trimestre retenu
est donc nommé explicitement dans le compte rendu.

---

## 5. Reprise après incident (`src/lib/resume.ts`)

La position réellement **projetée** (élément + diapo + page PDF) est
enregistrée en continu. Au redémarrage, elle est **proposée**, pas appliquée.

⚠ **On ne reprojette jamais tout seul** : rétablir l'affichage enverrait du
contenu sur l'écran de la salle sans que personne ne l'ait demandé — par
exemple au lendemain, pendant une réunion qui n'a rien à voir.

La proposition expire au bout de **12 heures** : assez pour un culte
interrompu et repris le même jour, pas assez pour proposer la semaine suivante
de reprendre un cantique de la précédente. Elle est aussi écartée si l'élément
a disparu de l'agenda, et si l'horodatage est dans le futur (horloge système
changée).

L'écran de base **efface** la position : on ne propose pas de reprendre un
chant qu'on venait justement de finir.

---

## 6. Tests (`npm test`)

Vitest, sur les modules **purs** de `src/lib` uniquement. Pas d'environnement
DOM : les composants de cette application se testeraient mal (il faudrait une
fenêtre de projection, un second écran, une base SQLite), alors que la logique
qui casse pour de vrai est entièrement pure.

Les tests tournent en CI **avant** la construction et bloquent la publication :
une version signée et distribuée aux postes est beaucoup plus coûteuse à
rattraper qu'une construction qui échoue.

Ce qu'ils verrouillent en particulier :

- **`bible-audio-map.json`** — le rang du livre × 10 (pas `book_number`), les
  trois entrées corrigées à la main, et le fait que la bible malgache suit la
  découpe **hébraïque** : Joël a 4 chapitres (pas 3) et Malachie 3 (pas 4). Le
  total retombe sur 1189 dans les deux cas, donc un simple comptage ne révèle
  rien — c'est en comparant livre par livre qu'on le voit. Quiconque régénère
  la carte depuis une source anglaise décalera ces deux livres.
- **`bibleRef.ts`** — les livres numérotés (« 1 Jaona » contient une espace),
  la comparaison nom ↔ abréviation dans les deux sens.
- **`fold.ts`** — jumelle de la fonction Rust du même nom. Si l'une change sans
  l'autre, un mot apparaît dans les résultats sans être surligné.
- **`items.ts`** — chaque nature tombe dans exactement un des deux camps
  texte/source.
- **`slides.ts`**, **`service.ts`**, **`serviceTemplates.ts`**,
  **`sabbathPlan.ts`**, **`sabbathSchool.ts`**, **`resume.ts`**,
  **`transitions.ts`**, **`library.ts`**.
