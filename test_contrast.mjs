/* Every text colour against every ground it sits on, in both themes, at the
   WCAG AA ratio for text this size. Run: node test_contrast.mjs

   The pairs are the ones app.css actually draws: the four inks on the four
   grounds, the accents as text on the page and as button grounds under the
   button ink, the verdict inks on the verdict tints. Reading the numbers from
   the stylesheet rather than repeating them here is the whole point: retune a
   colour and this either still passes or says which pair stopped. */
import { readFileSync } from "node:fs";

const css = readFileSync("assets/app.css", "utf8");
const block = re => {
  const m = re.exec(css);
  if (!m) throw new Error(`no ${re} block in app.css`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(v => [v[1], v[2]]));
};
const light = block(/^:root \{([\s\S]*?)^\}/m);
const dark = { ...light, ...block(/^:root\[data-theme="dark"\] \{([\s\S]*?)^\}/m) };

const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const AA = 4.5;
const GROUNDS = ["bg", "surface", "code-bg"];
const ACCENTS = ["gold", "denim", "ember", "moss", "teal", "plum", "clay"];
const VERDICT = ["ok", "warn", "bad"];

// [text, ground, minimum, why]
const PAIRS = [];
for (const ink of ["ink", "ink-2", "ink-3", "ink-4"]) for (const g of GROUNDS) PAIRS.push([ink, g, AA, "body text"]);
for (const ink of ["ink", "ink-2", "ink-3"]) PAIRS.push([ink, "raised", AA, "text on a hovered row or a tag"]);
for (const a of [...ACCENTS, ...VERDICT]) for (const g of GROUNDS) PAIRS.push([a, g, AA, "an accent used as text"]);
for (const a of [...ACCENTS, ...VERDICT]) PAIRS.push(["btn-ink", a, AA, "the label on a filled button"]);
for (const a of [...ACCENTS, ...VERDICT]) PAIRS.push(["code-bg", a, AA, "the vim badge"]);
for (const v of VERDICT) PAIRS.push(["ink-2", `${v}-bg`, AA, "a verdict row"]);
for (const v of VERDICT) PAIRS.push(["ink", `${v}-bg`, AA, "a drill answer"]);

let bad = 0, checks = 0;
for (const [name, theme] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min, why] of PAIRS) {
    checks++;
    if (!theme[fg] || !theme[bg]) throw new Error(`${name}: no --${fg} or --${bg} in app.css`);
    const r = ratio(theme[fg], theme[bg]);
    if (r < min) { bad++; console.log(`  ${name}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs ${min} (${why})`); }
  }
}
console.log(`contrast: ${checks} pairs, ${bad} below AA`);
process.exit(bad ? 1 : 0);
