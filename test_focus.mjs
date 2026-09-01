/* Focus mode against every real stage, not a made-up one. Run: node test_focus.mjs

   The model here is the only copy of the code focus mode takes out of the
   textarea, so the whole file asks one question 108 times: can anything the
   reader typed be lost. A synthetic fixture cannot answer that, because the
   shapes that break a split are the ones real content happens to have. */
import { readFileSync, readdirSync } from "node:fs";
import { cutStarter, derive, toFocus, fromFocus } from "./assets/workbench.js";

/* The same grouping the editor uses: lines within three of each other are one
   region, because a blank line between two stubs is not a reason to stop. */
const runsOf = (work) => {
  const runs = [];
  for (const line of [...work].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && line - last[1] <= 3) last[1] = line;
    else runs.push([line, line]);
  }
  return runs;
};

let stages = 0, bad = 0, shown = 0, whole = 0, nothingToFold = 0;
const fail = (why) => { bad++; console.log("  " + why); };

for (const file of readdirSync("data").filter(n => n.startsWith("project-"))) {
  const proj = JSON.parse(readFileSync(`data/${file}`, "utf8"));
  for (const stage of proj.stages) {
    stages++;
    const where = `${proj.slug} stage ${stage.n}`;
    const parts = cutStarter(stage.starter, runsOf(stage.work));
    if (!parts.length) { nothingToFold++; continue; }   // stage one is all new

    const segs = derive(stage.starter, parts);
    if (!segs) { fail(`${where}: the carried regions were not found`); continue; }
    if (fromFocus(toFocus(segs), segs) !== stage.starter) {
      fail(`${where}: does not round trip`);
      continue;
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

console.log(`focus mode: ${stages} real stages, ${bad} problems `
          + `(${nothingToFold} with nothing to fold)`);
console.log(`            ${shown} lines shown where the files hold ${whole}`);
process.exit(bad ? 1 : 0);
