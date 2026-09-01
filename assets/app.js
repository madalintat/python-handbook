/* The Python Handbook: routing, views, progress. No framework, no build step. */

import { highlightPython, mountWorkbench, esc, inline, cached, flag, setFlag, judges } from "./workbench.js";

const main = document.getElementById("main");
const $ = (s, r = document) => r.querySelector(s);

/* ------------------------------------------------------------------ data */

// cached() memoises the success and drops a failure, so one bad fetch does not
// poison a key for the rest of the session.
const load = name => cached(`data:${name}`, () => fetch(`data/${name}.json`).then(r => {
  if (!r.ok) throw new Error(`${name} not built yet`);
  return r.json();
}));

/* ------------------------------------------------------------------ progress */

const KEY = "ph.progress";
const store = {
  all() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} },
  get(bucket, k) { return (this.all()[bucket] || {})[k]; },
  // rendering the 39-unit track called get() once per card, and each call
  // re-read and re-parsed the whole progress blob
  read() { return this.all().read || {}; },
  set(bucket, k, v) {
    const p = this.all();
    (p[bucket] ||= {})[k] = v;
    this.save(p);
  },
};

const RAIL_KEY = "ph.rail";
const railCollapsed = () => flag(RAIL_KEY);

const sheet = document.getElementById("sheet");
const sheetBody = document.getElementById("sheet-body");
const sheetBtn = document.getElementById("sheetbtn");
sheetBtn?.addEventListener("click", () => sheet.classList.toggle("open"));
sheet?.addEventListener("click", e => { if (e.target.closest("a")) sheet.classList.remove("open"); });

