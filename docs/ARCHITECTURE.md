# Architecture

Comment l'application est faite, et pourquoi. Les points marqués **⚠** sont des
pièges déjà rencontrés : ils ont l'air d'erreurs mais sont volontaires.

---

## 1. Les deux fenêtres

L'application ouvre jusqu'à **trois fenêtres qui exécutent le même code** :

| Fenêtre | URL | Rôle | Ouverture |
|---|---|---|---|
| Contrôle | `/` | Ce que voit l'opérateur | au démarrage |
| Projection | `/?live=true` | Ce que voit l'assemblée | à la demande |
| Écran retour | `/?stage=true` | Ce que voient les musiciens | à la demande |

**⚠ La troisième fenêtre n'existe jamais par défaut.** Beaucoup d'églises n'ont
pas d'écran de retour ; en ouvrir un sans qu'on l'ait demandé encombrerait le
poste de l'opérateur. Même règle pour les annonces défilantes et le découpage
automatique : ils existent, ils sont éteints.

L'écran retour ne reçoit QUE des évènements (`update_stage`) : ni base de
données, ni média. Une fenêtre de confort ne doit jamais être ce qui ralentit
la projection. Il est volontairement ouvert en fenêtre **normale** : on ne sait
pas sur quel moniteur l'écran de retour est branché, et deviner mal
reviendrait à voler l'écran de projection.

`App.tsx` lit ce paramètre au démarrage (`isLiveMode`) et rend `LiveView` au
lieu de l'interface complète. La fenêtre de projection est créée à la demande
par `handleLiveToggle()`, en plein écran sans décorations, positionnée sur le
dernier moniteur détecté.

Les deux fenêtres communiquent par **événements Tauri** (`emit` / `listen`), pas
par état partagé : ce sont deux contextes JavaScript distincts.

**⚠ L'aperçu n'est pas une capture.** Le petit moniteur du contrôleur refait le
rendu de son côté. Il n'existe aucun moyen économique de miroiter une fenêtre
dans Tauri/WebKitGTK. Conséquence : une vidéo projetée est décodée **deux fois**.
D'où le mode « Aperçu allégé » (bouton en haut à droite du moniteur), actif par
défaut pendant le direct, qui remplace la vidéo de l'aperçu par un cartouche.
La caméra suit la même règle — et n'a pas le choix : sous V4L2, deux webviews ne
peuvent pas ouvrir le même périphérique.

---

## 2. Le serveur média local (port 11223)

Un serveur **warp** démarre avec l'application et sert le dossier de données sur
`http://127.0.0.1:11223/fs/<chemin-relatif>`.

Pourquoi pas le protocole `asset://` de Tauri ? Parce qu'il ne gère pas les
requêtes **Range**, indispensables pour se déplacer dans une vidéo ou un audio.
Le protocole asset est donc explicitement désactivé (`assetProtocol.enable:
false`).

Côté React, `cleanUrl()` (`src/lib/media.ts`) traduit un chemin disque en URL du
serveur. Il reconnaît les dossiers `/backgrounds/`, `/media/` et `/data/`.

