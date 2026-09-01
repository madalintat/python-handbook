/* Focus mode against every real stage, not a made-up one. Run: node test_focus.mjs

   The model here is the only copy of the code focus mode takes out of the
   textarea, so the whole file asks one question 108 times: can anything the
   reader typed be lost. A synthetic fixture cannot answer that, because the
   shapes that break a split are the ones real content happens to have. */
import { readFileSync, readdirSync } from "node:fs";
import { cutStarter, derive, toFocus, fromFocus, groupRuns, FOLD }
  from "./assets/workbench.js";

/* groupRuns comes from the editor rather than being written again here. A
   second copy would let the editor's threshold change while this file went on
   proving the old one, which is the failure the whole file exists to prevent. */

let stages = 0, bad = 0, shown = 0, whole = 0, nothingToFold = 0;
const fail = (why) => { bad++; console.log("  " + why); };

for (const file of readdirSync("data").filter(n => n.startsWith("project-"))) {
  const proj = JSON.parse(readFileSync(`data/${file}`, "utf8"));
  for (const stage of proj.stages) {
    stages++;
    const where = `${proj.slug} stage ${stage.n}`;
    /* The fold marker is the boundary every one of these functions reads, so
       its uniqueness is load bearing: a starter that already contained a line
       matching it would be misread as a fold, and the reader's own code would
       be treated as a seam. Nothing else checks this. */
    for (const line of stage.starter.split("\n")) {
      if (FOLD.test(line)) fail(`${where}: a line already looks like a fold marker`);
    }

    const parts = cutStarter(stage.starter, groupRuns(stage.work));
    if (!parts.length) { nothingToFold++; continue; }   // stage one is all new

    const segs = derive(stage.starter, parts);
    if (!segs) { fail(`${where}: the carried regions were not found`); continue; }
    if (fromFocus(toFocus(segs), segs) !== stage.starter) {
      fail(`${where}: does not round trip`);
      continue;
    }

    /* The one that matters, and the one a round trip cannot make. Round
       tripping is trivially true for ANY partition derive happens to return,
       including a wrong one: it hides some lines and puts them back. What has
       to hold is that the lines the build called the reader's work are the
       lines focus mode shows. Fold one of those away and the reader writes
       their answer underneath an invisible `raise NotImplementedError` that
       gets faithfully restored above it, and nothing tells them why. */
    const visible = new Set();
    let row = 1;
    for (const seg of segs) {
      for (const _ of seg.lines) { if (!seg.carried) visible.add(row); row++; }
    }
    const hidden = stage.work.filter(n => !visible.has(n));
    if (hidden.length) fail(`${where}: focus mode hides work lines ${hidden}`);

    // and no carried region may be ambiguous, or it can match the wrong place
    for (const part of parts) {
      const text = part.join("\n");
      let count = 0, from = 0;
      while ((from = stage.starter.indexOf(text, from)) >= 0) { count++; from++; }
      if (count > 1) fail(`${where}: a carried region appears ${count} times`);
    }

    const focus = toFocus(segs);
    const marker = "# EDITED_BY_THE_TEST";
    if (!fromFocus(focus.replace(/\n/, `\n${marker}\n`), segs).includes(marker)) {
      fail(`${where}: an edit made in focus mode was lost`);
    }

    // A reader who deletes every fold marker has merged all the regions. That
    // is allowed to put text in the wrong place. It is not allowed to drop any.
    const flattened = focus.split("\n").filter(l => !/you already built/.test(l)).join("\n");
    const recovered = fromFocus(flattened, segs);
    for (const seg of segs) {
      if (seg.carried) continue;
      const missing = seg.lines.find(l => l.trim() && !recovered.includes(l));
      if (missing) { fail(`${where}: lost ${JSON.stringify(missing)}`); break; }
    }

    shown += focus.split("\n").length;
    whole += stage.starter.split("\n").length;
  }
}

/* The numbers quoted in comments and prose, checked rather than remembered.
   These are illustrative rather than functional, which is exactly why nothing
   would notice them going stale: they already did once, inside a single
   session, when a change to how the work is worked out moved "19 lines shown"
   to 20 in three files at once. */
{
  const proj = JSON.parse(readFileSync("data/project-build-a-gpt.json", "utf8"));
  const last = proj.stages[proj.stages.length - 1];
  const total = last.starter.split("\n").length;
  const segs = derive(last.starter, cutStarter(last.starter, groupRuns(last.work)));
  const rows = toFocus(segs).split("\n").length;
  const quoted = { lines: 994, work: 13, shown: 20 };
  const found = { lines: total, work: last.work.length, shown: rows };
  for (const key of Object.keys(quoted)) {
    if (quoted[key] !== found[key]) {
      fail(`the GPT's last stage now has ${found[key]} ${key}, not ${quoted[key]}. `
         + `Update the numbers in assets/workbench.js, assets/app.css, llms.txt, `
         + `README.md and this file.`);
    }
  }
}

console.log(`focus mode: ${stages} real stages, ${bad} problems `
          + `(${nothingToFold} with nothing to fold)`);
console.log(`            ${shown} lines shown where the files hold ${whole}`);
process.exit(bad ? 1 : 0);
