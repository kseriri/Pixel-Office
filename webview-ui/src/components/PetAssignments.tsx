import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { PICKER_BACKDROP_COLOR } from '../constants.js';
import { getPetCount, getPetName, getPetSprites } from '../office/sprites/petSpriteData.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';

/** Preview of a pet (front idle frame). Pet frames vary in width, so we keep
 *  aspect ratio and center within the box. */
function PetSwatch({ petType, h = 40 }: { petType: number; h?: number }) {
  const boxW = 48;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const sd = getPetSprites(petType)?.idleDown?.[0];
    if (!sd) return;
    const cached = getCachedSprite(sd, 2);
    ctx.imageSmoothingEnabled = false;
    const w = Math.round((h * cached.width) / cached.height);
    ctx.drawImage(cached, 0, 0, cached.width, cached.height, Math.round((boxW - w) / 2), 0, w, h);
  }, [petType, h]);
  return (
    <canvas
      ref={ref}
      width={boxW}
      height={h}
      style={{ width: boxW, height: h, imageRendering: 'pixelated' }}
    />
  );
}

/** Choose which pet occupies each pet slot in the office. Persisted via the
 *  layout (onSetPetType → saveLayout). */
export function PetAssignments({
  pets,
  onSetPetType,
}: {
  pets: Array<{ id: string; petType: number }>;
  onSetPetType: (id: string, petType: number) => void;
}) {
  const [pickerId, setPickerId] = useState<string | null>(null);
  const count = getPetCount();

  if (count === 0) return <div style={{ padding: 8, opacity: 0.7 }}>Loading pets…</div>;
  if (pets.length === 0)
    return <div style={{ padding: 8, opacity: 0.7, fontSize: 12 }}>No pets in this office.</div>;

  const slotStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 52,
    height: 48,
    padding: '2px 4px',
    border: '2px solid var(--pixel-border)',
    background: 'var(--pixel-bg)',
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: '2px 4px 8px' }}>
      {pets.map((pet, i) => (
        <div
          key={pet.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '4px 6px',
          }}
        >
          <span style={{ fontSize: 13 }}>
            Pet {i + 1} · {getPetName(pet.petType)}
          </span>
          <div
            style={slotStyle}
            title="click to change pet"
            onClick={() => setPickerId(pet.id)}
          >
            <PetSwatch petType={pet.petType} />
          </div>
        </div>
      ))}

      {pickerId !== null && (
        <div
          onClick={() => setPickerId(null)}
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
            <div style={{ fontSize: 13, marginBottom: 10 }}>Choose a pet</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Array.from({ length: count }, (_, t) => {
                const current = pets.find((p) => p.id === pickerId)?.petType === t;
                return (
                  <button
                    key={t}
                    onClick={() => {
                      onSetPetType(pickerId, t);
                      setPickerId(null);
                    }}
                    title={getPetName(t)}
                    style={{
                      width: 60,
                      height: 76,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      border: current
                        ? '2px solid var(--pixel-accent)'
                        : '2px solid var(--pixel-border)',
                      background: 'var(--pixel-bg)',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    <PetSwatch petType={t} h={44} />
                    <span style={{ fontSize: 9, opacity: 0.75 }}>{getPetName(t)}</span>
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
