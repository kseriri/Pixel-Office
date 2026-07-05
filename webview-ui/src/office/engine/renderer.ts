import type { ColorValue } from '../../components/ui/types.js';
import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  BUTTON_ICON_COLOR,
  BUTTON_ICON_SIZE_FACTOR,
  BUTTON_LINE_WIDTH_MIN,
  BUTTON_LINE_WIDTH_ZOOM_FACTOR,
  BUTTON_MIN_RADIUS,
  BUTTON_RADIUS_ZOOM_FACTOR,
  CACHE_READ_PRICE_MULT,
  CACHE_WRITE_PRICE_MULT,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  DELETE_BUTTON_BG,
  EMOTE_FONT,
  FALLBACK_FLOOR_COLOR,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  GHOST_BORDER_STROKE,
  GHOST_INVALID_TINT,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  GHOST_VALID_TINT,
  GRID_LINE_COLOR,
  HOVERED_OUTLINE_ALPHA,
  MODEL_BADGE_DEFAULT_COLOR,
  MODEL_BADGE_FABLE_COLOR,
  MODEL_BADGE_GPT_COLOR,
  MODEL_BADGE_HAIKU_COLOR,
  MODEL_BADGE_OPUS_COLOR,
  MODEL_BADGE_SONNET_COLOR,
  MODEL_BADGE_STATS_COLOR,
  MODEL_BADGE_TEXT_COLOR,
  MODEL_HALO_COLOR,
  MODEL_PRICING,
  MODEL_WING_COLOR,
  MODEL_WING_EDGE_COLOR,
  MONITOR_SCREEN_BG_COLOR,
  MONITOR_SCREEN_BORDER_COLOR,
  MONITOR_SCREEN_TEXT_COLOR,
  MONITOR_SCREEN_TITLE_COLOR,
  MONITOR_SCREEN_TRACK_COLOR,
  OUTLINE_Z_SORT_OFFSET,
  ROOM_LABEL_BORDER_COLOR,
  ROOM_LABEL_FONT,
  ROOM_LABEL_PLATE_BG,
  ROOM_LABEL_TEXT_COLOR,
  ROTATE_BUTTON_BG,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  SELECTION_DASH_PATTERN,
  SELECTION_HIGHLIGHT_COLOR,
  UTIL_BAR_ACTIVE_COLOR,
  UTIL_BAR_IDLE_COLOR,
  UTIL_BAR_WAITING_COLOR,
  VOID_TILE_DASH_PATTERN,
  VOID_TILE_OUTLINE_COLOR,
} from '../../constants.js';
import { getColorizedFloorSprite, hasFloorSprites, WALL_COLOR } from '../floorTiles.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache.js';
import {
  BUBBLE_HEART_SPRITE,
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  Pet,
  Room,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, TILE_SIZE, TileType } from '../types.js';
import { getWallInstances, hasWallSprites, wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite, isReadingTool } from './characters.js';
import { renderMatrixEffect } from './matrixEffect.js';
import { getPetSpriteData } from './petEntity.js';

// ── Render functions ────────────────────────────────────────────

/** @internal */
export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
  tileColors?: Array<ColorValue | null>,
  cols?: number,
): void {
  const s = TILE_SIZE * zoom;
  const useSpriteFloors = hasFloorSprites();
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;
  const layoutCols = cols ?? tmCols;

  // Floor tiles + wall base color
  for (let r = 0; r < tmRows; r++) {
    for (let c = 0; c < tmCols; c++) {
      const tile = tileMap[r][c];

      // Skip VOID tiles entirely (transparent)
      if (tile === TileType.VOID) continue;

      if (tile === TileType.WALL || !useSpriteFloors) {
        // Wall tiles or fallback: solid color
        if (tile === TileType.WALL) {
          const colorIdx = r * layoutCols + c;
          const wallColor = tileColors?.[colorIdx];
          ctx.fillStyle = wallColor ? wallColorToHex(wallColor) : WALL_COLOR;
        } else {
          ctx.fillStyle = FALLBACK_FLOOR_COLOR;
        }
        ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s);
        continue;
      }

      // Floor tile: get colorized sprite
      const colorIdx = r * layoutCols + c;
      const color = tileColors?.[colorIdx] ?? { h: 0, s: 0, b: 0, c: 0 };
      const sprite = getColorizedFloorSprite(tile, color);
      const cached = getCachedSprite(sprite, zoom);
      ctx.drawImage(cached, offsetX + c * s, offsetY + r * s);
    }
  }
}