/* ------------------------------------------------------------------ markdown

   Deliberately small: headings, paragraphs, fenced code, inline code, bold,
   links and lists. Anything the notes do not use is not supported.          */

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const BLOCK = /^(```|#{2,4}\s|[-*]\s|\|)/;

function md(src) {
  const out = [];
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${highlightPython(body.join("\n"))}</code></pre>`);
      continue;
    }
    // A table: a header row, a divider of dashes, then the body.
    if (line.startsWith("|") && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = r => r.split("|").slice(1, -1).map(c => inline(c.trim()));
      const head = cells(rows[0]).map(c => `<th>${c}</th>`).join("");
      const body = rows.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} id="${slugify(h[2])}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) items.push(inline(lines[i++].slice(2)));
      out.push(`<ul>${items.map(t => `<li>${t}</li>`).join("")}</ul>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }

    const para = [];
    while (i < lines.length && lines[i].trim() && !BLOCK.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ views */

const stagger = els => els.forEach((el, n) => (el.style.animationDelay = `${Math.min(n * 26, 400)}ms`));

async function viewHome() {
  const m = await load("manifest");
  const units = m.track.length;
  const done = m.track.filter(u => u.hasNote && u.hasEx && u.hasDrills).length;
  const hours = Math.round(m.totalMinutes / 60);
  // What exists, not what the manifest plans. Advertising a number the reader
  // cannot reach is the one thing a progress figure must never do.
  const writtenEx = m.track.reduce((n, u) => n + u.hasEx, 0);
  const writtenDrills = m.track.reduce((n, u) => n + u.hasDrills, 0);

  main.innerHTML = `
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <p class="eyebrow">${units} units · ${m.projects.length} projects · CPython 3.14</p>
      <h1>Python doesn't stop you.</h1>
      <p class="lede">A compiler refuses code it cannot make sense of. Python takes almost
      anything you write, runs it, and finds the mistake when it reaches that line, or hands
      back a wrong answer and says nothing at all. Every exercise here runs for real in your
      own browser, judged by three tools that disagree with each other.</p>
      <div class="hero-cta">
        <a class="btn" href="#/unit/01-names">Start at unit 01</a>
        <a class="btn ghost" href="#/track">See the whole track</a>
      </div>
    </div>
    <img class="hero-mascot" src="assets/mascot-512.png" alt="The handbook's mascot, a python in a hard hat with a laptop">
  </div></section>

  <div class="wrap">
    <div class="stats">
      <div class="stat"><b>${units}</b><span>units, in dependency order</span></div>
      <div class="stat"><b>${writtenEx}</b><span>exercises that really run</span></div>
      <div class="stat"><b>${writtenDrills}</b><span>drills</span></div>
      <div class="stat"><b>${m.projects.length}</b><span>projects, ~${hours}h of building</span></div>
      <div class="stat"><b>${done}</b><span>units written of ${units}</span></div>
    </div>

    <div class="section-head"><h2>Three judges</h2></div>
    <p class="muted" style="max-width:64ch;margin-top:-0.4rem">
      Your code is checked by a linter, a type checker and the interpreter itself, all
      running locally in this tab. They do not always agree, and an exercise can be
      <em>correct but yellow</em>, which is a state a compiler cannot express.</p>
    <div class="judges">
      <div class="judge"><h4><i class="dot ok"></i>ruff</h4><p>Lint codes like <code>B006</code>, in about a millisecond. Catches the mistakes that have a visible shape.</p></div>
      <div class="judge"><h4><i class="dot warn"></i>mypy</h4><p>Type codes like <code>arg-type</code>, before anything runs. Only speaks about code you have annotated.</p></div>
      <div class="judge"><h4><i class="dot bad"></i>CPython</h4><p>The truth. Runs your code and either raises, or quietly returns the wrong answer.</p></div>
    </div>

    <div class="section-head"><h2>The track</h2><a class="muted mono" style="margin-left:auto;font-size:var(--t-tiny)" href="#/track">all ${units} →</a></div>
    <div class="grid" id="preview"></div>

    <div class="section-head"><h2>Projects</h2><a class="muted mono" style="margin-left:auto;font-size:var(--t-tiny)" href="#/projects">all ${m.projects.length} →</a></div>
    <div class="grid" id="projpreview"></div>
    <div style="height:3rem"></div>
  </div>`;

  // not .map(unitCard): map passes the index as the second argument, which
  // would land in readSet and silence the "read" badge
  const seen = store.read();
  $("#preview").innerHTML = m.track.slice(0, 6).map(u => unitCard(u, seen)).join("");
  $("#projpreview").innerHTML = m.projects.slice(0, 3).map(projectCard).join("");
  stagger([...main.querySelectorAll(".card")]);
}

const pad = n => String(n).padStart(2, "0");

function unitCard(u, readSet = store.read()) {
  const badge = !u.hasNote ? "<span>not written yet</span>"
    : readSet[u.slug] ? '<span class="done">read</span>' : "";
  return `<a class="card" data-accent="${u.accent}" href="#/unit/${u.slug}">
    <span class="n">${pad(u.n)}</span>
    <h3>${esc(u.title)}</h3>
    <p>${inline(u.blurb)}</p>
    <div class="meta">${u.hasEx ? `<span>${u.hasEx} exercises</span>` : ""}${u.hasDrills ? `<span>${u.hasDrills} drills</span>` : ""}${badge}</div>
  </a>`;
}

function projectCard(p) {
  return `<a class="card" data-accent="${p.tier === "deep" ? "clay" : p.tier === "core" ? "denim" : "moss"}" href="#/project/${p.slug}">
    <span class="n">${p.tierLabel.toUpperCase()} · ${p.domain.toUpperCase()}</span>
    <h3>${esc(p.title)}</h3>
    <p>${inline(p.blurb)}</p>
    <div class="meta"><span>${p.stages} stages</span><span>${Math.floor(p.minutes / 60)}h ${p.minutes % 60}m</span>${p.hasBody ? "" : "<span>not written yet</span>"}</div>
  </a>`;
}

async function viewTrack() {
  const m = await load("manifest");
  main.innerHTML = `<div class="wrap" style="padding:2rem 0 4rem">
    <p class="eyebrow">The track</p>
    <h1 style="margin:0.4rem 0 0.6rem">${m.track.length} units, in order</h1>
    <p class="lede muted" style="max-width:60ch">Each unit depends on the ones before it. There are no optional
    units and no shortcuts: the ordering is the argument.</p>
    ${(() => { const seen = store.read(); return m.phases.map(ph => `
      <div class="phase-head"><h3>${esc(ph.title)}</h3><p>${esc(ph.blurb)}</p></div>
      <div class="grid">${m.track.filter(u => u.phase === ph.n).map(u => unitCard(u, seen)).join("")}</div>
    `).join(""); })()}
  </div>`;
  stagger([...main.querySelectorAll(".card")]);
}

// Which unit is currently rendered, so a rail click that only changes the
// anchor scrolls instead of re-parsing the markdown and rebuilding the DOM.
let renderedUnit = null;

async function viewUnit(slug, anchor) {
  if (renderedUnit === slug) {
    if (anchor) {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "instant", block: "start" });
      dispatchEvent(new Event("scroll"));
    }
    return;
  }
  const m = await load("manifest");
  const meta = m.track.find(u => u.slug === slug);
  if (!meta) return notFound();

  if (!meta.hasNote) {
    main.innerHTML = `<div class="wrap" style="padding:4rem 0"><p class="eyebrow">Unit ${pad(meta.n)}</p>
      <h1>${esc(meta.title)}</h1><p class="lede muted">${inline(meta.blurb)}</p>
      <p class="muted">This unit is in the manifest but has not been written yet.</p>
      <a class="btn ghost" href="#/track">Back to the track</a></div>`;
    return;
  }

  const unit = await load(`unit-${slug}`);
  const next = m.track[meta.n + 1];

  main.innerHTML = `<div class="wrap" data-accent="${meta.accent}">
    <div class="unit-layout">
      <aside class="rail${railCollapsed() ? " collapsed" : ""}" id="railaside">
        <button class="railtoggle" id="railtoggle" title="Collapse the contents"
                aria-label="Collapse the contents">${railCollapsed() ? "\u203a" : "\u2039"}</button>
        <nav><ol id="rail"><div class="fill" id="railfill" style="height:0"></div>
        ${unit.sections.map(s => `<li><a href="#/unit/${slug}/${s.id}" data-sec="${s.id}">${esc(s.title)}</a></li>`).join("")}
      </ol></nav></aside>
      <article class="note">
        <p class="eyebrow">Unit ${pad(meta.n)} · ${esc(m.phases[meta.phase].title)}</p>
        <h1>${esc(unit.title)}</h1>
        <p class="lede">${inline(meta.blurb)}</p>
        ${md(unit.body)}
        <div class="unit-foot">
          ${meta.hasEx ? `<a class="btn" href="#/work/${slug}/1">Do the ${meta.hasEx} exercises</a>` : ""}
          ${meta.hasDrills ? `<a class="btn ghost" href="#/drills/${slug}">${meta.hasDrills} drills</a>` : ""}
          ${next ? `<a class="btn ghost" href="#/unit/${next.slug}">Next: ${esc(next.title)} →</a>` : ""}
        </div>
      </article>
    </div>
  </div>`;

  renderedUnit = slug;
  store.set("read", slug, true);
  wireRail(unit.sections);

  const aside = $("#railaside"), toggle = $("#railtoggle");
  toggle.onclick = () => {
    const now = !railCollapsed();
    setFlag(RAIL_KEY, now);
    aside.classList.toggle("collapsed", now);
    toggle.textContent = now ? "\u203a" : "\u2039";
  };

  // Below 1060px the rail is gone, so the same contents live in a bottom sheet.
  sheetBody.innerHTML = `<p class="eyebrow" style="margin-bottom:.7rem">${esc(unit.title)}</p>` +
    unit.sections.map(s => `<a class="sheetlink" href="#/unit/${slug}/${s.id}">${esc(s.title)}</a>`).join("");
  sheetBtn.hidden = false;
  if (anchor) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "instant", block: "start" });
    dispatchEvent(new Event("scroll"));      // so the rail marks where we landed
  }
}

let unwireRail = null;

function wireRail(sections) {
  unwireRail?.();
  unwireRail = null;
  const links = new Map([...document.querySelectorAll("#rail a")].map(a => [a.dataset.sec, a]));
  const fill = $("#railfill");
  const heads = sections.map(s => document.getElementById(s.id)).filter(Boolean);
  if (!heads.length) return;

  const update = () => {
    let current = 0;
    heads.forEach((h, n) => { if (h.getBoundingClientRect().top < 140) current = n; });
    heads.forEach((h, n) => {
      const a = links.get(h.id);
      if (!a) return;
      a.classList.toggle("seen", n <= current);
      if (n === current) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    // scaleY rather than height: the spine is full height and only transformed,
    // which the compositor does without touching layout. Animating height here
    // dirtied layout every frame, and the next tick's rect reads then had to
    // force a synchronous re-layout to answer.
    fill.style.transform = `scaleY(${(current + 1) / heads.length})`;
  };
  update();
  addEventListener("scroll", update, { passive: true });
  unwireRail = () => removeEventListener("scroll", update);
}

async function viewWork(slug, n) {
  const m = await load("manifest");
  const meta = m.track.find(u => u.slug === slug);
  if (!meta || !meta.hasEx) return notFound();

  const exercises = await load(`ex-${slug}`);
  const i = Math.min(Math.max(1, Number(n) || 1), exercises.length);
  const ex = exercises[i - 1];

  main.innerHTML = `<div class="wrap" data-accent="${meta.accent}">
    <div class="wb">
      <section class="wb-brief">
        <p class="eyebrow"><a href="#/unit/${slug}" class="muted">Unit ${pad(meta.n)} · ${esc(meta.title)}</a></p>
        <div class="exnav">${exercises.map((_, k) => {
          const passed = store.get("passed", `${slug}:${k + 1}`);
          return `<a href="#/work/${slug}/${k + 1}" class="${passed ? "passed" : ""}" ${k + 1 === i ? 'aria-current="true"' : ""}>${k + 1}</a>`;
        }).join("")}</div>
        <h1>${esc(ex.title)}</h1>
        ${md(ex.prompt)}
        <div class="hintbox" id="hintbox"></div>
        <button class="btn ghost sm" id="hintbtn">Hint (${ex.hints.length})</button>
      </section>
      <section id="bench"></section>
    </div>
  </div>`;

  let shown = 0;
  $("#hintbtn").onclick = () => {
    if (shown >= ex.hints.length) return;
    $("#hintbox").insertAdjacentHTML("beforeend", `<div class="hint">${inline(ex.hints[shown])}</div>`);
    shown++;
    store.set("hinted", `${slug}:${i}`, shown);
    $("#hintbtn").textContent = shown >= ex.hints.length ? "No more hints" : `Hint (${ex.hints.length - shown} left)`;
    $("#hintbtn").disabled = shown >= ex.hints.length;
  };

  mountWorkbench($("#bench"), {
    exercise: ex,
    storageKey: `ph.code.${slug}.${i}`,
    onPass: () => {
      store.set("passed", `${slug}:${i}`, true);
      document.querySelectorAll(`.exnav a`)[i - 1]?.classList.add("passed");
    },
    next: i < exercises.length ? `#/work/${slug}/${i + 1}` : (meta.hasDrills ? `#/drills/${slug}` : null),
  });
}

