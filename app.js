import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://hypkwdvvrmakqrowbkqw.supabase.co";
const SUPABASE_KEY = "sb_publishable_y0_DEhM-bC37jEKkiC_GGQ_TaWvPqVe";

// Il recupero password passa da n8n, che genera il link e lo manda su WhatsApp.
const RECOVERY_WEBHOOK = "https://n8n.srv1035791.hstgr.cloud/webhook/academy-recupero";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById("app");
const topbar = document.getElementById("topbar");

let catalog = null;   // cache del catalogo, ricaricata dopo ogni salvataggio
let session = null;
let recovering = false;  // true mentre si sta impostando la password dal link

// ------------------------------------------------------------------ utils

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Le descrizioni arrivano da GHL come HTML. Teniamo solo il minimo:
// niente script, niente attributi, e i link si aprono in una scheda nuova.
function safeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const allowed = new Set(["P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "A", "H3", "H4"]);
  const walk = (node) => {
    [...node.children].forEach((el) => {
      if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      const href = el.tagName === "A" ? el.getAttribute("href") : null;
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (href && /^https?:\/\//i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      walk(el);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const courseStats = (course) => {
  const lessons = course.modules.flatMap((m) => m.lessons);
  const done = lessons.filter((l) => l.completed_at).length;
  return { total: lessons.length, done, pct: lessons.length ? Math.round(done / lessons.length * 100) : 0 };
};

const findLesson = (id) => {
  for (const c of catalog ?? []) {
    for (const m of c.modules) {
      const i = m.lessons.findIndex((l) => l.id === id);
      if (i >= 0) return { course: c, module: m, lesson: m.lessons[i], next: m.lessons[i + 1] ?? null };
    }
  }
  return null;
};

// ------------------------------------------------------------------ login

function renderLogin(message = "") {
  topbar.hidden = true;
  app.innerHTML = `
    <div class="login">
      <h1>SV Academy</h1>
      <p class="sub">Accedi con le credenziali che ti ha dato il tuo consulente.</p>
      ${message}
      <form id="f">
        <input id="email" type="email" required placeholder="la-tua@email.it" autocomplete="email">
        <input id="password" type="password" required placeholder="Password" autocomplete="current-password">
        <button class="btn btn-wide" type="submit">Entra</button>
      </form>
      <p class="sub small"><a href="#/recupera">Ho dimenticato la password</a></p>
    </div>`;

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Accesso…";

    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    });

    if (error) {
      const msg = /invalid login/i.test(error.message)
        ? "Email o password non corretti."
        : esc(error.message);
      renderLogin(`<div class="notice error">${msg}</div>`);
      return;
    }
    location.hash = "#/";
    boot();
  });
}

// Richiesta del link di recupero: parte su WhatsApp, non via email.
// La risposta e' sempre la stessa, che il numero esista o no.
function renderRecover(message = "") {
  topbar.hidden = true;
  app.innerHTML = `
    <div class="login">
      <h1>Password dimenticata</h1>
      <p class="sub">Scrivi la tua email oppure il numero di telefono:<br>
         ti mandiamo il link su WhatsApp.</p>
      ${message}
      <form id="f">
        <input id="identifier" type="text" required placeholder="email@centro.it oppure 347 1234567"
               autocomplete="username" inputmode="email">
        <button class="btn btn-wide" type="submit">Mandami il link</button>
      </form>
      <p class="sub small"><a href="#/">Torna all'accesso</a></p>
    </div>`;

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const identifier = document.getElementById("identifier").value.trim();
    btn.disabled = true;
    btn.textContent = "Invio…";

    try {
      await fetch(RECOVERY_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
    } catch (_) {
      // Anche se la chiamata non riesce mostriamo lo stesso messaggio: chi
      // prova numeri a caso non deve capire nulla dalla risposta.
    }

    app.innerHTML = `
      <div class="login">
        <h1>Controlla WhatsApp</h1>
        <p class="sub">Se il recapito è registrato, ti arriva un messaggio col link
           per impostare la nuova password.</p>
        <p class="sub small">Non ti arriva niente? Scrivi al tuo consulente.<br>
           <a href="#/">Torna all'accesso</a></p>
      </div>`;
  });
}