interface ZDrawable {
  zY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** @internal */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  pets: Pet[] = [],
): void {
  const drawables: ZDrawable[] = [];

  // Furniture
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = offsetX + f.x * zoom;
    const fy = offsetY + f.y * zoom;
    if (f.mirrored) {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.save();
          c.translate(fx + cached.width, fy);
          c.scale(-1, 1);
          c.drawImage(cached, 0, 0);
          c.restore();
        },
      });
    } else {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.drawImage(cached, fx, fy);
        },
      });
    }
  }

  // Characters
  for (const ch of characters) {
    const sprites = getCharacterSprites(ch.palette, ch.hueShift);
    const spriteData = getCharacterSprite(ch, sprites);
    const cached = getCachedSprite(spriteData, zoom);
    // Sitting offset: shift character down when seated so they visually sit in the chair
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    // Anchor at bottom-center of character — round to integer device pixels
    const drawX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const drawY = Math.round(offsetY + (ch.y + sittingOffset) * zoom - cached.height);

    // Sort characters by bottom of their tile (not center) so they render
    // in front of same-row furniture (e.g. chairs) but behind furniture
    // at lower rows (e.g. desks, bookshelves that occlude from below).
    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;

    // Matrix spawn/despawn effect — skip outline, use per-pixel rendering
    if (ch.matrixEffect) {
      const mDrawX = drawX;
      const mDrawY = drawY;
      const mSpriteData = spriteData;
      const mCh = ch;
      drawables.push({
        zY: charZY,
        draw: (c) => {
          renderMatrixEffect(c, mCh, mSpriteData, mDrawX, mDrawY, zoom);
        },
      });
      continue;
    }

    // White outline: full opacity for selected, 50% for hover
    const isSelected = selectedAgentId !== null && ch.id === selectedAgentId;
    const isHovered = hoveredAgentId !== null && ch.id === hoveredAgentId;
    if (isSelected || isHovered) {
      const outlineAlpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
      const outlineData = getOutlineSprite(spriteData);
      const outlineCached = getCachedSprite(outlineData, zoom);
      const olDrawX = drawX - zoom; // 1 sprite-pixel offset, scaled
      const olDrawY = drawY - zoom; // outline follows sitting offset via drawY
      drawables.push({
        zY: charZY - OUTLINE_Z_SORT_OFFSET, // sort just before character
        draw: (c) => {
          c.save();
          c.globalAlpha = outlineAlpha;
          c.drawImage(outlineCached, olDrawX, olDrawY);
          c.restore();
        },
      });
    }

    drawables.push({
      zY: charZY,
      draw: (c) => {
        c.drawImage(cached, drawX, drawY);
      },
    });
  }

  // ── Pets ──────────────────────────────────────────────
  for (const pet of pets) {
    const petSprites = getPetSprites(pet.petType);
    const spriteData = getPetSpriteData(pet, petSprites);
    if (!spriteData) continue;

    const cached = getCachedSprite(spriteData, zoom);
    // Anchor at bottom-center at (pet.x, pet.y) — round to integer device pixels
    const drawX = Math.round(offsetX + pet.x * zoom - cached.width / 2);
    const drawY = Math.round(offsetY + pet.y * zoom - cached.height);

    // Z-sort key: matches the chair/character "row boundary" formula.
    // pet.y is the pixel center, so + TILE_SIZE/2 lifts us to the row's bottom edge.
    const petZY = pet.y + TILE_SIZE / 2;

    drawables.push({
      zY: petZY,
      draw: (c) => {
        c.drawImage(cached, drawX, drawY);
      },
    });
  }

  // Sort by Y (lower = in front = drawn later)
  drawables.sort((a, b) => a.zY - b.zY);

  for (const d of drawables) {
    d.draw(ctx);
  }
}

// ── Seat indicators ─────────────────────────────────────────────

function renderSeatIndicators(
  ctx: CanvasRenderingContext2D,
  seats: Map<string, Seat>,
  characters: Map<number, Character>,
  selectedAgentId: number | null,
  hoveredTile: { col: number; row: number } | null,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (selectedAgentId === null || !hoveredTile) return;
  const selectedChar = characters.get(selectedAgentId);
  if (!selectedChar) return;

  // Only show indicator for the hovered seat tile
  for (const [uid, seat] of seats) {
    if (seat.seatCol !== hoveredTile.col || seat.seatRow !== hoveredTile.row) continue;

    const s = TILE_SIZE * zoom;
    const x = offsetX + seat.seatCol * s;
    const y = offsetY + seat.seatRow * s;

    if (selectedChar.seatId === uid) {
      // Selected agent's own seat — blue
      ctx.fillStyle = SEAT_OWN_COLOR;
    } else if (!seat.assigned) {
      // Available seat — green
      ctx.fillStyle = SEAT_AVAILABLE_COLOR;
    } else {
      // Busy (assigned to another agent) — red
      ctx.fillStyle = SEAT_BUSY_COLOR;
    }
    ctx.fillRect(x, y, s, s);
    break;
  }
}

// ── Edit mode overlays ──────────────────────────────────────────