async function viewDrills(slug) {
  const m = await load("manifest");
  const meta = m.track.find(u => u.slug === slug);
  if (!meta || !meta.hasDrills) return notFound();
  const drills = await load(`drills-${slug}`);

  let at = 0, right = 0;
  main.innerHTML = `<div class="wrap" data-accent="${meta.accent}"><div class="drill">
    <p class="eyebrow"><a href="#/unit/${slug}" class="muted">Unit ${pad(meta.n)} · ${esc(meta.title)}</a></p>
    <h1 style="font-size:var(--t-h3);margin:.3rem 0 0">Drills</h1>
    <div class="progressbar" style="margin:1rem 0 1.4rem"><i id="pb" style="width:0%"></i></div>
    <div id="quiz"></div>
  </div></div>`;

  const render = () => {
    if (at >= drills.length) {
      store.set("drills", slug, { right, total: drills.length });
      $("#pb").style.width = "100%";
      $("#quiz").innerHTML = `<h2>${right} / ${drills.length}</h2>
        <p class="lede muted">${right === drills.length ? "Every one. Move on." : right >= drills.length * 0.7 ? "Solid. Re-read the sections you missed." : "Worth another pass through the note."}</p>
        <div class="unit-foot"><a class="btn ghost" href="#/unit/${slug}">Back to the note</a>
        <a class="btn" href="#/track">The track</a></div>`;
      return;
    }
    const d = drills[at];
    $("#pb").style.width = `${(at / drills.length) * 100}%`;
    $("#quiz").innerHTML = `<p class="eyebrow">Drill ${at + 1} of ${drills.length}</p>
      <p class="drill-q">${inline(d.q)}</p>
      ${d.options.map((o, k) => `<button class="opt" data-k="${k}">${inline(o)}</button>`).join("")}
      <div id="why"></div>`;

    $("#quiz").querySelectorAll(".opt").forEach(b => {
      b.onclick = () => {
        const k = Number(b.dataset.k);
        const opts = [...$("#quiz").querySelectorAll(".opt")];
        opts.forEach(o => (o.disabled = true));
        opts[d.answer].classList.add("right");
        if (k !== d.answer) b.classList.add("wrong"); else right++;
        $("#why").innerHTML = `<div class="reading"><h4>Why</h4><p>${inline(d.why)}</p></div>
          <div style="margin-top:1rem"><button class="btn" id="nextq">${at + 1 < drills.length ? "Next" : "Finish"}</button></div>`;
        $("#nextq").onclick = () => { at++; render(); };
      };
    });
  };
  render();
}