// Si arriva qui dal link WhatsApp: #/nuova-password/<token>.
// Il token viene verificato adesso, in pagina. E' il motivo per cui il link
// sopravvive all'anteprima di WhatsApp: aprire questo indirizzo non consuma
// nulla finche' non e' il browser del destinatario a farlo.
async function renderTokenRecovery(tokenHash) {
  topbar.hidden = true;
  app.innerHTML = `<div class="loading">Verifico il link…</div>`;

  const { data, error } = await sb.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });

  if (error || !data?.session) {
    app.innerHTML = `
      <div class="login">
        <h1>Link non più valido</h1>
        <p class="sub">I link durano un'ora e si possono usare una volta sola.<br>
           Chiedine un altro, oppure scrivi al tuo consulente.</p>
        <p class="sub small"><a href="#/recupera">Richiedi un nuovo link</a></p>
      </div>`;
    return;
  }

  session = data.session;
  recovering = true;
  renderNewPassword(true);
}

// Impostazione della nuova password: si arriva qui dal link di recupero,
// oppure dal menu quando si e' gia' dentro.
function renderNewPassword(fromRecovery) {
  topbar.hidden = !session || fromRecovery;
  app.innerHTML = `
    <div class="login">
      <h1>${fromRecovery ? "Imposta la password" : "Cambia password"}</h1>
      <p class="sub">Almeno 8 caratteri.</p>
      <form id="f">
        <input id="p1" type="password" required minlength="8" placeholder="Nuova password" autocomplete="new-password">
        <input id="p2" type="password" required minlength="8" placeholder="Ripeti la password" autocomplete="new-password">
        <button class="btn btn-wide" type="submit">Salva</button>
      </form>
      ${fromRecovery ? "" : `<p class="sub small"><a href="#/">Annulla</a></p>`}
    </div>`;

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = document.getElementById("p1").value;
    const p2 = document.getElementById("p2").value;
    const btn = e.target.querySelector("button");

    if (p1 !== p2) {
      app.querySelector(".sub").innerHTML = `<span style="color:#8d2b25">Le due password non coincidono.</span>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Salvo…";

    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) {
      btn.disabled = false;
      btn.textContent = "Riprova";
      app.querySelector(".sub").innerHTML = `<span style="color:#8d2b25">${esc(error.message)}</span>`;
      return;
    }
    recovering = false;
    location.hash = "#/";
    boot();
  });
}

// ------------------------------------------------------------------ corsi

function renderHome() {
  const accessible = catalog.filter((c) => c.has_access);
  const locked = catalog.filter((c) => !c.has_access);

  const card = (c) => {
    const s = courseStats(c);
    const thumb = c.poster_url
      ? `<div class="thumb" style="background-image:url('${esc(c.poster_url)}')"></div>`
      : `<div class="thumb">${esc(c.title)}</div>`;

    const foot = c.has_access
      ? (s.total
          ? `<div class="meta"><div class="bar"><i style="width:${s.pct}%"></i></div><span>${s.done}/${s.total}</span></div>`
          : `<div class="meta"><span>Nessuna lezione pubblicata</span></div>`)
      : `<div class="meta"><span class="badge gold">Non incluso</span><span>Scrivi al tuo consulente</span></div>`;

    return `
      <a class="card ${c.has_access ? "" : "locked"}" href="${c.has_access ? "#/corso/" + esc(c.slug) : "#/"}">
        ${thumb}
        <div class="card-body">
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.description || "")}</p>
          ${foot}
        </div>
      </a>`;
  };

  app.innerHTML = `
    <h1>I tuoi corsi</h1>
    <p class="sub">Formazione Salone Vincente</p>
    ${accessible.length ? `<div class="grid">${accessible.map(card).join("")}</div>`
      : `<div class="notice">Non hai ancora corsi attivi. Scrivi al tuo consulente per l'accesso.</div>`}
    ${locked.length ? `<h2>Disponibili su richiesta</h2><div class="grid">${locked.map(card).join("")}</div>` : ""}`;
}

function renderCourse(slug) {
  const course = catalog.find((c) => c.slug === slug);
  if (!course) return renderMissing();
  if (!course.has_access) return renderMissing("Questo corso non è incluso nel tuo percorso.");

  const s = courseStats(course);
  const modules = course.modules.map((m) => `
    <h2>${esc(m.title)}</h2>
    <div class="lessons">
      ${m.lessons.map((l, i) => `
        <a class="lesson" href="#/lezione/${esc(l.id)}">
          <span class="n ${l.completed_at ? "done" : ""}">${l.completed_at ? "✓" : i + 1}</span>
          <span class="t">${esc(l.title)}</span>
          ${l.has_video ? "" : `<span class="badge">in arrivo</span>`}
        </a>`).join("")}
    </div>`).join("");

  app.innerHTML = `
    <a class="back" href="#/">← Tutti i corsi</a>
    <h1>${esc(course.title)}</h1>
    <p class="sub">${esc(course.description || "")}</p>
    ${s.total ? `<div class="meta"><div class="bar"><i style="width:${s.pct}%"></i></div><span>${s.done} di ${s.total} completate</span></div>` : ""}
    ${modules || `<div class="notice">Nessuna lezione pubblicata al momento.</div>`}`;
}

// ----------------------------------------------------------------- player

let wmTimer = null;

function startWatermark(text) {
  const wrap = document.querySelector(".player-wrap");
  if (!wrap) return;
  const wm = document.createElement("div");
  wm.id = "wm";
  wm.textContent = text;
  wrap.appendChild(wm);

  const move = () => {
    wm.style.left = (8 + Math.random() * 60) + "%";
    wm.style.top = (10 + Math.random() * 75) + "%";
  };
  move();
  clearInterval(wmTimer);
  wmTimer = setInterval(move, 20000);
}

async function renderLesson(id) {
  const found = findLesson(id);
  if (!found) return renderMissing();
  const { course, lesson, next } = found;

  app.innerHTML = `
    <a class="back" href="#/corso/${esc(course.slug)}">← ${esc(course.title)}</a>
    <h1>${esc(lesson.title)}</h1>
    <div id="video"><div class="loading">Preparo il video…</div></div>
    <div class="lesson-desc">${safeHtml(lesson.description_html)}</div>
    <div class="actions">
      <button id="done" class="btn ${lesson.completed_at ? "btn-gold" : ""}" ${lesson.completed_at ? "disabled" : ""}>
        ${lesson.completed_at ? "✓ Completata" : "Segna come completata"}
      </button>
      ${next ? `<a class="btn btn-gold" href="#/lezione/${esc(next.id)}">Lezione successiva →</a>` : ""}
    </div>`;

  document.getElementById("done").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Salvo…";
    const { error } = await sb.rpc("academy_set_progress",
      { p_lesson: lesson.id, p_seconds: 0, p_completed: true });
    if (error) {
      e.target.disabled = false;
      e.target.textContent = "Riprova";
      return;
    }
    await loadCatalog();
    route();
  });

  const box = document.getElementById("video");

  if (!lesson.has_video) {
    box.innerHTML = `<div class="notice">Il video di questa lezione non è ancora disponibile.</div>`;
    return;
  }

  // L'URL del player lo emette il server, e solo se l'iscrizione e' valida.
  const { data, error } = await sb.functions.invoke("lesson-video", { body: { lessonId: lesson.id } });

  if (error || !data?.embedUrl) {
    box.innerHTML = `<div class="notice error">Non riesco ad aprire il video. Ricarica la pagina o scrivi al tuo consulente.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="player-wrap">
      <iframe src="${esc(data.embedUrl)}" loading="lazy"
              allow="accelerometer; gyroscope; encrypted-media; picture-in-picture; fullscreen"
              allowfullscreen></iframe>
    </div>`;
  startWatermark(data.viewer || session?.user?.email || "");
}

function renderMissing(msg = "Contenuto non trovato.") {
  app.innerHTML = `<a class="back" href="#/">← Tutti i corsi</a><div class="notice">${esc(msg)}</div>`;
}

// -------------------------------------------------------------- assistente

const CHAT_URL = `${SUPABASE_URL}/functions/v1/academy-chat`;

// La conversazione vive nel tab: sopravvive alla navigazione, muore col tab.
let chat = { id: null, msgs: [], busy: false };
try {
  const saved = JSON.parse(sessionStorage.getItem("sv_chat") || "null");
  if (saved && Array.isArray(saved.msgs)) chat = { ...saved, busy: false };
} catch (_) { /* storage corrotto: si riparte da zero */ }
if (!chat.id) chat.id = crypto.randomUUID();

const saveChat = () => {
  try {
    sessionStorage.setItem("sv_chat", JSON.stringify({ id: chat.id, msgs: chat.msgs.slice(-24) }));
  } catch (_) { /* quota storage piena: pazienza */ }
};

// Rendering della risposta: tutto escapato, poi si riabilitano SOLO i link
// alle lezioni [titolo](#/lezione/<uuid>) e il **grassetto**.
function chatHtml(text) {
  let h = esc(text);
  h = h.replace(
    /\[([^\]]+)\]\((#\/lezione\/[0-9a-f-]{36})\)/g,
    `<a href="$2">📖 $1</a>`,
  );
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return h.replace(/\n/g, "<br>");
}

const SUGGERIMENTI = [
  "Come gestisco l'obiezione «ci devo pensare»?",
  "Cosa posso pubblicare sui social in 10 minuti al giorno?",
  "Quali numeri devo controllare ogni mese nel mio centro?",
];

function renderChat() {
  const bubbles = chat.msgs.map((m) =>
    `<div class="msg ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? esc(m.content) : chatHtml(m.content)}</div>`,
  ).join("");

  app.innerHTML = `
    <a class="back" href="#/">← Tutti i corsi</a>
    <h1>Assistente</h1>
    <p class="sub">Fammi una domanda sui contenuti dei corsi: ti rispondo citando la lezione giusta.</p>
    <div class="chat">
      <div id="msgs" class="chat-msgs">
        ${bubbles || ""}
        ${chat.msgs.length ? "" : `
          <div class="chat-suggest">
            ${SUGGERIMENTI.map((s) => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join("")}
          </div>`}
      </div>
      <div id="chat-status" class="chat-status" hidden></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" type="text" maxlength="2000" autocomplete="off"
               placeholder="Scrivi la tua domanda…">
        <button class="btn" type="submit">Invia</button>
      </form>
    </div>`;

  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q && !chat.busy) { input.value = ""; sendChat(q); }
  });
  app.querySelectorAll(".chat-suggest button").forEach((b) =>
    b.addEventListener("click", () => { if (!chat.busy) sendChat(b.dataset.q); }));

  scrollChat();
}