/** @internal */
export function renderGridOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  tileMap?: TileTypeVal[][],
): void {
  const s = TILE_SIZE * zoom;
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Vertical lines — offset by 0.5 for crisp 1px lines
  for (let c = 0; c <= cols; c++) {
    const x = offsetX + c * s + 0.5;
    ctx.moveTo(x, offsetY);
    ctx.lineTo(x, offsetY + rows * s);
  }
  // Horizontal lines
  for (let r = 0; r <= rows; r++) {
    const y = offsetY + r * s + 0.5;
    ctx.moveTo(offsetX, y);
    ctx.lineTo(offsetX + cols * s, y);
  }
  ctx.stroke();

  // Draw faint dashed outlines on VOID tiles
  if (tileMap) {
    ctx.save();
    ctx.strokeStyle = VOID_TILE_OUTLINE_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash(VOID_TILE_DASH_PATTERN);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tileMap[r]?.[c] === TileType.VOID) {
          ctx.strokeRect(offsetX + c * s + 0.5, offsetY + r * s + 0.5, s - 1, s - 1);
        }
      }
    }
    ctx.restore();
  }
}

/** Draw faint expansion placeholders 1 tile outside grid bounds (ghost border). */
function renderGhostBorder(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  ghostHoverCol: number,
  ghostHoverRow: number,
): void {
  const s = TILE_SIZE * zoom;
  ctx.save();

  // Collect ghost border tiles: one ring around the grid
  const ghostTiles: Array<{ c: number; r: number }> = [];
  // Top and bottom rows
  for (let c = -1; c <= cols; c++) {
    ghostTiles.push({ c, r: -1 });
    ghostTiles.push({ c, r: rows });
  }
  // Left and right columns (excluding corners already added)
  for (let r = 0; r < rows; r++) {
    ghostTiles.push({ c: -1, r });
    ghostTiles.push({ c: cols, r });
  }

  for (const { c, r } of ghostTiles) {
    const x = offsetX + c * s;
    const y = offsetY + r * s;
    const isHovered = c === ghostHoverCol && r === ghostHoverRow;
    if (isHovered) {
      ctx.fillStyle = GHOST_BORDER_HOVER_FILL;
      ctx.fillRect(x, y, s, s);
    }
    ctx.strokeStyle = isHovered ? GHOST_BORDER_HOVER_STROKE : GHOST_BORDER_STROKE;
    ctx.lineWidth = 1;
    ctx.setLineDash(VOID_TILE_DASH_PATTERN);
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }

  ctx.restore();
}

/** @internal */
export function renderGhostPreview(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  col: number,
  row: number,
  valid: boolean,
  offsetX: number,
  offsetY: number,
  zoom: number,
  mirrored: boolean = false,
): void {
  const cached = getCachedSprite(sprite, zoom);
  const x = offsetX + col * TILE_SIZE * zoom;
  const y = offsetY + row * TILE_SIZE * zoom;
  ctx.save();
  ctx.globalAlpha = GHOST_PREVIEW_SPRITE_ALPHA;
  if (mirrored) {
    ctx.translate(x + cached.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(cached, 0, 0);
  } else {
    ctx.drawImage(cached, x, y);
  }
  // Tint overlay — reset transform for correct fill position
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = GHOST_PREVIEW_TINT_ALPHA;
  ctx.fillStyle = valid ? GHOST_VALID_TINT : GHOST_INVALID_TINT;
  ctx.fillRect(x, y, cached.width, cached.height);
  ctx.restore();
}

/** @internal */
export function renderSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;
  const x = offsetX + col * s;
  const y = offsetY + row * s;
  ctx.save();
  ctx.strokeStyle = SELECTION_HIGHLIGHT_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash(SELECTION_DASH_PATTERN);
  ctx.strokeRect(x + 1, y + 1, w * s - 2, h * s - 2);
  ctx.restore();
}

/** @internal */
export function renderDeleteButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): DeleteButtonBounds {
  const s = TILE_SIZE * zoom;
  // Position at top-right corner of selected furniture
  const cx = offsetX + (col + w) * s + 1;
  const cy = offsetY + row * s - 1;
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = DELETE_BUTTON_BG;
  ctx.fill();

  // X mark
  ctx.strokeStyle = BUTTON_ICON_COLOR;
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
  ctx.lineCap = 'round';
  const xSize = radius * BUTTON_ICON_SIZE_FACTOR;
  ctx.beginPath();
  ctx.moveTo(cx - xSize, cy - xSize);
  ctx.lineTo(cx + xSize, cy + xSize);
  ctx.moveTo(cx + xSize, cy - xSize);
  ctx.lineTo(cx - xSize, cy + xSize);
  ctx.stroke();
  ctx.restore();

  return { cx, cy, radius };
}

function renderRotateButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  _w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): RotateButtonBounds {
  const s = TILE_SIZE * zoom;
  // Position to the left of the delete button (which is at top-right corner)
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);
  const cx = offsetX + col * s - 1;
  const cy = offsetY + row * s - 1;

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = ROTATE_BUTTON_BG;
  ctx.fill();

  // Circular arrow icon
  ctx.strokeStyle = BUTTON_ICON_COLOR;
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
  ctx.lineCap = 'round';
  const arcR = radius * BUTTON_ICON_SIZE_FACTOR;
  ctx.beginPath();
  // Draw a 270-degree arc
  ctx.arc(cx, cy, arcR, -Math.PI * 0.8, Math.PI * 0.7);
  ctx.stroke();
  // Draw arrowhead at the end of the arc
  const endAngle = Math.PI * 0.7;
  const endX = cx + arcR * Math.cos(endAngle);
  const endY = cy + arcR * Math.sin(endAngle);
  const arrowSize = radius * 0.35;
  ctx.beginPath();
  ctx.moveTo(endX + arrowSize * 0.6, endY - arrowSize * 0.3);
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX + arrowSize * 0.7, endY + arrowSize * 0.5);
  ctx.stroke();
  ctx.restore();

  return { cx, cy, radius };
}

// ── Speech bubbles ──────────────────────────────────────────────

function renderBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const ch of characters) {
    if (!ch.bubbleType) continue;
    // The green checkmark bubble only represents "done" (turn finished). The
    // idle "Waiting for input" state communicates via its overlay label, not a
    // bubble, so skip the bubble for it.
    if (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput) continue;

    const sprite =
      ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;

    // Compute opacity: permission = full, waiting = fade in last 0.5s
    let alpha = 1.0;
    if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC;
    }

    const cached = getCachedSprite(sprite, zoom);
    // Position: centered above the character's head
    // Character is anchored bottom-center at (ch.x, ch.y), sprite is 16x24
    // Place bubble above head with a small gap; follow sitting offset
    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
    const bubbleX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const bubbleY = Math.round(
      offsetY + (ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX) * zoom - cached.height - 1 * zoom,
    );

    ctx.save();
    if (alpha < 1.0) ctx.globalAlpha = alpha;
    ctx.drawImage(cached, bubbleX, bubbleY);
    ctx.restore();
  }
}

function renderPetBubbles(
  ctx: CanvasRenderingContext2D,
  pets: Pet[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const pet of pets) {
    if (!pet.bubbleType) continue;

    const sprite = BUBBLE_HEART_SPRITE;

    // Fade in the last BUBBLE_FADE_DURATION_SEC of the lifetime
    let alpha = 1.0;
    if (pet.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = Math.max(0, pet.bubbleTimer / BUBBLE_FADE_DURATION_SEC);
    }

    const cached = getCachedSprite(sprite, zoom);
    // Anchor: centered above the pet's head. Pet is anchored bottom-center at
    // (pet.x, pet.y); sprite is ~16 tall, so back up TILE_SIZE pixels and add
    // a 1-sprite-pixel gap (scaled by zoom).
    const bubbleX = Math.round(offsetX + pet.x * zoom - cached.width / 2);
    const bubbleY = Math.round(offsetY + (pet.y - TILE_SIZE) * zoom - cached.height - 1 * zoom);

    ctx.save();
    if (alpha < 1.0) ctx.globalAlpha = alpha;
    ctx.drawImage(cached, bubbleX, bubbleY);
    ctx.restore();
  }
}

export interface ButtonBounds {
  /** Center X in device pixels */
  cx: number;
  /** Center Y in device pixels */
  cy: number;
  /** Radius in device pixels */
  radius: number;
}

export type DeleteButtonBounds = ButtonBounds;
export type RotateButtonBounds = ButtonBounds;

export interface EditorRenderState {
  showGrid: boolean;
  ghostSprite: SpriteData | null;
  ghostMirrored: boolean;
  ghostCol: number;
  ghostRow: number;
  ghostValid: boolean;
  selectedCol: number;
  selectedRow: number;
  selectedW: number;
  selectedH: number;
  hasSelection: boolean;
  isRotatable: boolean;
  /** Updated each frame by renderDeleteButton */
  deleteButtonBounds: DeleteButtonBounds | null;
  /** Updated each frame by renderRotateButton */
  rotateButtonBounds: RotateButtonBounds | null;
  /** Whether to show ghost border (expansion tiles outside grid) */
  showGhostBorder: boolean;
  /** Hovered ghost border tile col (-1 to cols) */
  ghostBorderHoverCol: number;
  /** Hovered ghost border tile row (-1 to rows) */
  ghostBorderHoverRow: number;
}

export interface SelectionRenderState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
}

/** Draw each room's name (or the project working there) as a label at the top
 *  of the room, with a small pill background for readability. */