async function viewProjects() {
  const m = await load("manifest");
  const tiers = ["mini", "core", "deep"];
  main.innerHTML = `<div class="wrap" style="padding:2rem 0 4rem">
    <p class="eyebrow">Projects</p>
    <h1 style="margin:0.4rem 0 0.6rem">One real program each</h1>
    <p class="lede muted" style="max-width:62ch">Built in stages that accumulate. Nothing is a toy and nothing
    imports the thing it is supposed to be teaching you to write.</p>
    ${tiers.map(t => {
      const ps = m.projects.filter(p => p.tier === t);
      if (!ps.length) return "";
      return `<div class="phase-head"><h3>${ps[0].tierLabel}</h3><p>${ps.length} projects · ${ps[0].stages} stages each</p></div>
        <div class="grid">${ps.map(projectCard).join("")}</div>`;
    }).join("")}
  </div>`;
  stagger([...main.querySelectorAll(".card")]);
}

async function viewProject(slug) {
  const m = await load("manifest");
  const p = m.projects.find(x => x.slug === slug);
  if (!p) return notFound();
  main.innerHTML = `<div class="wrap" data-accent="denim" style="padding:2rem 0 4rem;max-width:var(--measure)">
    <p class="eyebrow">${p.tierLabel} · ${p.domain} · ${p.stages} stages</p>
    <h1 style="margin:0.4rem 0 0.6rem">${esc(p.title)}</h1>
    <p class="lede">${inline(p.blurb)}</p>
    <p class="muted">This project is in the manifest. Its stages have not been written yet.</p>
    <a class="btn ghost" href="#/projects">All projects</a>
  </div>`;
}

