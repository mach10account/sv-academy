# SV Academy

Piattaforma corsi di Salone Vincente. Sostituisce l'area membri di GoHighLevel.

- **Frontend**: statico, nessuna build. Supabase JS via CDN.
- **Dati e accessi**: Supabase (schema `academy`), regole RLS: un membro vede
  solo i corsi a cui è iscritto.
- **Video**: Bunny Stream. L'URL del player non sta nel frontend: lo emette la
  edge function `lesson-video` dopo aver verificato l'iscrizione, firmato e
  con scadenza a 30 minuti.
- **Watermark**: l'email di chi guarda viene sovrapposta al player.

## File

| file | contenuto |
|---|---|
| `index.html` | struttura di base |
| `app.js` | login, routing, catalogo, player, avanzamento |
| `styles.css` | stile |

Nel repository non ci sono segreti: la sola chiave presente è quella
publishable di Supabase, protetta lato database dalle policy RLS.