function renderRoomLabels(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (rooms.length === 0) return;
  const s = TILE_SIZE * zoom;
  // Small tabletop sign: ~2.3 tiles wide x 0.8 tall, sitting over each work
  // space (the office is open-plan now, so there is no top wall to mount on).
  const plateW = Math.round(2.3 * s);
  const plateH = Math.round(0.8 * s);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const room of rooms) {
    // Prefer the name of the project currently working in this room.
    let label = room.name;
    if (room.kind === 'work') {
      const occupant = characters.find(
        (ch) => !ch.isSubagent && ch.homeRoomId === room.id && ch.folderName,
      );
      if (occupant?.folderName) label = occupant.folderName;
    }
    const cx = offsetX + (room.col + room.w / 2) * s;
    const plateX = Math.round(cx - plateW / 2);
    // Sit just inside the top of the work space, above its furniture.
    const plateY = Math.round(offsetY + room.row * s + Math.round(0.08 * s));

    // plaque background + a double warm frame (looks like a small desk sign)
    ctx.fillStyle = ROOM_LABEL_PLATE_BG;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = ROOM_LABEL_BORDER_COLOR;
    ctx.lineWidth = Math.max(1, Math.round(zoom * 0.75));
    ctx.strokeRect(plateX + 1, plateY + 1, plateW - 2, plateH - 2);

    // Fit the text to the plate (start ~0.46 tile, shrink if needed).
    let fontPx = Math.round(s * 0.46);
    const maxTextW = plateW - Math.round(0.4 * s);
    ctx.font = `${fontPx}px ${ROOM_LABEL_FONT}`;
    while (fontPx > 6 && ctx.measureText(label).width > maxTextW) {
      fontPx -= 1;
      ctx.font = `${fontPx}px ${ROOM_LABEL_FONT}`;
    }
    ctx.fillStyle = ROOM_LABEL_TEXT_COLOR;
    ctx.fillText(label, Math.round(cx), Math.round(plateY + plateH / 2));
  }
  ctx.restore();
}

/** Map a raw model id to a short badge label, colour, a pricing key, and whether
 *  it's the "divine" model (fable) that gets a halo + wings. Null if unknown. */
function modelBadgeInfo(
  model: string | undefined,
): { label: string; color: string; god: boolean; key: string } | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes('fable'))
    return { label: 'Fable', color: MODEL_BADGE_FABLE_COLOR, god: true, key: 'fable' };
  if (m.includes('opus'))
    return { label: 'Opus', color: MODEL_BADGE_OPUS_COLOR, god: false, key: 'opus' };
  if (m.includes('sonnet'))
    return { label: 'Sonnet', color: MODEL_BADGE_SONNET_COLOR, god: false, key: 'sonnet' };
  if (m.includes('haiku'))
    return { label: 'Haiku', color: MODEL_BADGE_HAIKU_COLOR, god: false, key: 'haiku' };
  if (m.includes('codex'))
    return { label: 'Codex', color: MODEL_BADGE_GPT_COLOR, god: false, key: 'gpt' };
  if (m.includes('gpt') || /\bo[1-9]\b/.test(m))
    return { label: 'GPT', color: MODEL_BADGE_GPT_COLOR, god: false, key: 'gpt' };
  const label = model.replace(/^claude-/, '').slice(0, 10);
  return { label, color: MODEL_BADGE_DEFAULT_COLOR, god: false, key: 'default' };
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

function fmtCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.01) return '<$.01';
  if (usd < 10) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(1);
}

function estCostUsd(
  key: string,
  inTok: number,
  outTok: number,
  cacheReadTok: number,
  cacheWriteTok: number,
): number {
  const p = MODEL_PRICING[key] ?? MODEL_PRICING.default;
  return (
    (inTok / 1e6) * p.in +
    (outTok / 1e6) * p.out +
    (cacheReadTok / 1e6) * p.in * CACHE_READ_PRICE_MULT +
    (cacheWriteTok / 1e6) * p.in * CACHE_WRITE_PRICE_MULT
  );
}

/** Draw a golden halo floating above a point (for the fable "god" model). */
function drawHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = MODEL_HALO_COLOR;
  ctx.lineWidth = Math.max(1, Math.round(1.2 * zoom));
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.round(6 * zoom), Math.max(1, Math.round(2.2 * zoom)), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = Math.max(1, Math.round(2.5 * zoom));
  ctx.stroke();
  ctx.restore();
}