async function viewProgress() {
  const m = await load("manifest");
  const p = store.all();
  const read = Object.keys(p.read || {}).length;
  const passed = Object.keys(p.passed || {}).length;
  const hinted = Object.keys(p.hinted || {}).length;
  const written = m.track.filter(u => u.hasEx);
  const totalEx = written.reduce((n, u) => n + u.hasEx, 0);

  main.innerHTML = `<div class="wrap" style="padding:2rem 0 4rem">
    <p class="eyebrow">Progress</p>
    <h1 style="margin:0.4rem 0 1.2rem">Kept in this browser only</h1>
    <div class="stats" style="border:0;padding:0 0 1.6rem">
      <div class="stat"><b>${read}/${m.track.length}</b><span>notes read</span></div>
      <div class="stat"><b>${passed}/${totalEx}</b><span>exercises passed</span></div>
      <div class="stat"><b>${hinted}</b><span>needed a hint</span></div>
      <div class="stat"><b>${Object.keys(p.drills || {}).length}</b><span>drill sets done</span></div>
      <div class="stat"><b>${(p.streak || {}).run || 0}</b><span>day streak, best ${(p.streak || {}).best || 0}</span></div>
    </div>
    <div class="grid">${(() => { const seen = store.read(); return m.track.filter(u => u.hasNote).map(u => unitCard(u, seen)).join(""); })()}</div>
    <div style="margin-top:2rem"><button class="btn ghost sm" id="reset">Erase all progress</button></div>
  </div>`;
  $("#reset").onclick = () => {
    if (confirm("Erase every note read, exercise passed and saved snippet?")) {
      // Progress and saved code only. The theme, vim mode, soft wrap and the
      // rail's state are preferences, and erasing those is not what the button
      // says it does. Nor is re-seeding a streak the reader just erased.
      Object.keys(localStorage)
        .filter(k => k === "ph.progress" || k.startsWith("ph.code."))
        .forEach(k => localStorage.removeItem(k));
      route();
    }
  };
}

