/**
 * Per-(project × model) character assignments.
 *
 * Lets the user pin a specific character sprite (palette index) to a given
 * project folder + model, so the same kind of agent always shows up as the same
 * character. Stored client-side in localStorage (standalone-friendly; no server
 * round-trip). The palette index refers to the loaded character sprites (0-based).
 */

const STORAGE_KEY = 'pixelOffice.charAssignments';
const SEP = '\u0000';

/** Models the UI offers a per-project assignment for. `key` must match what
 *  `modelKeyFor()` returns so lookups line up at spawn time. */
export const MODEL_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'opus', label: 'Opus' },
  { key: 'sonnet', label: 'Sonnet' },
  { key: 'haiku', label: 'Haiku' },
  { key: 'fable', label: 'Fable' },
  { key: 'gpt', label: 'GPT' },
  { key: 'codex', label: 'Codex' },
];

/** Normalize a raw model id to a stable key (mirrors renderer's modelBadgeInfo). */
export function modelKeyFor(model: string | undefined): string {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.includes('fable')) return 'fable';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('codex')) return 'codex';
  if (m.includes('gpt') || /\bo[1-9]\b/.test(m)) return 'gpt';
  return 'other';
}

function keyOf(folder: string, modelKey: string): string {
  return `${folder}${SEP}${modelKey}`;
}

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, number>;
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function save(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable (private mode etc.) — assignments just won't persist
  }
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();

/** Subscribe to assignment changes; returns an unsubscribe fn. */
export function onAssignmentsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Palette index assigned to (folder, model), or undefined if unset. */
export function getAssignment(folder: string | undefined, model: string | undefined): number | undefined {
  if (!folder) return undefined;
  const mk = modelKeyFor(model);
  if (mk === 'unknown') return undefined;
  const map = load();
  const v = map[keyOf(folder, mk)];
  return typeof v === 'number' ? v : undefined;
}

/** Assign (or clear, when palette is null) a character for (folder, modelKey). */
export function setAssignment(folder: string, modelKey: string, palette: number | null): void {
  const map = load();
  const k = keyOf(folder, modelKey);
  if (palette === null) delete map[k];
  else map[k] = palette;
  save(map);
}

/** Palette index assigned to (folder, modelKey), or undefined. Like getAssignment
 *  but takes the already-normalized model key (for the settings UI grid). */
export function getAssignmentByKey(folder: string, modelKey: string): number | undefined {
  if (!folder) return undefined;
  const v = load()[keyOf(folder, modelKey)];
  return typeof v === 'number' ? v : undefined;
}

/** All assignments as { folder, modelKey, palette }[] (for the settings UI). */
export function getAllAssignments(): Array<{ folder: string; modelKey: string; palette: number }> {
  const map = load();
  const out: Array<{ folder: string; modelKey: string; palette: number }> = [];
  for (const [k, palette] of Object.entries(map)) {
    const [folder, modelKey] = k.split(SEP);
    if (folder && modelKey) out.push({ folder, modelKey, palette });
  }
  return out;
}