/** Draw a pair of feathered angel wings spreading up-and-out from (cx, cy). */
function drawWings(ctx: CanvasRenderingContext2D, cx: number, cy: number, zoom: number): void {
  const u = zoom;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = MODEL_WING_COLOR;
  ctx.strokeStyle = MODEL_WING_EDGE_COLOR;
  ctx.lineWidth = Math.max(1, Math.round(0.7 * zoom));
  const feather = (fx: number, fy: number, rot: number, rx: number, ry: number) => {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  // three feathers per wing, fanning outward and slightly up
  for (let i = 0; i < 3; i++) {
    const off = (3 + i * 2.2) * u;
    const up = (i * 1.6) * u;
    const rx = (3.4 - i * 0.4) * u;
    const ry = 1.5 * u;
    feather(cx - off, cy - up, -0.55 - i * 0.22, rx, ry); // left wing
    feather(cx + off, cy - up, 0.55 + i * 0.22, rx, ry); // right wing (mirror)
  }
  ctx.restore();
}

/** Draw model badges above characters: a colour-coded pill with the model name
 *  and a second line of token count + estimated cost. Fable gets wings + halo. */
function renderModelBadges(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const f1 = Math.max(6, Math.round(3 * zoom)); // model name
  const f2 = Math.max(5, Math.round(2.4 * zoom)); // stats line
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ch of characters) {
    if (ch.isSubagent) continue; // keep sub-agents uncluttered
    if (ch.matrixEffect === 'despawn') continue;
    const info = modelBadgeInfo(ch.model);

    const sittingOff = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const cx = offsetX + ch.x * zoom;
    const headTopY = offsetY + (ch.y + sittingOff) * zoom - CHARACTER_HIT_HEIGHT * zoom;

    // Utilization split (active / waiting / idle) as a thin stacked bar.
    const a = ch.activeSec;
    const wSec = ch.waitingSec;
    const iSec = ch.idleSec;
    const totSec = a + wSec + iSec;
    const showBar = totSec > 0.5;
    // Nothing to show for an agent with neither a known model nor tracked time.
    if (!info && !showBar) continue;

    if (info?.god) {
      drawWings(ctx, cx, headTopY + Math.round(9 * zoom), zoom);
      drawHalo(ctx, cx, headTopY - Math.round(2 * zoom), zoom);
    }

    const label = info ? info.label : '';
    let stats = '';
    if (info) {
      const total = (ch.inputTokens || 0) + (ch.outputTokens || 0);
      const cost = estCostUsd(
        info.key,
        ch.inputTokens || 0,
        ch.outputTokens || 0,
        ch.cacheReadTokens || 0,
        ch.cacheWriteTokens || 0,
      );
      if (total > 0 || cost > 0) stats = `${fmtTokens(total)} ${fmtCost(cost)}`;
    }

    ctx.font = `${f1}px ${ROOM_LABEL_FONT}`;
    const w1 = label ? ctx.measureText(label).width : 0;
    ctx.font = `${f2}px ${ROOM_LABEL_FONT}`;
    const w2 = stats ? ctx.measureText(stats).width : 0;

    const padX = f1 * 0.5;
    const padY = f1 * 0.28;
    const rowGap = Math.round(1 * zoom);
    const barH = Math.max(2, Math.round(1.4 * zoom));
    const barGap = Math.round(1.5 * zoom);
    const minBarW = Math.round(7 * zoom);

    const nameH = label ? f1 : 0;
    const statsH = stats ? f2 + rowGap : 0;
    const barBlockH = showBar ? barH + (nameH || statsH ? barGap : 0) : 0;
    const boxW = Math.round(Math.max(w1, w2, showBar ? minBarW : 0) + padX * 2);
    const boxH = Math.round(nameH + statsH + barBlockH + padY * 2);
    const boxBottom = headTopY - Math.round((info?.god ? 9 : 3) * zoom);
    const boxTop = boxBottom - boxH;
    const boxX = Math.round(cx - boxW / 2);

    ctx.fillStyle = info ? info.color : MODEL_BADGE_DEFAULT_COLOR;
    ctx.fillRect(boxX, boxTop, boxW, boxH);

    if (label) {
      ctx.fillStyle = MODEL_BADGE_TEXT_COLOR;
      ctx.font = `${f1}px ${ROOM_LABEL_FONT}`;
      ctx.fillText(label, Math.round(cx), Math.round(boxTop + padY + f1 / 2));
    }
    if (stats) {
      ctx.fillStyle = MODEL_BADGE_STATS_COLOR;
      ctx.font = `${f2}px ${ROOM_LABEL_FONT}`;
      ctx.fillText(stats, Math.round(cx), Math.round(boxTop + padY + f1 + rowGap + f2 / 2));
    }
    if (showBar) {
      const barX = Math.round(boxX + padX);
      const barW = Math.round(boxW - padX * 2);
      const barY = Math.round(boxTop + boxH - padY - barH);
      ctx.fillStyle = UTIL_BAR_IDLE_COLOR;
      ctx.fillRect(barX, barY, barW, barH);
      const aw = Math.round((barW * a) / totSec);
      const ww = Math.round((barW * wSec) / totSec);
      ctx.fillStyle = UTIL_BAR_ACTIVE_COLOR;
      ctx.fillRect(barX, barY, aw, barH);
      ctx.fillStyle = UTIL_BAR_WAITING_COLOR;
      ctx.fillRect(barX + aw, barY, ww, barH);
    }
  }
  ctx.restore();
}

/** Pick a mood emote for a character from its current activity, or null for a
 *  neutral/uninteresting state. Permission/"done" states already surface via the
 *  speech bubbles, so we defer to those. */
