# Journal des modifications

## 0.2.0

### ⚠ À lire avant de mettre à jour

**Le rendu des vidéos n'est plus imposé en logiciel.** Jusqu'ici l'application
forçait `WEBKIT_DISABLE_COMPOSITING_MODE` et `WEBKIT_DISABLE_DMABUF_RENDERER`
sur toutes les machines, pour corriger une fenêtre noire sur certaines d'entre
elles. Le prix n'avait pas été mesuré : chaque image de vidéo était calculée
par le processeur. Sur un petit poste (Celeron deux cœurs), la projection
saccadait et l'audio hachait avec elle, alors que la machine savait décoder en
matériel.

Le mode se choisit désormais dans **Bibliothèque → Diagnostic → Rendu des
vidéos** : `Accélérée` (nouveau défaut), `Compatibilité`, `Logicielle`.

**Si la fenêtre reste noire après la mise à jour, il suffit de relancer
l'application** : elle redescend d'un cran toute seule et affiche pourquoi. Le
réglage reste modifiable à la main, et une variable d'environnement posée dans
un terminal garde la priorité.

### Fluidité audio et vidéo

- Mode de rendu choisissable, décodage matériel VA-API privilégié, et repli
  automatique si un démarrage n'affiche rien.
- Les écoutes en ligne ne téléchargent plus tout le fichier avant le premier
  son : un relais local sert la piste par tranches, avec gestion des en-têtes
  `Range`. Le départ est immédiat au lieu d'attendre 3 à 15 Mo.
- L'optimisation ffmpeg en arrière-plan ne tourne plus sur les machines de
  moins de quatre cœurs : `nice` ne suffisait pas à l'empêcher de voler le
  processeur à la lecture.
- Moins de travail inutile pendant la lecture : la position audio n'est plus
  suivie quand la barre de progression n'est pas affichée.
- Le port du serveur média peut basculer : tous ses ports de repli sont
  désormais autorisés par la CSP. Les médias locaux restaient invisibles quand
  le port 11223 était occupé.

### Transitions

- Le fondu n'est plus un fondu croisé : les deux textes s'affichaient
  simultanément au milieu de la transition, ce qui dédoublait les couplets et
  faisait clignoter le fond. Les phases sont décalées.
- Courbes distinctes à l'entrée et à la sortie, déplacements en `translate3d`
  pour passer par le compositeur, et `prefers-reduced-motion` respecté.
- L'ancien fondu croisé reste disponible comme choix explicite
  (« Fondu croisé »), utile sur une image ou une vidéo.

### École du Sabbat (nouveau)

- Leçons du trimestre dans **95 langues**, lues depuis l'API amont : rien n'est
  codé en dur, ni les langues, ni les classes — elles diffèrent d'une langue à
  l'autre et l'amont en ajoute.
- Trimestres, leçons et jours, avec la semaine en cours mise en avant.
- Chaque jour s'ajoute à l'agenda comme texte projetable, découpé en diapos.
  Un aperçu montre le découpage réel avant le culte.
- Cache local : hors ligne, ce qui a été consulté reste lisible.

### Mofon'aina

- Les champs du livret sont affichés : source de la citation, jour de la
  semaine, plan de lecture biblique (« Diabe »), lecture du livre
  (« Velomin'ny teniny ») et coucher du soleil. Ils sont intermittents, chaque
  ligne est donc conditionnelle.
- Les **abréviations** publiées avec chaque trimestre sont enfin consultables.
- Le manifeste des trimestres est lu : titre réel, vraies dates, nombre de
  méditations et poids.

### Préparation du culte

- **Le culte devient un document** : format versionné avec titre, notes et
  horodatage. Les anciens fichiers (un tableau JSON nu) sont toujours lus et
  convertis. Une version plus récente est refusée explicitement au lieu d'être
  lue à moitié.
- Ouvrir un culte demande confirmation quand l'agenda en cours n'est pas vide,
  et le bouton « vider » aussi — il effaçait tout d'un seul clic.
- Les échecs d'enregistrement et d'ouverture sont **affichés**. Ils
  n'allaient jusqu'ici que dans une console inaccessible : « rien ne se
  passe » était le seul retour.
- **Sept déroulés de culte documentés** : les ordres long et court du Manuel
  d'Église 2022 (repris mot pour mot), École du Sabbat, culte des jeunes,
  réunion de prière, accueil du sabbat, Sainte Cène. Chacun affiche sa source,
  son déroulé minuté, et peut être dupliqué, adapté ou remplacé par le vôtre.
- **« Préparer le sabbat »** réunit en un geste la leçon de la semaine, la
  méditation du jour et le déroulé du culte. Ce qui manque est annoncé plutôt
  que livré en silence.

### Bibliothèque

- Rail regroupé en trois familles au lieu d'une liste de douze entrées,
  en-tête retravaillée, intention de chaque section énoncée.
- Recherche contextuelle (`Ctrl+F`), `Échap` pour fermer.
- Cartes, squelettes de chargement et en-têtes unifiés : trois sections
  redessinaient chacune les leurs.

### Démarrage et fiabilité

- Le JavaScript initial passe de **1 442 Ko à 560 Ko** : pdf.js, KaTeX et la
  bibliothèque sont chargés séparément. Les visionneuses sont préchargées au
  repos, jamais au moment de projeter.
- **Reprise après incident** : la position réellement projetée est conservée et
  proposée au redémarrage. Elle n'est jamais rétablie d'office — cela
  enverrait du contenu à l'écran de la salle sans qu'on l'ait demandé.
- Un agenda illisible dans le stockage local ne bloque plus le démarrage.
- Les identifiants d'éléments ne peuvent plus entrer en collision lors d'un
  ajout en lot.

### Corrections

- La source d'une méditation Mofon'aina partait seule sur une diapo au lieu de
  terminer la précédente.
- La sélection automatique du trimestre de l'École du Sabbat prenait le livre
  compagnon (« Boky Mivelatra ») au lieu de la leçon principale.
- Le résolveur de références bibliques est désormais couvert par des tests, y
  compris les livres dont le nom commence par un chiffre.

### Pour les développeurs

- **255 tests** (`npm test`) sur les modules purs, exécutés en CI avant la
  construction et bloquant la publication.
- Le domaine est typé : `PlaylistItem` en union discriminée, et des prédicats
  qui testent une intention plutôt qu'une liste de chaînes.
- Nouvelle documentation : [docs/CULTE.md](docs/CULTE.md).

---

## 0.1.1

Vidéos des présentations PowerPoint, et une seule instance à la fois.

## 0.1.0

Polices hors ligne, recherche biblique plein texte, écran retour et refonte de
la barre d'outils.
