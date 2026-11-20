// Refreshes src/data/games/cyberpunk/sets.json with every set in the "Set"
// dropdown of the official card database (cyberpunktcg.com/cards), after
// backing up the current file. Run with `npm run update:cyberpunk-sets`.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PRINT_PLACEHOLDER, buildSet } from "./cyberpunkSets.mjs";

/** The API cyberpunktcg.com/cards loads its set dropdown and cards from. */
const API_URL = "https://api.netdeck.gg/api/cards/cyberpunk";
/** The largest page the API returns; it caps bigger `limit`s to this. */
const PAGE_SIZE = 100;
const DATA_DIR = new URL("../src/data/games/cyberpunk/", import.meta.url);
const SETS_FILE = new URL("sets.json", DATA_DIR);

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** The site's set dropdown, in its order: [{code, name}]. */
async function fetchSetOptions() {
  const url = `${API_URL}/filters`;
  const body = await fetchJson(url);
  const setFilter = Array.isArray(body?.filters) ? body.filters.find((filter) => filter?.key === "set") : undefined;
  if (!Array.isArray(setFilter?.options) || setFilter.options.length === 0) {
    throw new Error(`GET ${url}: no "set" filter with options.`);
  }
  return setFilter.options.map((option) => {
    if (typeof option?.code !== "string" || option.code === "" || typeof option.name !== "string" || option.name === "") {
      throw new Error(`GET ${url}: unexpected set option ${JSON.stringify(option)}.`);
    }
    return { code: option.code, name: option.name };
  });
}

/** The collector number, as the site spells it, of every printing in set
 * `code`. A card lists its printings in every set, so the others are left out. */
async function fetchCollectorNumbers(code) {
  const numbers = [];
  let offset = 0;
  while (true) {
    const url = `${API_URL}?${new URLSearchParams({ set: code, limit: String(PAGE_SIZE), offset: String(offset) })}`;
    const page = await fetchJson(url);
    if (!Array.isArray(page?.items) || typeof page.total !== "number") {
      throw new Error(`GET ${url}: expected {items, total}.`);
    }
    for (const card of page.items) {
      if (!Array.isArray(card?.printings)) {
        throw new Error(`GET ${url}: card ${JSON.stringify(card?.slug)} has no printings list.`);
      }
      for (const printing of card.printings) {
        if (typeof printing?.set?.code !== "string" || typeof printing.collector_number !== "string") {
          throw new Error(`GET ${url}: card ${JSON.stringify(card.slug)} has a printing without set code or collector number.`);
        }
        if (printing.set.code === code) {
          numbers.push(printing.collector_number);
        }
      }
    }
    offset += page.items.length;
    if (offset >= page.total) {
      return numbers;
    }
    if (page.items.length === 0) {
      throw new Error(`GET ${url}: empty page before all ${page.total} cards were listed.`);
    }
  }
}

/** One line per difference between the local sets and the site's `sets`. */
function describeChanges(localSets, sets) {
  const lines = [];
  for (const set of sets) {
    const local = localSets.find((candidate) => candidate.code === set.code);
    if (local === undefined) {
      lines.push(`+ ${set.code} "${set.name}": new set, ${set.collector_numbers.length} cards`);
      continue;
    }
    const added = set.collector_numbers.filter((number) => !local.collector_numbers.includes(number));
    const removed = local.collector_numbers.filter((number) => !set.collector_numbers.includes(number));
    if (added.length > 0) {
      lines.push(`~ ${set.code}: added ${added.join(", ")}`);
    }
    if (removed.length > 0) {
      lines.push(`~ ${set.code}: removed ${removed.join(", ")}`);
    }
    if (local.name !== set.name) {
      lines.push(`~ ${set.code}: renamed "${local.name}" to "${set.name}"`);
    }
  }
  for (const local of localSets) {
    if (!sets.some((set) => set.code === local.code)) {
      lines.push(`- ${local.code} "${local.name}": no longer on the site, dropped`);
    }
  }
  return lines;
}

/** `date` as local YYYYMMDD-HHMMSS, for the backup's file name. */
function backupTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

const currentText = await readFile(SETS_FILE, "utf8");
const localSets = JSON.parse(currentText);
const sets = [];
for (const option of await fetchSetOptions()) {
  const localSet = localSets.find((set) => set.code === option.code);
  sets.push(buildSet(option, await fetchCollectorNumbers(option.code), localSet));
}

for (const line of describeChanges(localSets, sets)) {
  console.log(line);
}
const unprinted = sets.filter((set) => set.print === PRINT_PLACEHOLDER).map((set) => set.code);
if (unprinted.length > 0) {
  console.warn(`The site doesn't publish printed set codes: fill in "print" by hand for ${unprinted.join(", ")}.`);
}

const newText = `${JSON.stringify(sets, null, 2)}\n`;
if (newText === currentText) {
  console.log("sets.json is already up to date.");
} else {
  const backupFile = new URL(`sets.${backupTimestamp(new Date())}.json.bak`, DATA_DIR);
  await copyFile(SETS_FILE, backupFile);
  await writeFile(SETS_FILE, newText);
  console.log(`Updated ${fileURLToPath(SETS_FILE)}; previous version kept as ${fileURLToPath(backupFile)}.`);
}