function notFound() {
  main.innerHTML = `<div class="wrap" style="padding:5rem 0;text-align:center">
    <img src="assets/mascot-512.png" alt="" style="width:180px">
    <h1 style="margin:1rem 0">Nothing here</h1>
    <a class="btn" href="#/">Home</a></div>`;
}


/* ------------------------------------------------------------------ glossary */

async function viewGlossary(letter) {
  const gloss = await load("gloss");
  const letters = [...new Set(gloss.map(g => g.term[0].toUpperCase()))].sort();
  const shown = letter ? gloss.filter(g => g.term[0].toUpperCase() === letter.toUpperCase()) : gloss;

  main.innerHTML = `<div class="wrap" data-accent="teal" style="padding:2rem 0 4rem">
    <p class="eyebrow">Glossary</p>
    <h1 style="margin:0.4rem 0 0.6rem">${gloss.length} terms</h1>
    <p class="lede muted" style="max-width:58ch">Every word this book uses as though you already know it.</p>
    <div class="letters">
      <a href="#/glossary" class="${letter ? "" : "on"}">all</a>
      ${letters.map(L => `<a href="#/glossary/${L}" class="${letter && letter.toUpperCase() === L ? "on" : ""}">${L}</a>`).join("")}
    </div>
    <div class="grid">${shown.map(g => `
      <div class="card" data-accent="teal" id="term-${slugify(g.term)}">
        <h3>${esc(g.term)}</h3>
        <p>${inline(g.text)}</p>
        ${g.see.length ? `<div class="meta">${g.see.map(s => `<a class="tag" href="#/glossary#term-${s}">${esc(s.replace(/-/g, " "))}</a>`).join("")}</div>` : ""}
      </div>`).join("")}</div>
  </div>`;
  stagger([...main.querySelectorAll(".card")]);
}

/* ------------------------------------------------------------------ errors

   Derived at build time from every @diagnose in the book, so this page cannot
   fall out of step with the prose the workbench actually shows.              */

const JUDGE_LABEL = {
  runtime: ["CPython", "Exceptions the interpreter raises, and what each one is really telling you.", "clay"],
  ruff: ["ruff", "Lint codes. Mistakes with a shape a linter can see without running anything.", "gold"],
  mypy: ["mypy", "Type codes. Found before the program runs, and only on code you have annotated.", "denim"],
  reading: ["No complaint at all", "The cases where every judge is happy and the code is still wrong.", "plum"],
};

