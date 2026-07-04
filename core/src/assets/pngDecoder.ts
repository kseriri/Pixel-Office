/**
 * Pure PNG decoding utilities — shared between the extension host, Vite build
 * scripts, and future standalone backend.
 *
 * No VS Code dependency. Only uses pngjs and shared constants.
 */

import { PNG } from 'pngjs';

import { rgbaToHex } from './colorUtils.js';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  PET_FRAME_H,
  PET_FRAME_W_LARGE,
  PET_FRAME_W_SMALL,
  PET_IDLE_FRAMES_VERT,
  PET_IMAGE_HEIGHT,
  PET_IMAGE_WIDTH,
  PET_WALK_FRAMES_HORIZ,
  PET_WALK_FRAMES_VERT,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from './constants.js';
import type { CharacterDirectionSprites, PetSpriteFrames } from './types.js';

// ── Sprite decoding ──────────────────────────────────────────

/**
 * Strip trailing bytes after the PNG IEND chunk.
 *
 * Aseprite-generated PNGs sometimes include trailing null bytes after IEND,
 * which causes `pngjs` to throw. The IEND chunk layout is:
 *   4 bytes length (0x00000000) + 4 bytes type ('IEND') + 4 bytes CRC = 12 bytes
 * Some encoders emit ≤4 bytes of trailing garbage, so we scan from `buf.length - 8`
 * (not `-12`) to find the IEND type marker.
 */
function sanitizePngBuffer(buf: Buffer): Buffer {
  // IEND type bytes: 0x49 0x45 0x4E 0x44 ('I' 'E' 'N' 'D')
  for (let i = buf.length - 8; i >= 8; i--) {
    if (buf[i] === 0x49 && buf[i + 1] === 0x45 && buf[i + 2] === 0x4e && buf[i + 3] === 0x44) {
      const endPos = i + 4 + 4; // past type bytes + 4-byte CRC
      if (buf.length > endPos) {
        return buf.subarray(0, endPos);
      }
      break;
    }
  }
  return buf;
}

/**
 * Convert a PNG buffer to SpriteData (2D array of hex color strings).
 * '' = transparent, '#RRGGBB' = opaque, '#RRGGBBAA' = semi-transparent.
 */
export function pngToSpriteData(pngBuffer: Buffer, width: number, height: number): string[][] {
  try {
    const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));

    if (png.width !== width || png.height !== height) {
      console.warn(
        `PNG dimensions mismatch: expected ${width}×${height}, got ${png.width}×${png.height}`,
      );
    }

    const sprite: string[][] = [];
    const data = png.data;

    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * png.width + x) * 4;
        const r = data[pixelIndex];
        const g = data[pixelIndex + 1];
        const b = data[pixelIndex + 2];
        const a = data[pixelIndex + 3];
        row.push(rgbaToHex(r, g, b, a));
      }
      sprite.push(row);
    }

    return sprite;
  } catch (err) {
    console.warn(`Failed to parse PNG: ${err instanceof Error ? err.message : err}`);
    const sprite: string[][] = [];
    for (let y = 0; y < height; y++) {
      sprite.push(new Array(width).fill(''));
    }
    return sprite;
  }
}

/**
 * Parse a single wall PNG (64×128, 4×4 grid of 16×32 pieces) into 16 bitmask sprites.
 * Piece at bitmask M: col = M % 4, row = floor(M / 4).
 */
export function parseWallPng(pngBuffer: Buffer): string[][][] {
  const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));
  const sprites: string[][][] = [];
  for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
    const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
    const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
    const sprite: string[][] = [];
    for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
      const row: string[] = [];
      for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
        const idx = ((oy + r) * png.width + (ox + c)) * 4;
        const rv = png.data[idx];
        const gv = png.data[idx + 1];
        const bv = png.data[idx + 2];
        const av = png.data[idx + 3];
        row.push(rgbaToHex(rv, gv, bv, av));
      }
      sprite.push(row);
    }
    sprites.push(sprite);
  }
  return sprites;
}

