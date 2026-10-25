# Bibliothèques intégrées

| Fichier | Origine | Version | Licence |
| --- | --- | --- | --- |
| `qrcode-generator.mjs` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), fichier `dist/qrcode.mjs` du paquet npm, copié sans modification | 2.0.4 | MIT (Kazuhiko Arase) |

Empreinte SHA-256 de `qrcode-generator.mjs` : `ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0`.

Intégrée au code (et non installée par npm) pour ne rien ajouter à `node_modules` : aucune installation n'est nécessaire.
Elle ne fait aucun appel réseau ; l'application ne s'en sert que pour calculer les cases du QR code d'une invitation,
dessiné ensuite en SVG par `src/ui/QrCode.tsx`.
