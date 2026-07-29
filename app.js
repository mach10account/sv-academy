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
// Letto subito, in modo sincrono: supabase-js ripulisce l'hash appena stabilisce
// la sessione, e l'evento PASSWORD_RECOVERY puo' scattare prima che il nostro
// ascoltatore sia pronto. Senza questo controllo il link di recupero porta
// direttamente ai corsi, saltando il cambio password.
let recovering = /(^|[#&])type=recovery(&|$)/.test(location.hash);

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
  renderHome();
}

async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;

  // Arrivo dal link di recupero: prima la nuova password, poi il resto.
  // Se la sessione non e' ancora pronta si aspetta: ci pensa
  // onAuthStateChange a richiamare boot() appena arriva.
  if (recovering) {
    if (!session) {
      topbar.hidden = true;
      app.innerHTML = `<div class="loading">Un attimo…</div>`;
      return;
    }
    return renderNewPassword(true);
  }

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

sb.auth.onAuthStateChange((event, s) => {
  if (event === "PASSWORD_RECOVERY") recovering = true;
  // Durante un recupero la sessione puo' arrivare con qualsiasi evento
  // (INITIAL_SESSION, SIGNED_IN, PASSWORD_RECOVERY): appena c'e', si mostra
  // la schermata della nuova password.
  if (recovering && s) { session = s; renderNewPassword(true); }
});

boot();