/**
 * Decode a single character PNG (112×96) into direction-keyed frame arrays.
 * Each PNG has 3 direction rows (down, up, right) × 7 frames (16×32 each).
 */
export function decodeCharacterPng(pngBuffer: Buffer): CharacterDirectionSprites {
  const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));
  const charData: CharacterDirectionSprites = { down: [], up: [], right: [] };

  const expectedW = CHAR_FRAMES_PER_ROW * CHAR_FRAME_W;
  const expectedH = CHARACTER_DIRECTIONS.length * CHAR_FRAME_H;
  if (png.width !== expectedW || png.height !== expectedH) {
    // Guard the dimension contract (siblings pngToSpriteData/decodePetPng do too).
    // A mis-sized char_N.png otherwise reads out-of-bounds pixels; return blank
    // frames for just this sprite so one bad file can't corrupt the whole set.
    console.warn(
      `[PngDecoder] Character sprite has unexpected dimensions: ${png.width}×${png.height} (expected ${expectedW}×${expectedH})`,
    );
    const blank = (): string[][] =>
      Array.from({ length: CHAR_FRAME_H }, () => new Array(CHAR_FRAME_W).fill(''));
    const frames = Array.from({ length: CHAR_FRAMES_PER_ROW }, blank);
    return { down: [...frames], up: [...frames], right: [...frames] };
  }

  for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
    const dir = CHARACTER_DIRECTIONS[dirIdx];
    const rowOffsetY = dirIdx * CHAR_FRAME_H;
    const frames: string[][][] = [];

    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      const sprite: string[][] = [];
      const frameOffsetX = f * CHAR_FRAME_W;
      for (let y = 0; y < CHAR_FRAME_H; y++) {
        const row: string[] = [];
        for (let x = 0; x < CHAR_FRAME_W; x++) {
          const idx = ((rowOffsetY + y) * png.width + (frameOffsetX + x)) * 4;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          const a = png.data[idx + 3];
          row.push(rgbaToHex(r, g, b, a));
        }
        sprite.push(row);
      }
      frames.push(sprite);
    }
    charData[dir] = frames;
  }

  return charData;
}

/**
 * Decode a single floor tile PNG (16×16 grayscale pattern).
 */