const scrollChat = () => {
  const el = document.getElementById("msgs");
  if (el) window.scrollTo(0, document.body.scrollHeight);
};

function setChatBusy(busy) {
  chat.busy = busy;
  const input = document.getElementById("chat-input");
  const btn = document.querySelector("#chat-form button");
  if (input) input.disabled = busy;
  if (btn) { btn.disabled = busy; btn.textContent = busy ? "…" : "Invia"; }
}

async function sendChat(question) {
  const msgs = document.getElementById("msgs");
  const status = document.getElementById("chat-status");
  if (!msgs) return;

  // la history da mandare NON include la domanda corrente
  const history = chat.msgs.slice(-8).map((m) => ({ role: m.role, content: m.content }));

  chat.msgs.push({ role: "user", content: question });
  saveChat();
  msgs.querySelector(".chat-suggest")?.remove();
  msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(question)}</div>`);

  // Riferimento diretto alla bolla, MAI per id: con piu' domande nella stessa
  // pagina un id duplicato farebbe finire la risposta nella bolla precedente.
  const live = document.createElement("div");
  live.className = "msg ai";
  live.innerHTML = `<span class="dots">Ci penso…</span>`;
  msgs.appendChild(live);
  setChatBusy(true);
  scrollChat();
  let answer = "";
  const showStatus = (text) => {
    if (!status) return;
    status.hidden = !text;
    status.textContent = text || "";
  };

  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${session.access_token}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify({ message: question, history, conversationId: chat.id }),
    });

    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/event-stream")) {
      const err = await res.json().catch(() => ({}));
      const msg = res.status === 429
        ? "Hai finito le domande per oggi: la quota si rinnova domani. Se ti serve altro, scrivi al tuo consulente."
        : "Non riesco a risponderti in questo momento. Riprova tra poco.";
      console.error("academy-chat", res.status, err);
      live.innerHTML = chatHtml(msg);
      chat.msgs.push({ role: "assistant", content: msg });
      saveChat();
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() || "";
      for (const evt of events) {
        const lines = evt.split("\n");
        const name = (lines.find((l) => l.startsWith("event: ")) || "").slice(7);
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        let d = {};
        try { d = JSON.parse(dataLine.slice(6)); } catch (_) { continue; }

        if (name === "delta" && d.text) {
          answer += d.text;
          showStatus("");
          live.innerHTML = chatHtml(answer);
          scrollChat();
        } else if (name === "status" && d.type === "reading") {
          showStatus(`📖 Sto leggendo: ${d.title}`);
        } else if (name === "error") {
          answer = answer || d.message || "Qualcosa è andato storto, riprova.";
          live.innerHTML = chatHtml(answer);
        }
      }
    }

    if (!answer) answer = "Non sono riuscito a produrre una risposta, riprova.";
    chat.msgs.push({ role: "assistant", content: answer });
    saveChat();
  } catch (e) {
    console.error("academy-chat", e);
    const msg = "Connessione interrotta. Controlla la rete e riprova.";
    if (live) live.innerHTML = chatHtml(answer ? answer + "\n\n" + msg : msg);
    chat.msgs.push({ role: "assistant", content: answer || msg });
    saveChat();
  } finally {
    showStatus("");
    setChatBusy(false);
    scrollChat();
  }
}

// ------------------------------------------------------------------ routing

async function loadCatalog() {
  const { data, error } = await sb.rpc("academy_my_catalog");
  if (error) {
    app.innerHTML = `<div class="notice error">Errore nel caricamento: ${esc(error.message)}</div>`;
    return false;
  }
  catalog = data ?? [];
  return true;
}

function route() {
  clearInterval(wmTimer);
  const [, section, param] = (location.hash || "#/").split("/");
  if (section === "password") return renderNewPassword(false);
  if (section === "corso") return renderCourse(param);
  if (section === "lezione") return renderLesson(param);
  if (section === "assistente") return renderChat();
  renderHome();
}

async function boot() {
  // Il link di recupero ha la precedenza su tutto: anche se c'e' gia' una
  // sessione aperta, chi arriva da li' deve poter cambiare la password.
  const [, sezione, parametro] = (location.hash || "#/").split("/");
  if (sezione === "nuova-password" && parametro) {
    return renderTokenRecovery(parametro);
  }

  const { data } = await sb.auth.getSession();
  session = data.session;

  if (!session) {
    return (location.hash === "#/recupera") ? renderRecover() : renderLogin();
  }

  topbar.hidden = false;
  document.getElementById("who").textContent = session.user.email;
  if (await loadCatalog()) route();
}

document.getElementById("logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.hash = "#/";
  location.reload();
});

window.addEventListener("hashchange", () => {
  if (!session) return boot();
  if (catalog) route();
});

// Nessun ascolto sugli eventi di autenticazione: il recupero passa dalla
// rotta #/nuova-password, che e' deterministica e non dipende da chi arriva
// prima tra la libreria e noi.

boot();