async function viewErrors() {
  const errors = await load("errors");
  const groups = Object.keys(JUDGE_LABEL);
  main.innerHTML = `<div class="wrap" data-accent="clay" style="padding:2rem 0 4rem">
    <p class="eyebrow">Errors</p>
    <h1 style="margin:0.4rem 0 0.6rem">Every complaint this book explains</h1>
    <p class="lede muted" style="max-width:62ch">${errors.length} of them so far, each written up where it is
    raised rather than in the abstract. This page is generated from those explanations, so it can never drift
    from what the workbench tells you.</p>
    ${groups.map(g => {
      const list = errors.filter(e => e.judge === g);
      if (!list.length) return "";
      const [label, blurb, accent] = JUDGE_LABEL[g];
      return `<div class="phase-head"><h3>${label}</h3><p>${blurb}</p></div>
        <div class="grid">${list.map(e => {
          const first = e.seen[0];
          return `<a class="card" data-accent="${accent}" href="#/work/${first.unit}/${first.n}">
            <span class="n">${esc(e.code)}</span>
            <h3>${esc(first.title)}</h3>
            <p>${inline(first.prose.slice(0, 180))}${first.prose.length > 180 ? "…" : ""}</p>
            <div class="meta"><span>${e.seen.length} exercise${e.seen.length > 1 ? "s" : ""}</span></div>
          </a>`;
        }).join("")}</div>`;
    }).join("")}
  </div>`;
  stagger([...main.querySelectorAll(".card")]);
}

/* ------------------------------------------------------------------ search */

function score(entry, terms) {
  // lowercase once per entry, not once per keystroke: the note bodies are
  // capped at 20k characters each and this runs on every debounced input
  entry._t ??= entry.title.toLowerCase();
  entry._b ??= (entry.body || "").toLowerCase();
  const title = entry._t;
  const body = entry._b;
  let s = 0;
  for (const q of terms) {
    if (title === q) s += 100;
    else if (title.includes(q)) s += 40;
    if (body.includes(q)) s += Math.min(12, (body.split(q).length - 1) * 4);
  }
  return terms.every(q => title.includes(q) || body.includes(q)) ? s : 0;
}

function excerpt(body, terms) {
  if (!body) return "";
  const low = body.toLowerCase();
  const at = Math.max(0, low.indexOf(terms[0]) - 70);
  const cut = body.slice(at, at + 220);
  return (at ? "…" : "") + cut + (at + 220 < body.length ? "…" : "");
}

function markup(text, terms) {
  let out = esc(text);
  for (const q of terms) {
    out = out.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");
  }
  return out;
}

async function viewSearch(raw) {
  const q = decodeURIComponent(raw || "").trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const index = await load("search");
  const hits = terms.length
    ? index.map(e => [score(e, terms), e]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 40)
    : [];

  const href = e => e.kind === "term" ? `#/glossary#term-${slugify(e.title)}`
    : e.kind === "exercise" ? `#/work/${e.unit}/${e.n}`
    : e.id ? `#/unit/${e.unit}/${e.id}` : `#/unit/${e.unit}`;

  main.innerHTML = `<div class="wrap" style="padding:2rem 0 4rem;max-width:var(--measure)">
    <h1 class="eyebrow" style="font:inherit">Search</h1>
    <input class="searchbox big" id="q" value="${esc(q)}" placeholder="Search notes, exercises and terms" autofocus>
    <p class="muted" style="margin:0.9rem 0 1.4rem">${terms.length ? `${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(q)}”` : "Type to search."}</p>
    ${hits.map(([, e]) => `<a class="hit" href="${href(e)}">
      <span class="tag">${e.kind}</span>
      <b>${markup(e.title, terms)}</b>
      ${e.body ? `<span>${markup(excerpt(e.body, terms), terms)}</span>` : ""}
    </a>`).join("")}
  </div>`;

  const box = $("#q");
  let timer;
  box.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { location.hash = `#/search/${encodeURIComponent(box.value)}`; }, 220);
  };
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

/* ------------------------------------------------------------------ companion

   The mascot appears rarely, says one line, and is never in the way.        */

const LINES = [
  "Draw the arrows. How many objects, how many names?",
  "If it runs and it is still wrong, that is the interesting kind of wrong.",
  "ruff is fast and shallow. CPython is slow and honest. Both are useful.",
  "A hint is cheaper than an hour. Two hints is still cheaper than an hour.",
  "Nothing here leaves your browser. Break whatever you like.",
];

