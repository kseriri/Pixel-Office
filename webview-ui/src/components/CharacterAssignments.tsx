import { type CSSProperties, useEffect, useRef, useState } from 'react';

import {
  getAssignmentByKey,
  MODEL_OPTIONS,
  setAssignment,
} from '../characterAssignments.js';
import { PICKER_BACKDROP_COLOR } from '../constants.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import { getCharacterSprites, getLoadedCharacterCount } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';

/** Preview of a character (front idle frame). `h` = pixel height (width is h/2). */
function CharSwatch({ palette, h = 48 }: { palette: number; h?: number }) {
  const w = Math.round(h / 2);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const sd = getCharacterSprites(palette, 0).walk[Direction.DOWN]?.[0];
    if (!sd) return;
    const cached = getCachedSprite(sd, 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cached, 0, 0, cached.width, cached.height, 0, 0, cv.width, cv.height);
  }, [palette, h, w]);
  return (
    <canvas ref={ref} width={w} height={h} style={{ width: w, height: h, imageRendering: 'pixelated' }} />
  );
}

/** Assign a character per (project × model): pick a project, see its per-model
 *  characters, and click one to choose from a popup of all characters. */
export function CharacterAssignments({ liveProjects }: { liveProjects: string[] }) {
  const [selected, setSelected] = useState<string>('');
  const [pickerModelKey, setPickerModelKey] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const count = getLoadedCharacterCount();
  // Only currently-running projects (agents present in the office), not every
  // project ever opened.
  const allProjects = Array.from(new Set(liveProjects)).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!selected && allProjects.length > 0) setSelected(allProjects[0]);
  }, [allProjects, selected]);

  const assign = (modelKey: string, palette: number | null) => {
    setAssignment(selected, modelKey, palette);
    setPickerModelKey(null);
    setTick((t) => t + 1);
  };

  if (count === 0) {
    return <div style={{ padding: 8, opacity: 0.7 }}>Loading characters…</div>;
  }
  if (allProjects.length === 0) {
    return (
      <div style={{ padding: 8, opacity: 0.7, fontSize: 12 }}>
        No active projects. Start an agent (currently-running projects appear here) and reopen.
      </div>
    );
  }

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '4px 6px',
  };
  const slotStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 40,
    height: 52,
    padding: '2px 6px',
    border: '2px solid var(--pixel-border)',
    background: 'var(--pixel-bg)',
    cursor: 'pointer',
  };

  const pickerLabel = MODEL_OPTIONS.find((m) => m.key === pickerModelKey)?.label ?? '';

  return (
    <div style={{ padding: '2px 4px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 8px' }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Project</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            flex: 1,
            padding: '4px 6px',
            background: 'var(--pixel-bg)',
            color: 'inherit',
            border: '2px solid var(--pixel-border)',
            fontSize: 13,
          }}
        >
          {allProjects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div style={{ maxHeight: 210, overflow: 'auto' }}>
        {MODEL_OPTIONS.map((m) => {
          const p = getAssignmentByKey(selected, m.key);
          return (
            <div key={m.key} style={rowStyle}>
              <span style={{ fontSize: 13 }}>{m.label}</span>
              <div
                style={slotStyle}
                title={
                  p === undefined ? 'auto (click to choose)' : `char ${p + 1} (click to change)`
                }
                onClick={() => setPickerModelKey(m.key)}
              >
                {p === undefined ? (
                  <span style={{ fontSize: 11, opacity: 0.55 }}>auto</span>
                ) : (
                  <CharSwatch palette={p} h={44} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pickerModelKey !== null && (
        <div
          onClick={() => setPickerModelKey(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: PICKER_BACKDROP_COLOR,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              boxShadow: 'var(--pixel-shadow)',
              padding: 14,
              maxWidth: '90vw',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              {selected} · {pickerLabel} — choose a character
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                onClick={() => assign(pickerModelKey, null)}
                style={{
                  width: 44,
                  height: 76,
                  border: '2px solid var(--pixel-border)',
                  background: 'var(--pixel-bg)',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
                title="Auto (diverse palette)"
              >
                auto
              </button>
              {Array.from({ length: count }, (_, i) => {
                const isCurrent = getAssignmentByKey(selected, pickerModelKey) === i;
                return (
                  <button
                    key={i}
                    onClick={() => assign(pickerModelKey, i)}
                    title={`char ${i + 1}`}
                    style={{
                      width: 44,
                      height: 76,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: isCurrent
                        ? '2px solid var(--pixel-accent)'
                        : '2px solid var(--pixel-border)',
                      background: 'var(--pixel-bg)',
                      cursor: 'pointer',
                    }}
                  >
                    <CharSwatch palette={i} h={64} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
