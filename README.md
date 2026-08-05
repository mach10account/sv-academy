# SV Academy — spostata

I corsi non vivono più qui: stanno nel sito unico, insieme all'agenda del
centro, alle conversazioni delle clienti e all'assistente.

- Sito: <https://estetista-indipendente.com/>
- Codice: <https://github.com/mach10account/sv-agenda>

Questo repository resta in piedi per due ragioni: i link già mandati ai centri
puntano qui, e la edge function `recovery-link` scrive **questo** indirizzo
dentro ogni link di recupero password. `index.html` è una pagina di rimbalzo che
porta di là **conservando la parte dopo il #** — una lezione, un corso o un link
di recupero aperto da WhatsApp arriva al posto giusto.

Chi apre la home viene mandato ai corsi (`#/corsi`), non all'agenda.

Il fatto che sia un indirizzo `github.io` e non un dominio nostro è voluto: non
cambia quando cambia il dominio del sito. Al trasloco successivo si aggiorna la
destinazione qui dentro (una riga) e tutti i link già in circolazione — anche
quelli mandati mesi fa — continuano ad arrivare dove devono.

Il sito è passato da `agenda.salone-vincente.com` a `estetista-indipendente.com`
il 5/8/2026. Il vecchio dominio non risponde più: GitHub Pages serve un solo
dominio per sito.