function maybeCompanion() {
  document.querySelector(".companion")?.remove();
  if (Math.random() > 0.22) return;
  const el = document.createElement("div");
  el.className = "companion";
  el.innerHTML = `<img src="assets/mascot-128.png" alt="">
    <div class="say">${esc(LINES[Math.floor(Math.random() * LINES.length)])}</div>`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 11000);
}

/* ------------------------------------------------------------------ streak */

const todayKey = () => new Date().toISOString().slice(0, 10);
function touchStreak() {
  const p = store.all();
  const s = p.streak || { last: null, run: 0, best: 0 };
  const today = todayKey();
  if (s.last === today) return s;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.run = s.last === yesterday ? s.run + 1 : 1;
  s.last = today;
  s.best = Math.max(s.best || 0, s.run);
  p.streak = s;
  store.save(p);
  return s;
}

/* ------------------------------------------------------------------ router */

const routes = [
  [/^\/?$/,                        viewHome],
  [/^\/track$/,                    viewTrack],
  [/^\/unit\/([\w-]+)(?:\/([\w-]+))?$/, viewUnit],
  [/^\/work\/([\w-]+)\/(\d+)$/,    viewWork],
  [/^\/drills\/([\w-]+)$/,         viewDrills],
  [/^\/projects$/,                 viewProjects],
  [/^\/project\/([\w-]+)$/,        viewProject],
  [/^\/progress$/,                 viewProgress],
  [/^\/glossary(?:\/([A-Za-z]))?$/, viewGlossary],
  [/^\/errors$/,                   viewErrors],
  [/^\/search(?:\/(.*))?$/,        viewSearch],
];

async function route() {
  const path = location.hash.slice(1) || "/";
  if (sheetBtn) sheetBtn.hidden = !path.startsWith("/unit/");
  sheet?.classList.remove("open");
  if (!path.startsWith("/unit/")) { unwireRail?.(); unwireRail = null; renderedUnit = null; }
  // Before the view renders, not after: a view that jumps to a section would
  // otherwise have that jump undone the moment it finished. Skipped when we are
  // already on this unit, because then the view only scrolls to an anchor.
  if (!(renderedUnit && path.startsWith(`/unit/${renderedUnit}`))) scrollTo(0, 0);
  const hit = routes.find(([re]) => re.test(path));
  if (!hit) {
    notFound();
  } else {
    try { await hit[1](...path.match(hit[0]).slice(1)); }
    catch (err) {
      main.innerHTML = `<div class="wrap" style="padding:4rem 0"><h1>Could not load that</h1>
        <p class="muted mono">${esc(String(err.message))}</p>
        <p class="muted">If you are running this locally, make sure <code>python3 build.py</code> has been run.</p></div>`;
    }
  }
  document.querySelectorAll("#nav a, #tabbar a").forEach(a => {
    const href = a.getAttribute("href").slice(1);
    if (href === "/" ? path === "/" : path.startsWith(href)) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  maybeCompanion();
}

addEventListener("hashchange", route);

addEventListener("keydown", e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    location.hash = "#/search/";
  }
});

const navsearch = $("#navsearch");
if (navsearch) {
  navsearch.onkeydown = e => {
    if (e.key === "Enter") location.hash = `#/search/${encodeURIComponent(navsearch.value)}`;
    if (e.key === "Escape") navsearch.blur();
  };
}

$("#theme").onclick = () => {
  const now = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = now;
  try { localStorage.setItem("ph.theme", now); } catch {}
};

touchStreak();

// The footer states which judges the book was verified against. Rendered from
// data/judges.json so it cannot claim a version nothing pins.
judges().then(j => {
  const el = $("#footversions");
  if (!el) return;
  el.innerHTML = `Built and verified against CPython ${esc(j.cpython.version)} and `
    + `ruff ${esc(j.ruff.version)}, with mypy installed from PyPI at run time.<br>` + el.innerHTML;
}).catch(() => {});

route();