Sécurité : le serveur n'accepte que les origines de l'application (pas
d'`allow_any_origin`) et vérifie l'en-tête `Host` contre le détournement DNS.

---

## 3. Où vivent les données

Racine (`get_data_root`) :

| Système | Chemin |
|---|---|
| Linux | `~/.local/share/com.bryan.myprojector/` |
| Windows | `%APPDATA%\com.bryan.myprojector\` |
| macOS | `~/Library/Application Support/com.bryan.myprojector/` |

```
data/hymnes/        recueils .db (SQLite)
data/bible/         bibles .SQLite3 (format MyBible)
data/docs/          documents PDF téléchargés
data/mofonaina/     trimestres de méditations (.json)
data/audio/<recueil>/  playbacks téléchargés, nommés <numéro>.mp3
data/audio/_cache/  écoutes en ligne mises en cache
data/_manifests/    catalogues distants, pour le mode hors ligne
backgrounds/        fonds importés par l'utilisateur
media/              images, vidéos, documents importés dans l'agenda
```

Le bouton **Ouvrir le dossier** de la section Stockage pointe directement là.

---

## 4. Le backend Rust (`src-tauri/src/lib.rs`)

Un seul fichier, ~2 400 lignes, organisé en blocs commentés : optimisation des
médias, bases SQLite, bibliothèque, historique, stockage, diagnostic,
télécommande, réglages WebKit.

**⚠ Les paramètres d'`invoke` sont en camelCase côté JavaScript.** Une commande
Rust `fn f(file_path: String)` s'appelle `invoke('f', { filePath })`. Avec
`file_path`, l'appel échoue silencieusement si l'erreur est avalée par un
`.catch(console.warn)` — c'est exactement comme ça que 137 Mo de médias
supposément supprimés sont restés sur le disque.

### Optimisation automatique des médias

Une vidéo 4K à gros débit fait décrocher le décodeur logiciel de WebKitGTK :
l'interface se fige plusieurs secondes en changeant de diapo. Les médias
importés sont donc re-transcodés par ffmpeg au-delà de certains seuils
(80 Mo, 1920×1080, 10 Mbps), **en place**, pour que les références existantes
restent valides.

Deux précautions : le transcodage tourne avec `nice -n 19`, et il se **met en
pause tant que la fenêtre de projection est ouverte**. Compresser pendant un
culte serait exactement le contraire du but recherché.

ffmpeg est **optionnel** : sans lui, rien n'est compressé, tout fonctionne.

---

## 5. WebKitGTK : la liste des pièges

Ce sont les vraies causes de bugs déjà corrigés. Ne pas « simplifier » ces
endroits sans relire cette section.

**Lecture automatique.** WebKit peut exiger un geste utilisateur avant de lire
une vidéo — le fond reste alors figé avec un gros bouton *play*.
`apply_media_settings()` force `media-playback-requires-user-gesture(false)`, et
est appliqué dans `on_page_load`, donc **pour chaque webview au moment où sa
page charge**. Le réglage réellement retenu par WebKit est relu et remonté dans
le Check système (« Lecture automatique des fonds »).

**⚠ La source d'une vidéo est posée en JavaScript, jamais en attribut JSX.**
Voir `src/lib/autoplay.ts` et `BackgroundVideo.tsx` :

```ts
if (el.getAttribute("src") !== src) { el.setAttribute("src", src); el.load(); }
```

Le nettoyage retire l'attribut `src` pour libérer le pipeline GStreamer. Si
`src` était aussi une prop JSX, React ne le remettrait jamais (sa valeur n'a pas
changé de son point de vue) — et sous `StrictMode`, qui monte les effets deux
fois, la vidéo resterait définitivement vide.

**⚠ `play()` ne répare pas tout — il faut parfois RECHARGER.** Deux pannes
laissent un fond vidéo figé sans que rien ne les signale, et expliquent les
démarrages ratés « de temps en temps » :

- l'élément est en **erreur** (le serveur média n'était pas encore prêt quand la
  fenêtre de projection s'est ouverte) : `play()` sur un élément en erreur ne
  fait rien, il faut relire la source ;
- l'élément se dit **en lecture** mais le pipeline a calé : `paused` vaut
  `false`, donc une surveillance qui teste `el.paused` conclut que tout va bien.

La surveillance de `forceBackgroundPlayback` suit donc la progression réelle de
`currentTime` et recharge, au maximum cinq fois — au-delà, c'est un codec
manquant, et recharger en boucle ne ferait que chauffer le processeur pendant
le culte. Le compteur se remet à zéro dès que la lecture repart.

**⚠ `removeAttribute("src")` doit être suivi de `load()`.** Sinon l'élément
garde la position de lecture précédente : c'est ce qui faisait démarrer Genèse 1
au verset 21.

**⚠ Libérer la vidéo avant le démontage.** Détruire un `<video>` en cours de
lecture démonte le pipeline GStreamer sur la boucle principale et fige
l'interface plusieurs secondes. `releaseVideo()` coupe la source d'abord.

**⚠ `window.prompt()` et `window.confirm()` ne sont pas implémentés.** Ils
renvoient `null` / `false` sans rien afficher. Utiliser la modale interne
(`promptDialog` dans `LeftSidebar.tsx`) ou `confirm()` du plugin dialog.

**Sources blob non positionnables.** Un audio lu depuis un `blob:` ne démarre
pas forcément à 0:00. Les écoutes en ligne passent donc par le serveur local,
jamais par un blob.

**Écoute en ligne : relais, pas téléchargement.** La route `/audio?u=<url>` du
serveur média (`relay_audio`) rapatrie la piste **par tranches de 512 Ko** en
transmettant les en-têtes `Range`. Avant, l'interface téléchargeait le fichier
entier avant le premier son : 3 à 15 Mo d'attente sans retour visuel. Le relais
ne répond qu'aux hôtes déjà autorisés pour les téléchargements audio
(`host_allowed`) — ce n'est pas un proxy générique. Il répond volontairement
moins d'octets que demandé, ce que HTTP autorise pour un 206 : WebKit demande
`bytes=0-`, soit tout le fichier.

**Mode de rendu (`apply_render_mode`).** `WEBKIT_DISABLE_DMABUF_RENDERER=1` et
`WEBKIT_DISABLE_COMPOSITING_MODE=1` corrigent une fenêtre noire ou verte sur
certaines machines, mais font calculer **chaque image de vidéo par le
processeur**. Sur un petit processeur (Celeron 2 cœurs), la projection saccade
et l'audio hache avec elle, alors que la machine sait décoder en matériel.
Elles ne sont donc plus imposées : le mode se choisit dans
**bibliothèque > Diagnostic > Rendu des vidéos** et se range dans
`$XDG_DATA_HOME/com.bryan.myprojector/render.json`.

| Mode | Compositing | DMA-BUF | Décodage |
|---|---|---|---|
| `auto` (défaut) | GPU | GPU | VA-API préféré (`GST_PLUGIN_FEATURE_RANK`) |
| `compat` | GPU | désactivé | VA-API préféré |
| `software` | désactivé | désactivé | logiciel |

Le réglage est lu **avant** la création du premier WebView (WebKitGTK et
GStreamer ne lisent ces variables qu'une fois par processus), donc sans passer
par `app.path()` — d'où le chemin reconstruit à la main. Un changement ne prend
effet qu'au redémarrage, et l'interface le dit.

**Filet de sécurité (`resolve_render_mode`).** Rendre le mode accéléré par
défaut déplace le risque : là où le DMA-BUF échoue vraiment, la fenêtre reste
NOIRE — et un opérateur devant une fenêtre noire ne peut pas cliquer sur le
réglage qui l'en sortirait. On écrit donc un témoin `pending` dans
`render.json` AVANT d'ouvrir la fenêtre ; l'interface l'efface
(`confirm_render_ok`) dès qu'elle a produit des images. Le retrouver au
démarrage suivant signifie que rien ne s'est affiché : on redescend d'un cran
(`auto` → `compat` → `software`) et `downgraded_from` permet à la carte
Diagnostic de l'expliquer, avec un bouton pour revenir en arrière.

⚠ **La confirmation compte de vraies IMAGES, pas le montage de React.** Sur une
fenêtre noire, le JavaScript s'exécute normalement ; confirmer au montage
viderait le filet de tout son sens. On attend dix rappels de
`requestAnimationFrame`, qui est cadencé par le compositeur : si rien n'est
composé, ils ne viennent pas. Dix images (~1/6 s à 60 Hz) suffisent pour que
l'usage normal confirme toujours, sans qu'une fermeture immédiate déclenche un
faux repli — lequel resterait de toute façon visible et annulable d'un clic.

Un seul échec suffit à faire redescendre : attendre deux échecs laisserait
l'opérateur bloqué plus longtemps, pour un gain nul.

**Les variables déjà définies par l'utilisateur ne sont jamais écrasées**, pour
pouvoir diagnostiquer depuis le terminal sans recompiler.

**L'optimisation des médias en arrière-plan est réservée aux machines de 4 cœurs
ou plus.** `nice -n 19` ne suffit pas à deux cœurs : ffprobe puis ffmpeg
prennent la moitié du processeur, et l'autre moitié doit déjà décoder la vidéo
et alimenter le pipeline audio.

---

## 6. Permissions Tauri

`src-tauri/capabilities/default.json`.

**⚠ `opener:allow-open-path` sans `allow` n'autorise rien.** Activer la commande
sans portée revient à refuser tous les chemins. D'où :

```json
{ "identifier": "opener:allow-open-path",
  "allow": [{ "path": "$APPDATA/*" }, { "path": "$APPDATA/**" }] }
```

Les deux motifs sont nécessaires : `*` pour les fichiers à la racine, `**` pour
les sous-dossiers. À vérifier après modification dans
`src-tauri/gen/schemas/capabilities.json`.

La CSP vit dans `tauri.conf.json` et est **compilée dans le binaire** : la
modifier impose une recompilation, pas un simple rechargement.

---

## 7. Rendu des diapos

`src/lib/slides.ts` (`getSlides`) découpe un élément en diapos projetables : sur
les **lignes vides** pour un chant, un verset ou une méditation ; sur les
**barres horizontales** (`---`, `***`, `___`) pour le Markdown. Toujours au
moins une diapo, jamais de tableau vide.

Le Markdown est rendu par `MarkdownView` (react-markdown + GFM + KaTeX). Le HTML
brut n'est **volontairement pas** interprété : les médias passent par la syntaxe
image (`![](clip.mp4)` produit une vidéo), ce qui couvre le besoin sans ouvrir
la porte à l'injection de balises dans la fenêtre de projection.

Une diapo Markdown suit les réglages de la barre d'outils (police, couleur,
alignement, taille) comme n'importe quelle autre diapo, et laisse voir le fond —
seul un voile léger est appliqué pour la lisibilité. Les styles typographiques
sont dans `src/index.css`, section `.markdown-body` : Tailwind remet à zéro les
styles par défaut, il faut donc les redonner explicitement.

---

## 8. Apparence d'une diapo : une cascade, cinq blocs

Un réglage de projection se décompose en cinq blocs, tous soumis à la même
cascade de portées (catégorie → livre → chant → diapo, le plus précis gagne,
`getComputedSettingsForVerse` dans `App.tsx`) :

| Bloc | Où | Ce qu'il règle |
|---|---|---|
| `textSettings` | — | police, taille, couleur, alignement, ombre |
| `bgImage` | — | le fichier de fond |
| `bgFilters` | `src/lib/bgStyle.ts` | luminosité, contraste, flou, voile |
| `header` | `src/lib/header.ts` | la référence affichée par-dessus la diapo |
| `transition` | `src/lib/transitions.ts` | l'effet au changement de diapo |
| `parallel` | `src/lib/parallel.ts` | versions bibliques affichées en plus |

Ajouter un bloc = l'ajouter aux quatre endroits de la cascade et à
`updateScopeField`. Les cinq passent par ce seul chemin : une correction sur
l'un profite aux autres.

**⚠ `header` et `transition` ont été globaux, et c'était une erreur.** Un
cantique et un verset n'ont pas besoin de la même référence ni du même effet.
Un thème (`src/lib/themes.ts`) enregistre un instantané des cinq blocs.

**⚠ La transition voyage dans le payload de `update_live_content`,** pas dans
son propre évènement : c'est la diapo qui ARRIVE qui décide de la façon dont
elle arrive. Un évènement séparé pourrait être traité un cycle plus tard, et
la diapo s'afficherait avec l'effet de la précédente.

**⚠ Le flou agrandit l'image.** Flouter mélange les bords avec le vide et
dessine un cadre délavé : `bgMediaStyle()` compense par un `scale`, et le
conteneur du fond doit donc porter `overflow-hidden`.

**⚠ Le flou est en `vmin`, pas en pixels.** Le mini-moniteur fait 400 px de
large, l'écran de projection 1920 : en pixels, le même réglage serait
invisible d'un côté et énorme de l'autre, et l'aperçu mentirait.

L'**entête** (la référence par-dessus la diapo) est globale, pas par portée :
`src/lib/header.ts`. Elle était auparavant codée en dur dans `LiveView` — en
haut à droite, exactement là où se place l'horloge par défaut.
`headerOffsetPercent()` l'écarte maintenant de l'horloge et du bandeau.
`ProjectionHeader` est rendue **par les deux fenêtres** : c'est volontaire,
puisque c'est précisément ce qu'on ne pouvait pas juger avant de projeter.

---

## 9. Polices

Elles sont **embarquées**, pas téléchargées : `public/fonts/*.woff2`, déclarées
dans `src/fonts.css`, régénérés par `node scripts/fetch-fonts.mjs` (seule
commande à relancer pour ajouter une famille, après l'avoir ajoutée à `FAMILIES`
**et** à `FONTS` dans `src/lib/fonts.ts`).

Avant, un `<link>` pointait vers fonts.googleapis.com. Sans réseau le jour d'un
culte, la projection retombait sur une police système : la mise en page
préparée la veille n'était plus la même. La CSP n'autorise donc plus aucune
origine de police distante.

**⚠ WebKitGTK ignore `font-family` sur une `<option>`.** D'où `FontPicker`, un
menu maison : avec trente-deux familles, une liste de noms sans aperçu
obligeait à projeter pour voir le résultat.

---

## 10. Recherche biblique

Deux modes dans l'onglet Bible :

- **Référence** — `Jean 3:16` est résolu côté interface (`LeftSidebar`), par
  comparaison de formes normalisées et de `books.short_name`.
- **Texte** — commande Rust `search_bible`, qui balaie les ~31 000 versets, en
  retire le balisage MyBible (`<S>`, `<pb/>`…) et compare des formes sans
  accents ni casse. Tous les mots doivent être présents ; entre guillemets, la
  saisie vaut pour une expression exacte.

Pourquoi en Rust alors que le texte est déjà en mémoire côté interface :
normaliser 31 000 versets à chaque frappe gèle le webview. Pourquoi pas FTS5 :
les fichiers MyBible n'ont pas de table de recherche, et en créer une
modifierait des bases que l'utilisateur a téléchargées ou sauvegardées.

**⚠ `fold()` existe en double** — `src-tauri/src/lib.rs` filtre, `src/lib/fold.ts`
surligne. Si l'une change, changer l'autre, sinon un mot trouvé n'est pas mis
en évidence.

---

## 11. Télécommande (port 11224)

Désactivée par défaut. Une fois activée (Bibliothèque → Télécommande), un
serveur écoute sur `0.0.0.0:11224` et sert une page mobile autonome. L'accès est
protégé par un **code à 6 chiffres** régénéré à chaque activation, et seules
onze actions nommées sont acceptées — ce n'est pas une API générique.

Le Bluetooth n'est pas utilisé : il n'existe pas de canal Bluetooth accessible
depuis un webview, et le Wi-Fi local couvre le besoin sans appairage.

---

## 12. Mise à jour

Voir [RELEASE.md](RELEASE.md). Principe côté application : on vérifie, on
propose, on n'installe jamais tout seul. Une projection ne doit pas être
interrompue par un redémarrage.