function emoteFor(ch: Character): string | null {
  if (ch.isSubagent || ch.matrixEffect) return null;
  if (ch.bubbleType === 'permission') return null; // permission bubble shows instead
  if (ch.waitingAwaitingInput) return '❓'; // idle, waiting on the user
  if (ch.onBreak) return '☕'; // resting in the lounge
  if (ch.isActive) {
    if (isReadingTool(ch.currentTool)) return '🔍'; // reading / searching
    if (ch.currentTool) return '🔨'; // editing / running (typing)
    return '💭'; // thinking / generating
  }
  return null; // plain idle at a desk — keep it uncluttered
}

/** Draw a small mood emote beside each working character's head. */
function renderEmotes(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const fontPx = Math.max(9, Math.round(5.5 * zoom));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${fontPx}px ${EMOTE_FONT}`;
  for (const ch of characters) {
    const glyph = emoteFor(ch);
    if (!glyph) continue;
    const sittingOff = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const headTopY = offsetY + (ch.y + sittingOff) * zoom - CHARACTER_HIT_HEIGHT * zoom;
    // Beside the head, to the upper-right, clear of the centred model badge.
    const ex = Math.round(offsetX + (ch.x + 9) * zoom);
    const ey = Math.round(headTopY + 3 * zoom);
    ctx.fillText(glyph, ex, ey);
  }
  ctx.restore();
}

/** A board mounted on the office top wall showing per-project token usage as
 *  horizontal bars segmented by the model(s) in that project. Rendered in world
 *  space (pans/zooms with the office). Hidden until there's data. */
function renderTokenHud(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  rooms: Room[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  // Aggregate non-sub-agent characters by project → per-model token totals.
  interface Proj {
    total: number;
    segs: Map<string, { color: string; tokens: number }>;
  }
  const projects = new Map<string, Proj>();
  for (const ch of characters) {
    if (ch.isSubagent || !ch.folderName) continue;
    const tokens = (ch.inputTokens || 0) + (ch.outputTokens || 0);
    if (tokens <= 0) continue;
    const color = modelBadgeInfo(ch.model)?.color ?? MODEL_BADGE_DEFAULT_COLOR;
    let p = projects.get(ch.folderName);
    if (!p) {
      p = { total: 0, segs: new Map() };
      projects.set(ch.folderName, p);
    }
    const seg = p.segs.get(color) ?? { color, tokens: 0 };
    seg.tokens += tokens;
    p.segs.set(color, seg);
    p.total += tokens;
  }
  if (projects.size === 0) return; // no panel until something has run

  const s = TILE_SIZE * zoom;
  const pad = Math.round(0.4 * s);
  const titleF = Math.max(7, Math.round(0.5 * s));
  const rowF = Math.max(6, Math.round(0.4 * s));
  const rowH = Math.round(0.85 * s);
  const gap = Math.round(0.3 * s);
  const labelW = Math.round(3 * s);
  const totalW = Math.round(2 * s);

  // Span the office interior width and sit just above the top wall.
  let minCol = Infinity;
  let maxCol = -Infinity;
  for (const room of rooms) {
    minCol = Math.min(minCol, room.col);
    maxCol = Math.max(maxCol, room.col + room.w);
  }
  if (!Number.isFinite(minCol)) return;
  const rows = projects.size;
  const panelW = Math.max(0, (maxCol - minCol) * s);
  const barW = Math.max(0, panelW - pad * 2 - labelW - gap * 2 - totalW);
  const headerH = titleF + Math.round(0.3 * s);
  const panelH = pad * 2 + headerH + rows * rowH;
  const px = Math.round(offsetX + minCol * s);
  const py = Math.round(offsetY - panelH - Math.round(0.4 * s));

  ctx.save();
  ctx.fillStyle = MONITOR_SCREEN_BG_COLOR;
  ctx.fillRect(px, py, panelW, panelH);
  ctx.strokeStyle = MONITOR_SCREEN_BORDER_COLOR;
  ctx.lineWidth = Math.max(1, Math.round(0.8 * zoom));
  ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = MONITOR_SCREEN_TITLE_COLOR;
  ctx.font = `${titleF}px ${ROOM_LABEL_FONT}`;
  ctx.fillText('◈ TOKEN USAGE', px + pad, py + pad + titleF / 2);

  let maxTotal = 1;
  for (const p of projects.values()) maxTotal = Math.max(maxTotal, p.total);

  const barX = px + pad + labelW + gap;
  const barMaxW = Math.max(0, barW);

  const fitText = (text: string, maxW: number): string => {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  };

  let ry = py + pad + headerH;
  for (const [name, p] of projects) {
    const cy = ry + rowH / 2;
    ctx.font = `${rowF}px ${ROOM_LABEL_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = MONITOR_SCREEN_TEXT_COLOR;
    ctx.fillText(fitText(name, labelW), px + pad, cy);

    const bh = Math.max(2, Math.round(rowH * 0.42));
    const by = Math.round(cy - bh / 2);
    ctx.fillStyle = MONITOR_SCREEN_TRACK_COLOR;
    ctx.fillRect(barX, by, barMaxW, bh);
    const fullW = Math.round(barMaxW * (p.total / maxTotal));
    let segX = barX;
    for (const seg of p.segs.values()) {
      const w = Math.round(fullW * (seg.tokens / p.total));
      ctx.fillStyle = seg.color;
      ctx.fillRect(segX, by, w, bh);
      segX += w;
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = MONITOR_SCREEN_TEXT_COLOR;
    ctx.fillText(fmtTokens(p.total), px + panelW - pad, cy);
    ry += rowH;
  }
  ctx.restore();
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  selection?: SelectionRenderState,
  editor?: EditorRenderState,
  tileColors?: Array<ColorValue | null>,
  layoutCols?: number,
  layoutRows?: number,
  pets?: Pet[],
  rooms?: Room[],
): { offsetX: number; offsetY: number } {
  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Use layout dimensions (fallback to tileMap size)
  const cols = layoutCols ?? (tileMap.length > 0 ? tileMap[0].length : 0);
  const rows = layoutRows ?? tileMap.length;

  // Center map in viewport + pan offset (integer device pixels)
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  const offsetX = Math.floor((canvasWidth - mapW) / 2) + Math.round(panX);
  const offsetY = Math.floor((canvasHeight - mapH) / 2) + Math.round(panY);

  // Draw tiles (floor + wall base color)
  renderTileGrid(ctx, tileMap, offsetX, offsetY, zoom, tileColors, layoutCols);

  // Work-space name signs live on the floor (drawn right after the tiles), so
  // furniture and characters render on top of them and never get covered.
  if (rooms && rooms.length > 0 && !editor) {
    renderRoomLabels(ctx, rooms, characters, offsetX, offsetY, zoom);
  }

  // Seat indicators (below furniture/characters, on top of floor)
  if (selection) {
    renderSeatIndicators(
      ctx,
      selection.seats,
      selection.characters,
      selection.selectedAgentId,
      selection.hoveredTile,
      offsetX,
      offsetY,
      zoom,
    );
  }

  // Build wall instances for z-sorting with furniture and characters
  const wallInstances = hasWallSprites() ? getWallInstances(tileMap, tileColors, layoutCols) : [];
  const allFurniture = wallInstances.length > 0 ? [...wallInstances, ...furniture] : furniture;

  // Draw walls + furniture + characters (z-sorted)
  const selectedId = selection?.selectedAgentId ?? null;
  const hoveredId = selection?.hoveredAgentId ?? null;
  renderScene(
    ctx,
    allFurniture,
    characters,
    offsetX,
    offsetY,
    zoom,
    selectedId,
    hoveredId,
    pets ?? [],
  );

  // Speech bubbles (always on top of characters)
  renderBubbles(ctx, characters, offsetX, offsetY, zoom);
  // Pet heart bubbles (same overlay pass)
  if (pets && pets.length > 0) {
    renderPetBubbles(ctx, pets, offsetX, offsetY, zoom);
  }

  // Token board on the top wall (overlay, above everything; no characters there)
  if (rooms && rooms.length > 0 && !editor) {
    renderTokenHud(ctx, characters, rooms, offsetX, offsetY, zoom);
  }

  // Per-character AI model badges + halo + mood emote (skip in edit mode)
  if (!editor) {
    renderModelBadges(ctx, characters, offsetX, offsetY, zoom);
    renderEmotes(ctx, characters, offsetX, offsetY, zoom);
  }

  // Editor overlays
  if (editor) {
    if (editor.showGrid) {
      renderGridOverlay(ctx, offsetX, offsetY, zoom, cols, rows, tileMap);
    }
    if (editor.showGhostBorder) {
      renderGhostBorder(
        ctx,
        offsetX,
        offsetY,
        zoom,
        cols,
        rows,
        editor.ghostBorderHoverCol,
        editor.ghostBorderHoverRow,
      );
    }
    if (editor.ghostSprite && editor.ghostCol >= 0) {
      renderGhostPreview(
        ctx,
        editor.ghostSprite,
        editor.ghostCol,
        editor.ghostRow,
        editor.ghostValid,
        offsetX,
        offsetY,
        zoom,
        editor.ghostMirrored,
      );
    }
    if (editor.hasSelection) {
      renderSelectionHighlight(
        ctx,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
        offsetX,
        offsetY,
        zoom,
      );
      editor.deleteButtonBounds = renderDeleteButton(
        ctx,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
        offsetX,
        offsetY,
        zoom,
      );
      if (editor.isRotatable) {
        editor.rotateButtonBounds = renderRotateButton(
          ctx,
          editor.selectedCol,
          editor.selectedRow,
          editor.selectedW,
          editor.selectedH,
          offsetX,
          offsetY,
          zoom,
        );
      } else {
        editor.rotateButtonBounds = null;
      }
    } else {
      editor.deleteButtonBounds = null;
      editor.rotateButtonBounds = null;
    }
  }

  return { offsetX, offsetY };
}