export function decodeFloorPng(pngBuffer: Buffer): string[][] {
  return pngToSpriteData(pngBuffer, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
}

/**
 * Decode a single pet PNG (96×96) into direction- and state-keyed frame arrays.
 *
 * Layout (52be7e8 spec):
 *   Row 0 (y=0..32):   6 frames × 16w — walkDown[0..2] then idleDown[0..2]
 *   Row 1 (y=32..64):  6 frames × 16w — walkUp[0..2]   then idleUp[0..2]
 *   Row 2 (y=64..96):  3 frames × 32w — walkRight[0..2]
 *
 * walkLeft / idleLeft are derived at render time by horizontal flip (webview).
 *
 * Safe-fallback: returns all-empty frames on any decode error so a broken
 * spritesheet doesn't abort the pet asset broadcast.
 */
export function decodePetPng(pngBuffer: Buffer): PetSpriteFrames {
  try {
    const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));

    function extractFrame(ox: number, oy: number, w: number, h: number): string[][] {
      const sprite: string[][] = [];
      for (let y = 0; y < h; y++) {
        const row: string[] = [];
        for (let x = 0; x < w; x++) {
          const idx = ((oy + y) * png.width + (ox + x)) * 4;
          row.push(
            rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]),
          );
        }
        sprite.push(row);
      }
      return sprite;
    }

    // Uniform layout (128×96): a 4×3 grid of 32×32 frames — row0 front (down),
    // row1 back (up), row2 side (right). Used for humanoid pets that don't fit
    // the cat layout's narrow 16px-wide front/back cells (which look squished).
    if (png.width === 128 && png.height === 96) {
      const S = 32;
      const cell = (r: number, c: number): string[][] => extractFrame(c * S, r * S, S, S);
      return {
        walkDown: [cell(0, 0), cell(0, 1), cell(0, 2)],
        idleDown: [cell(0, 0), cell(0, 0), cell(0, 0)],
        walkUp: [cell(1, 0), cell(1, 1), cell(1, 2)],
        idleUp: [cell(1, 0), cell(1, 0), cell(1, 0)],
        walkRight: [cell(2, 0), cell(2, 1), cell(2, 2)],
      };
    }

    if (png.width !== PET_IMAGE_WIDTH || png.height !== PET_IMAGE_HEIGHT) {
      console.warn(
        `[PngDecoder] Pet sprite has unexpected dimensions: ${png.width}×${png.height} (expected ${PET_IMAGE_WIDTH}×${PET_IMAGE_HEIGHT} or 128×96)`,
      );
      throw new Error('Invalid pet sprite dimensions');
    }

    // Row 0 (y=0): 6 frames @ 16w — walkDown[0..2] + idleDown[0..2]
    const walkDown: string[][][] = [];
    for (let f = 0; f < PET_WALK_FRAMES_VERT; f++) {
      walkDown.push(extractFrame(f * PET_FRAME_W_SMALL, 0, PET_FRAME_W_SMALL, PET_FRAME_H));
    }
    const idleDown: string[][][] = [];
    for (let f = 0; f < PET_IDLE_FRAMES_VERT; f++) {
      idleDown.push(
        extractFrame(
          (PET_WALK_FRAMES_VERT + f) * PET_FRAME_W_SMALL,
          0,
          PET_FRAME_W_SMALL,
          PET_FRAME_H,
        ),
      );
    }

    // Row 1 (y=32): 6 frames @ 16w — walkUp[0..2] + idleUp[0..2]
    const walkUp: string[][][] = [];
    for (let f = 0; f < PET_WALK_FRAMES_VERT; f++) {
      walkUp.push(extractFrame(f * PET_FRAME_W_SMALL, PET_FRAME_H, PET_FRAME_W_SMALL, PET_FRAME_H));
    }
    const idleUp: string[][][] = [];
    for (let f = 0; f < PET_IDLE_FRAMES_VERT; f++) {
      idleUp.push(
        extractFrame(
          (PET_WALK_FRAMES_VERT + f) * PET_FRAME_W_SMALL,
          PET_FRAME_H,
          PET_FRAME_W_SMALL,
          PET_FRAME_H,
        ),
      );
    }

    // Row 2 (y=64): 3 frames @ 32w — walkRight[0..2]
    const walkRight: string[][][] = [];
    for (let f = 0; f < PET_WALK_FRAMES_HORIZ; f++) {
      walkRight.push(
        extractFrame(f * PET_FRAME_W_LARGE, PET_FRAME_H * 2, PET_FRAME_W_LARGE, PET_FRAME_H),
      );
    }

    return { walkDown, idleDown, walkUp, idleUp, walkRight };
  } catch (err) {
    console.warn(
      `[PngDecoder] Failed to parse pet PNG: ${err instanceof Error ? err.message : err}`,
    );
    const emptySmall = (): string[][] =>
      Array.from({ length: PET_FRAME_H }, () => new Array(PET_FRAME_W_SMALL).fill(''));
    const emptyLarge = (): string[][] =>
      Array.from({ length: PET_FRAME_H }, () => new Array(PET_FRAME_W_LARGE).fill(''));
    return {
      walkDown: [emptySmall(), emptySmall(), emptySmall()],
      idleDown: [emptySmall(), emptySmall(), emptySmall()],
      walkUp: [emptySmall(), emptySmall(), emptySmall()],
      idleUp: [emptySmall(), emptySmall(), emptySmall()],
      walkRight: [emptyLarge(), emptyLarge(), emptyLarge()],
    };
  }
}
