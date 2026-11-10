import React, { useCallback, useEffect, useRef } from 'react';
import {
  NarrativeComputedState,
  Point2D,
  clamp,
  createSeededRandom,
  lerp,
  sampleBraceletToHeartPoints,
  sampleCloverToHeartPoints,
  slicePointsByDrawProgress,
  smoothstep,
} from '../utils/proceduralArtLogic';

interface ProceduralGoldCanvasProps {
  narrativeState: NarrativeComputedState;
  onCanvasTap?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────
const SAMPLE_POINTS = 120;
const BOIL_FRAMES = 4;
const BOIL_INTERVAL_MS = 120;
const IDLE_FRAME_MS = 1000 / 24; // reposo animado "on twos", ritmo clásico de cartoon
const SKETCH_DURATION_S = 0.95;
const SMOOTHING_RATE = 9.5; // ≈ lerp 0.15/frame a 60 fps, pero independiente del framerate
const SETTLE_EPSILON = 0.003;
const HEART_BURST_S = 1.1;
const TAP_BOUNCE_MS = 900;

const PALETTE = {
  ink: '#2B2118',
  inkSoft: '#6E5636',
  gold: '#E6C15A',
  goldMid: '#D9B04C',
  goldRim: '#B88928',
  goldDeep: '#C5922A',
  goldDark: '#8C651B',
  cream: '#FAF3DD',
  wash: '#F3DF9D',
  flame: '#F2C94C',
  flameCore: '#FFF4C8',
  shine: 'rgba(255, 251, 238, 0.92)',
} as const;

type BoilTable = ReadonlyArray<readonly [number, number]>;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

interface FrameInfo {
  cx: number;
  cy: number;
  unit: number;
  S: number; // escala base (unit / 110)
  boilFrame: number;
  swayPhase: number;
  tSec: number;
  nowMs: number;
  beat: number; // 0..~1 pulso de latido
  motion: number; // 0 si prefers-reduced-motion
}

interface StrokeOptions {
  progress: number;
  stroke: string;
  width: number;
  alpha: number;
  fill?: string | null;
  closed?: boolean;
  doubleInk?: boolean;
  penTip?: boolean;
  stride?: number; // separa índices de boil en trazos de pocos puntos
  scale?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades puras
// ─────────────────────────────────────────────────────────────────────────────
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};

const getBounds = (pts: Point2D[]): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, w: 0, h: 0 };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
};

/** Latido "lub-dub" en lugar de un seno plano. */
const heartbeat = (tSec: number) => {
  const period = 1.15;
  const t = (tSec % period) / period;
  const lub = Math.exp(-(((t - 0.1) / 0.045) ** 2));
  const dub = 0.55 * Math.exp(-(((t - 0.3) / 0.055) ** 2));
  return lub + dub;
};

/** Jitter de baja frecuencia: la línea "hierve" sin volverse dentada. */
const makeBoilTable = (seed: number, amp: number): BoilTable => {
  const rng = createSeededRandom(seed);
  const ph = [0, 1, 2, 3].map(() => rng() * Math.PI * 2);
  return Array.from({ length: SAMPLE_POINTS + 1 }, (_, i) => {
    const t = (i / SAMPLE_POINTS) * Math.PI * 2;
    return [
      (Math.sin(t * 3 + ph[0]) * 0.65 + Math.sin(t * 8 + ph[1]) * 0.35 + (rng() - 0.5) * 0.22) * amp,
      (Math.sin(t * 4 + ph[2]) * 0.65 + Math.sin(t * 9 + ph[3]) * 0.35 + (rng() - 0.5) * 0.22) * amp,
    ] as const;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────
export const ProceduralGoldCanvas: React.FC<ProceduralGoldCanvasProps> = ({
  narrativeState,
  onCanvasTap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<NarrativeComputedState>(narrativeState);
  const lastChapterRef = useRef<number>(narrativeState.activeChapterIndex);
  // Inicializamos en 0.02 mientras estamos en la escena 1 (casco y vela) para que la manilla
  // nunca aparezca pre-dibujada al 100 % antes de reiniciarse (evita el doble dibujo).
  const sketchAnimRef = useRef<number>(narrativeState.activeChapterIndex > 1 ? 1 : 0.02);
  const tapStartRef = useRef<number>(-Infinity);
  const wakeUpRef = useRef<(() => void) | null>(null);

  stateRef.current = narrativeState;

  useEffect(() => {
    lastChapterRef.current = narrativeState.activeChapterIndex;
    wakeUpRef.current?.();
  }, [narrativeState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mainCtx = canvas.getContext('2d');
    if (!mainCtx) return;

    // Capa offscreen: toda la ilustración se compone aquí y luego se proyecta con
    // una única sombra cálida de "impresión", sin duplicar sombras por trazo.
    const layer = document.createElement('canvas');
    const layerCtx = layer.getContext('2d');
    if (!layerCtx) return;
    const ctx: CanvasRenderingContext2D = layerCtx;

    // ── Datos sembrados (estables entre renders) ──────────────────────────
    const boilTables: BoilTable[] = Array.from({ length: BOIL_FRAMES }, (_, i) =>
      makeBoilTable(4401 + i * 97, 1.45)
    );

    const sprinkleRng = createSeededRandom(9137);
    const sprinkleColors = [PALETTE.goldDeep, PALETTE.goldDark, PALETTE.gold];
    const sprinkles = Array.from({ length: 9 }, () => ({
      x: (sprinkleRng() - 0.5) * 56,
      y: -32 + sprinkleRng() * 24,
      rot: sprinkleRng() * Math.PI,
      color: sprinkleColors[Math.floor(sprinkleRng() * sprinkleColors.length)],
    }));

    const rainRng = createSeededRandom(2024);
    const raindrops = Array.from({ length: 10 }, (_, i) => ({
      side: i % 2 === 0 ? -1 : 1,
      xOff: (rainRng() - 0.5) * 34,
      phase: rainRng(),
      speed: 0.55 + rainRng() * 0.35,
      teardrop: i % 3 === 0,
    }));

    const burstRng = createSeededRandom(777);
    const burstParticles = Array.from({ length: 12 }, (_, i) => ({
      angle: (i / 12) * Math.PI * 2 + (burstRng() - 0.5) * 0.4,
      reach: 0.55 + burstRng() * 0.45,
      sparkle: i % 2 === 0,
    }));

    // ── Estado del loop ───────────────────────────────────────────────────
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery?.matches ?? false;

    let disposed = false;
    let rafId = 0;
    let timeoutId = 0;
    let inViewport = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let isVisible = inViewport && pageVisible;
    let burstStartMs = performance.now();
    let lastFrameMs = performance.now();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let heartBurstStartMs = -Infinity;
    let heartBurstArmed = true;

    let F: FrameInfo = {
      cx: 0, cy: 0, unit: 1, S: 1, boilFrame: 0, swayPhase: 0, tSec: 0, nowMs: 0, beat: 0, motion: 1,
    };

    let smoothMorph = stateRef.current.braceletToHeartMorph;
    let smoothBirthday = stateRef.current.birthdaySceneWeight;
    let smoothBracelet = stateRef.current.braceletSceneWeight;
    let smoothNov = stateRef.current.novemberSceneWeight;
    let smoothStorm = stateRef.current.stormSceneWeight;
    let smoothHeart = stateRef.current.heartSceneWeight;

    /** Grosor de tinta proporcional al tamaño del lienzo. */
    const lw = (w: number) => Math.max(1.2, w * F.S);

    // ── Primitivas de dibujo ──────────────────────────────────────────────

    /** Traza una polilínea suavizada (cuadráticas por puntos medios) con boil. */
    const tracePath = (
      pts: Point2D[],
      ox: number,
      oy: number,
      table: BoilTable,
      closed: boolean,
      stride = 1,
      salt = 0,
      jx = 1,
      jy = 1
    ) => {
      const n = pts.length;
      const at = (i: number): [number, number] => {
        const p = pts[i];
        const [bx, by] = table[(i * stride + salt) % table.length];
        return [ox + p.x + bx * jx, oy + p.y + by * jy];
      };

      if (closed && n > 2) {
        const [x0, y0] = at(0);
        const [xl, yl] = at(n - 1);
        ctx.moveTo((x0 + xl) / 2, (y0 + yl) / 2);
        for (let i = 0; i < n; i++) {
          const [x, y] = at(i);
          const [nx, ny] = at((i + 1) % n);
          ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        }
        ctx.closePath();
        return;
      }

      const [x0, y0] = at(0);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < n - 1; i++) {
        const [x, y] = at(i);
        const [nx, ny] = at(i + 1);
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      const [xe, ye] = at(n - 1);
      ctx.lineTo(xe, ye);
    };

    const traceMiniHeart = (x: number, y: number, size: number) => {
      ctx.moveTo(x, y + size * 0.9);
      ctx.bezierCurveTo(x - size * 1.4, y + size * 0.1, x - size * 0.9, y - size, x, y - size * 0.35);
      ctx.bezierCurveTo(x + size * 0.9, y - size, x + size * 1.4, y + size * 0.1, x, y + size * 0.9);
      ctx.closePath();
    };

    const withPop = (x: number, y: number, k: number, fn: () => void) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, k);
      ctx.translate(-x, -y);
      fn();
      ctx.restore();
    };

    const drawPenTip = (x: number, y: number, s: number, alpha: number) => {
      const pulse = 1 + 0.18 * Math.sin(F.tSec * 14) * F.motion;
      ctx.save();
      ctx.globalAlpha = alpha * 0.32;
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(x, y, 9.5 * s * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(2.4);
      ctx.beginPath();
      ctx.arc(x, y, 4.6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = PALETTE.cream;
      ctx.beginPath();
      ctx.arc(x - 1.5 * s, y - 1.5 * s, 1.3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    /** Trazo orgánico a mano que puede dibujarse progresivamente de 0 a 1. */
    const drawHandStroke = (pts: Point2D[], ox: number, oy: number, opts: StrokeOptions) => {
      const p = clamp(opts.progress, 0, 1);
      if (pts.length < 2 || opts.alpha <= 0.01 || p <= 0.005) return;

      const visible = p >= 0.999 ? pts : slicePointsByDrawProgress(pts, p);
      if (visible.length < 2) return;

      const complete = p >= 0.985;
      const closed = (opts.closed ?? true) && complete;
      const stride = opts.stride ?? 1;
      const scale = opts.scale ?? F.S;
      const table = boilTables[F.boilFrame % BOIL_FRAMES];

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      tracePath(visible, ox, oy, table, closed, stride);

      if (opts.fill) {
        // Lavado dorado progresivo mientras el trazo se cierra
        const fillAlpha = closed ? 1 : smoothstep(0.25, 0.95, p);
        if (fillAlpha > 0.01) {
          ctx.globalAlpha = opts.alpha * fillAlpha;
          ctx.fillStyle = opts.fill;
          ctx.fill();
        }
      }

      ctx.globalAlpha = opts.alpha;
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.width;
      ctx.stroke();

      // Segundo contorno de tinta, ligeramente desfasado: imperfección cálida de boceto
      if (opts.doubleInk !== false) {
        ctx.globalAlpha = opts.alpha * 0.5;
        ctx.lineWidth = Math.max(1.4, opts.width * 0.5);
        ctx.beginPath();
        tracePath(visible, ox, oy, table, closed, stride, 17, -0.9, 0.9);
        ctx.stroke();
      }

      if (opts.penTip !== false && !complete) {
        const last = visible[visible.length - 1];
        const [bx, by] = table[((visible.length - 1) * stride) % table.length];
        drawPenTip(ox + last.x + bx, oy + last.y + by, scale, opts.alpha);
      }

      ctx.restore();
    };

    const drawSparkle = (x: number, y: number, radius: number, alpha: number, phase = 0) => {
      if (alpha <= 0.02) return;
      const twinkle = 1 + 0.14 * Math.sin(F.tSec * 3.2 + phase) * F.motion;
      const rot = Math.sin(F.tSec * 1.3 + phase) * 0.12 * F.motion;
      const r = radius;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(twinkle, twinkle);
      ctx.fillStyle = PALETTE.gold;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = Math.max(1.6, r * 0.26);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.2, -r * 0.2, r, 0);
      ctx.quadraticCurveTo(r * 0.2, r * 0.2, 0, r);
      ctx.quadraticCurveTo(-r * 0.2, r * 0.2, -r, 0);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.2, 0, -r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = PALETTE.cream;
      ctx.beginPath();
      ctx.arc(-r * 0.16, -r * 0.2, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawCloud = (x: number, y: number, k: number, alpha: number) => {
      const p = new Path2D();
      p.moveTo(x - 14 * k + 11 * k, y);
      p.arc(x - 14 * k, y, 11 * k, 0, Math.PI * 2);
      p.moveTo(x + 2 * k + 14 * k, y - 7 * k);
      p.arc(x + 2 * k, y - 7 * k, 14 * k, 0, Math.PI * 2);
      p.moveTo(x + 17 * k + 10 * k, y + k);
      p.arc(x + 17 * k, y + k, 10 * k, 0, Math.PI * 2);
      p.roundRect(x - 26 * k, y, 54 * k, 13 * k, 6.5 * k);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineJoin = 'round';
      // Truco cartoon: trazo doble + relleno encima = contorno de la unión
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(3.4) * 2;
      ctx.stroke(p);
      ctx.fillStyle = PALETTE.cream;
      ctx.fill(p);

      ctx.clip(p);
      ctx.fillStyle = 'rgba(184, 137, 40, 0.22)';
      ctx.fillRect(x - 30 * k, y + 5 * k, 64 * k, 12 * k);
      ctx.restore();
    };

    // ─────────────────────────────────────────────────────────────────────
    // ESCENA 1: casco vikingo de Helga y cupcake con vela
    // ─────────────────────────────────────────────────────────────────────
    const drawVikingHelmet = (x: number, y: number, s: number) => {
      const a0 = ctx.globalAlpha;
      ctx.strokeStyle = PALETTE.ink;

      // Trenzas doradas bajo el casco
      for (const dir of [-1, 1]) {
        for (let p = 0; p < 3; p++) {
          const px = x + dir * (38 + p * 10) * s;
          const py = y + (10 + p * 15) * s;
          ctx.fillStyle = PALETTE.gold;
          ctx.lineWidth = lw(4);
          ctx.beginPath();
          ctx.ellipse(px, py, 9.5 * s, 7.5 * s, dir * 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Pliegue del tejido
          ctx.save();
          ctx.globalAlpha = a0 * 0.55;
          ctx.lineWidth = lw(2);
          ctx.beginPath();
          ctx.moveTo(px - dir * 4 * s, py - 3.5 * s);
          ctx.quadraticCurveTo(px, py + s, px + dir * 4.5 * s, py + 2 * s);
          ctx.stroke();
          ctx.restore();
        }

        // Amarre y mechón
        const tx = x + dir * 64 * s;
        const ty = y + 48 * s;
        ctx.fillStyle = PALETTE.goldDeep;
        ctx.lineWidth = lw(3.6);
        ctx.beginPath();
        ctx.arc(tx, ty, 5.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.lineWidth = lw(2.6);
        ctx.beginPath();
        ctx.moveTo(tx - 3 * s, ty + 5 * s);
        ctx.lineTo(tx - 4.5 * s, ty + 11 * s);
        ctx.moveTo(tx + 1.5 * s, ty + 5.5 * s);
        ctx.lineTo(tx + 2 * s, ty + 12 * s);
        ctx.stroke();
      }

      // Cuernos con anillos dorados
      for (const dir of [-1, 1]) {
        const horn = new Path2D();
        horn.moveTo(x + dir * 34 * s, y - 18 * s);
        horn.bezierCurveTo(x + dir * 78 * s, y - 24 * s, x + dir * 86 * s, y - 72 * s, x + dir * 56 * s, y - 86 * s);
        horn.bezierCurveTo(x + dir * 64 * s, y - 60 * s, x + dir * 54 * s, y - 36 * s, x + dir * 24 * s, y - 34 * s);
        horn.closePath();

        ctx.fillStyle = PALETTE.cream;
        ctx.fill(horn);

        ctx.save();
        ctx.clip(horn);
        ctx.strokeStyle = PALETTE.goldRim;
        ctx.lineWidth = lw(3.4);
        ctx.globalAlpha = a0 * 0.9;
        for (const off of [0, 9]) {
          ctx.beginPath();
          ctx.moveTo(x + dir * (46 + off) * s, y - 14 * s);
          ctx.lineTo(x + dir * (32 + off) * s, y - 42 * s);
          ctx.stroke();
        }
        ctx.restore();

        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = lw(4.4);
        ctx.stroke(horn);
      }

      // Cúpula
      const dome = new Path2D();
      dome.arc(x, y - 6 * s, 44 * s, Math.PI, 0, false);
      dome.closePath();
      ctx.fillStyle = PALETTE.goldMid;
      ctx.fill(dome);

      ctx.save();
      ctx.clip(dome);
      // Sombra lateral
      ctx.globalAlpha = a0 * 0.35;
      ctx.fillStyle = PALETTE.goldRim;
      ctx.beginPath();
      ctx.ellipse(x + 32 * s, y - 10 * s, 20 * s, 42 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cresta central con remaches
      ctx.globalAlpha = a0;
      ctx.fillStyle = PALETTE.goldRim;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(3);
      ctx.beginPath();
      ctx.rect(x - 6 * s, y - 56 * s, 12 * s, 50 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.cream;
      ctx.lineWidth = lw(1.8);
      for (const ry of [-38, -24]) {
        ctx.beginPath();
        ctx.arc(x, y + ry * s, 2.2 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Brillo
      ctx.strokeStyle = PALETTE.shine;
      ctx.lineWidth = lw(4.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y - 6 * s, 33 * s, Math.PI * 1.12, Math.PI * 1.36);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(4.5);
      ctx.stroke(dome);

      // Banda del borde con remaches
      ctx.fillStyle = PALETTE.goldRim;
      ctx.beginPath();
      ctx.roundRect(x - 48 * s, y - 14 * s, 96 * s, 18 * s, 8 * s);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = PALETTE.cream;
      ctx.lineWidth = lw(2.2);
      for (const rx of [-34, -17, 0, 17, 34]) {
        ctx.beginPath();
        ctx.arc(x + rx * s, y - 5 * s, 2.8 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };

    const drawCupcake = (x: number, y: number, s: number) => {
      const a0 = ctx.globalAlpha;
      const { swayPhase, tSec, motion } = F;

      // Papel con pliegues
      const wrapper = new Path2D();
      wrapper.moveTo(x - 34 * s, y - 6 * s);
      wrapper.lineTo(x - 24 * s, y + 36 * s);
      wrapper.quadraticCurveTo(x, y + 42 * s, x + 24 * s, y + 36 * s);
      wrapper.lineTo(x + 34 * s, y - 6 * s);
      wrapper.closePath();

      ctx.fillStyle = PALETTE.goldDeep;
      ctx.fill(wrapper);
      ctx.save();
      ctx.clip(wrapper);
      ctx.strokeStyle = PALETTE.ink;
      ctx.globalAlpha = a0 * 0.4;
      ctx.lineWidth = lw(2.2);
      ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 13 * s, y - 6 * s);
        ctx.lineTo(x + i * 9 * s, y + 42 * s);
        ctx.stroke();
      }
      ctx.globalAlpha = a0 * 0.25;
      ctx.fillStyle = PALETTE.goldDark;
      ctx.fillRect(x + 14 * s, y - 10 * s, 30 * s, 60 * s);
      ctx.restore();
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(4.2);
      ctx.stroke(wrapper);

      // Crema con chispas
      const frosting = new Path2D();
      frosting.moveTo(x - 38 * s, y - 4 * s);
      frosting.bezierCurveTo(x - 44 * s, y - 26 * s, x - 18 * s, y - 34 * s, x - 12 * s, y - 24 * s);
      frosting.bezierCurveTo(x - 6 * s, y - 42 * s, x + 6 * s, y - 42 * s, x + 12 * s, y - 24 * s);
      frosting.bezierCurveTo(x + 18 * s, y - 34 * s, x + 44 * s, y - 26 * s, x + 38 * s, y - 4 * s);
      frosting.quadraticCurveTo(x, y + 6 * s, x - 38 * s, y - 4 * s);
      frosting.closePath();

      ctx.fillStyle = PALETTE.cream;
      ctx.fill(frosting);
      ctx.save();
      ctx.clip(frosting);
      for (const sp of sprinkles) {
        ctx.save();
        ctx.translate(x + sp.x * s, y + sp.y * s);
        ctx.rotate(sp.rot);
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.roundRect(-3.5 * s, -1.3 * s, 7 * s, 2.6 * s, 1.3 * s);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = lw(3.2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x - 20 * s, y - 14 * s, 9 * s, Math.PI * 1.1, Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(4.2);
      ctx.stroke(frosting);

      // Vela rayada
      const candle = new Path2D();
      candle.roundRect(x - 6 * s, y - 64 * s, 12 * s, 32 * s, 3 * s);
      ctx.fillStyle = PALETTE.gold;
      ctx.fill(candle);
      ctx.save();
      ctx.clip(candle);
      ctx.strokeStyle = PALETTE.cream;
      ctx.lineWidth = lw(3);
      for (let j = 0; j < 5; j++) {
        ctx.beginPath();
        ctx.moveTo(x - 8 * s, y - 56 * s + j * 8 * s);
        ctx.lineTo(x + 8 * s, y - 64 * s + j * 8 * s);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(4);
      ctx.stroke(candle);

      // Mecha
      ctx.lineWidth = lw(2.6);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y - 64 * s);
      ctx.quadraticCurveTo(x + 1.5 * s, y - 67 * s, x, y - 70 * s);
      ctx.stroke();

      // Llama con resplandor, núcleo y parpadeo
      const flicker = motion ? 1 + Math.sin(tSec * 13) * 0.04 + Math.sin(tSec * 7.3) * 0.03 : 1;
      const sway = Math.sin(swayPhase) * 3.5 * s * motion;
      const gx = x + sway * 0.6;
      const gy = y - 88 * s;
      const glowR = 36 * s * flicker;
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR);
      glow.addColorStop(0, 'rgba(242, 201, 76, 0.5)');
      glow.addColorStop(1, 'rgba(242, 201, 76, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(gx, gy, glowR, 0, Math.PI * 2);
      ctx.fill();

      const baseY = y - 68 * s;
      ctx.save();
      ctx.translate(x, baseY);
      ctx.scale(1, flicker);
      ctx.translate(-x, -baseY);

      ctx.fillStyle = PALETTE.flame;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = lw(4.2);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.bezierCurveTo(x - 14 * s, y - 78 * s, x - 10 * s + sway, y - 98 * s, x + sway, y - 106 * s);
      ctx.bezierCurveTo(x + 10 * s + sway, y - 98 * s, x + 14 * s, y - 78 * s, x, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = PALETTE.flameCore;
      ctx.beginPath();
      ctx.moveTo(x, y - 72 * s);
      ctx.bezierCurveTo(x - 6 * s, y - 78 * s, x - 4 * s + sway * 0.8, y - 90 * s, x + sway * 0.8, y - 95 * s);
      ctx.bezierCurveTo(x + 4 * s + sway * 0.8, y - 90 * s, x + 6 * s, y - 78 * s, x, y - 72 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawBirthdayScene = (weight: number) => {
      const { cx, cy, unit, S } = F;
      const s = S;
      const [jx, jy] = boilTables[F.boilFrame][0];
      const bjx = jx * 0.7;
      const bjy = jy * 0.7;
      const pop = 0.86 + 0.14 * easeOutBack(weight);

      ctx.save();
      ctx.globalAlpha = weight;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const hatCx = cx - unit * 0.44 + bjx;
      const hatCy = cy + unit * 0.12 + bjy;
      withPop(hatCx, hatCy, pop, () => drawVikingHelmet(hatCx, hatCy, s));

      const cakeCx = cx + unit * 0.48 - bjx;
      const cakeCy = cy + unit * 0.22 + bjy;
      withPop(cakeCx, cakeCy + 20 * s, pop, () => drawCupcake(cakeCx, cakeCy, s));

      drawSparkle(cx, cy - unit * 0.68, 12 * s, weight, 0);
      drawSparkle(hatCx - 54 * s, hatCy - 66 * s, 9 * s, weight, 1.7);
      drawSparkle(cakeCx + 46 * s, cakeCy - 72 * s, 10 * s, weight, 3.1);
      ctx.restore();
    };

    // ─────────────────────────────────────────────────────────────────────
    // ESCENAS 2-5: manilla tejida y trébol -> corazón
    // ─────────────────────────────────────────────────────────────────────
    const drawHeartShading = (clipPts: Point2D[], alpha: number) => {
      if (alpha <= 0.01) return;
      const { cx, cy } = F;
      const hb = getBounds(clipPts);
      const table = boilTables[F.boilFrame];

      ctx.save();
      ctx.beginPath();
      tracePath(clipPts, cx, cy, table, true);
      ctx.clip();
      ctx.lineCap = 'round';

      // Sombreado diagonal de cómic en el lado izquierdo (recortado dentro del corazón)
      ctx.globalAlpha = alpha * 0.45;
      ctx.strokeStyle = PALETTE.goldRim;
      ctx.lineWidth = lw(3.2);
      for (let sh = -3; sh <= 3; sh++) {
        const [jx, jy] = table[((sh + 3) * 11) % table.length];
        const y0 = cy + hb.cy + sh * hb.h * 0.085 + jy;
        const x0 = cx + hb.minX + hb.w * (0.08 + Math.abs(sh) * 0.03) + jx;
        ctx.beginPath();
        ctx.moveTo(x0, y0 - hb.h * 0.045);
        ctx.lineTo(x0 + hb.w * 0.1, y0 + hb.h * 0.045);
        ctx.stroke();
      }

      // Brillo cartoon en el lóbulo superior izquierdo
      const hx = cx + hb.minX + hb.w * 0.28;
      const hy = cy + hb.minY + hb.h * 0.26;
      const hr = Math.min(hb.w, hb.h) * 0.11;
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = PALETTE.shine;
      ctx.lineWidth = lw(5);
      ctx.beginPath();
      ctx.arc(hx, hy, hr, Math.PI, Math.PI * 1.45);
      ctx.stroke();
      ctx.fillStyle = PALETTE.shine;
      ctx.beginPath();
      ctx.arc(hx + Math.cos(Math.PI * 1.72) * hr, hy + Math.sin(Math.PI * 1.72) * hr, lw(2.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawNovemberBanner = (weight: number) => {
      const { cx, cy, unit, S } = F;
      const s = S;
      const bannerY = cy - unit * 1.06;
      const pop = 0.9 + 0.1 * easeOutBack(weight);
      const label = '15 de noviembre';

      ctx.save();
      ctx.globalAlpha = weight;
      withPop(cx, bannerY, pop, () => {
        const fontSize = Math.round(16 * s);
        ctx.font = `italic 600 ${fontSize}px "Playfair Display", Georgia, serif`;
        const textW = ctx.measureText(label).width;
        const bw = Math.max(122 * s, textW + 34 * s);
        const bh = 28 * s;
        const xL = cx - bw / 2;
        const xR = cx + bw / 2;
        const yT = bannerY - bh / 2;
        const yB = bannerY + bh / 2;
        const drop = 7 * s;

        ctx.lineJoin = 'round';
        ctx.strokeStyle = PALETTE.ink;

        // Cintas laterales con muesca y pliegue
        for (const side of [-1, 1]) {
          const inner = side === -1 ? xL + 10 * s : xR - 10 * s;
          const outer = side === -1 ? xL - 20 * s : xR + 20 * s;
          const notch = side === -1 ? xL - 11 * s : xR + 11 * s;
          const edge = side === -1 ? xL : xR;

          ctx.fillStyle = PALETTE.gold;
          ctx.lineWidth = lw(3.4);
          ctx.beginPath();
          ctx.moveTo(inner, yT + drop);
          ctx.lineTo(outer, yT + drop);
          ctx.lineTo(notch, bannerY + drop);
          ctx.lineTo(outer, yB + drop);
          ctx.lineTo(inner, yB + drop);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = PALETTE.goldDark;
          ctx.beginPath();
          ctx.moveTo(edge, yB);
          ctx.lineTo(inner, yB);
          ctx.lineTo(inner, yB + drop);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // Cuerpo del banner
        ctx.fillStyle = PALETTE.cream;
        ctx.lineWidth = lw(3.8);
        ctx.beginPath();
        ctx.roundRect(xL, yT, bw, bh, 9 * s);
        ctx.fill();
        ctx.stroke();

        // Costura punteada
        ctx.save();
        ctx.globalAlpha *= 0.7;
        ctx.setLineDash([3.5 * s, 3.5 * s]);
        ctx.strokeStyle = PALETTE.goldRim;
        ctx.lineWidth = lw(1.5);
        ctx.beginPath();
        ctx.roundRect(xL + 4 * s, yT + 4 * s, bw - 8 * s, bh - 8 * s, 6 * s);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, bannerY + s);

        drawSparkle(cx - (bw / 2 + 34 * s), bannerY + 2 * s, 9.5 * s, weight, 0.4);
        drawSparkle(cx + (bw / 2 + 34 * s), bannerY + 2 * s, 9.5 * s, weight, 2.2);
      });
      ctx.restore();
    };

    const drawStorm = (weight: number) => {
      const { cx, cy, S, tSec, motion } = F;
      const s = S;
      const drift = Math.sin(tSec * 0.7) * 3 * s * motion;
      const clouds = [
        { x: cx - 98 * s + drift, y: cy - 104 * s },
        { x: cx + 94 * s - drift, y: cy - 94 * s },
      ];

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Lluvia que cae (detrás de las nubes)
      const range = 130 * s;
      for (const d of raindrops) {
        const c = clouds[d.side === -1 ? 0 : 1];
        const p = motion ? (d.phase + tSec * d.speed) % 1 : d.phase;
        const fade = Math.sin(p * Math.PI);
        const x = c.x + d.xOff * s - p * range * 0.15;
        const y = c.y + 14 * s + p * range;
        ctx.globalAlpha = weight * 0.85 * fade;

        if (d.teardrop) {
          ctx.fillStyle = PALETTE.cream;
          ctx.strokeStyle = PALETTE.inkSoft;
          ctx.lineWidth = lw(2.4);
          ctx.beginPath();
          ctx.moveTo(x + 2 * s, y - 8 * s);
          ctx.bezierCurveTo(x + 6 * s, y - s, x + 5 * s, y + 5 * s, x, y + 5 * s);
          ctx.bezierCurveTo(x - 5 * s, y + 5 * s, x - 5 * s, y - s, x + 2 * s, y - 8 * s);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.strokeStyle = PALETTE.inkSoft;
          ctx.lineWidth = lw(3);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 4 * s, y + 13 * s);
          ctx.stroke();
        }
      }

      for (const c of clouds) drawCloud(c.x, c.y, s * 0.95, weight);

      // Ráfagas de viento con remolino y trazo animado
      ctx.globalAlpha = weight * 0.85;
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.lineWidth = lw(3.4);
      ctx.setLineDash([26 * s, 9 * s]);
      ctx.lineDashOffset = -tSec * 36 * s * motion;

      ctx.beginPath();
      ctx.moveTo(cx - 115 * s, cy - 42 * s);
      ctx.quadraticCurveTo(cx - 65 * s, cy - 52 * s, cx - 45 * s, cy - 36 * s);
      ctx.arc(cx - 45 * s, cy - 44 * s, 8 * s, Math.PI / 2, Math.PI / 2 - Math.PI * 1.5, true);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + 45 * s, cy + 82 * s);
      ctx.quadraticCurveTo(cx + 85 * s, cy + 92 * s, cx + 112 * s, cy + 74 * s);
      ctx.arc(cx + 112 * s, cy + 66 * s, 8 * s, Math.PI / 2, Math.PI / 2 - Math.PI * 1.5, true);
      ctx.stroke();

      ctx.restore();
    };

    const drawHeartFinale = (weight: number, inner: Bounds, s: number) => {
      const { cx, cy, unit, beat, tSec, motion, nowMs } = F;
      const table = boilTables[F.boilFrame];

      ctx.save();
      ctx.globalAlpha = weight;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineCap = 'round';
      ctx.lineWidth = lw(3.8);

      // Rayos de resplandor que laten con el corazón
      const rayAngles = [-Math.PI * 0.82, -Math.PI * 0.65, -Math.PI * 0.35, -Math.PI * 0.18, Math.PI * 0.15, Math.PI * 0.85];
      ctx.beginPath();
      rayAngles.forEach((ang, i) => {
        const r1 = unit * 1.05;
        const r2 = r1 + unit * (0.12 + (i % 2) * 0.05 + 0.035 * beat);
        const [jx, jy] = table[(i * 19) % table.length];
        ctx.moveTo(cx + Math.cos(ang) * r1 + jx, cy + Math.sin(ang) * r1 + jy);
        ctx.lineTo(cx + Math.cos(ang) * r2 - jx * 0.5, cy + Math.sin(ang) * r2 - jy * 0.5);
      });
      ctx.stroke();

      drawSparkle(cx - unit * 0.92, cy - unit * 0.55, 11 * s, weight, 0.8);
      drawSparkle(cx + unit * 0.92, cy - unit * 0.55, 11 * s, weight, 2.6);

      // Corazoncitos que flotan
      const floatXs = [-1.18, 1.2, 1.1];
      const floatSpeeds = [0.22, 0.27, 0.19];
      for (let j = 0; j < floatXs.length; j++) {
        const p = motion ? (tSec * floatSpeeds[j] + j * 0.37) % 1 : 0.3 + j * 0.2;
        const life = Math.sin(p * Math.PI);
        const hx = cx + floatXs[j] * unit + Math.sin(p * Math.PI * 2 + j) * 6 * s;
        const hy = cy - unit * 0.15 - p * unit * 0.75;
        ctx.globalAlpha = weight * life * 0.95;
        ctx.fillStyle = PALETTE.gold;
        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = lw(2.4);
        ctx.beginPath();
        traceMiniHeart(hx, hy, 6.5 * s * (0.8 + 0.3 * life));
        ctx.fill();
        ctx.stroke();
      }

      // Estallido de chispas al completarse el corazón
      const age = (nowMs - heartBurstStartMs) / 1000;
      if (motion && age >= 0 && age < HEART_BURST_S) {
        const bp = easeOutCubic(age / HEART_BURST_S);
        const fade = 1 - age / HEART_BURST_S;
        for (const pt of burstParticles) {
          const dist = unit * (0.7 + bp * 0.6 * pt.reach);
          const px = cx + Math.cos(pt.angle) * dist;
          const py = cy + Math.sin(pt.angle) * dist * 0.92;
          if (pt.sparkle) {
            drawSparkle(px, py, 6 * s * (1 - bp * 0.4), weight * fade, pt.angle);
          } else {
            ctx.globalAlpha = weight * fade;
            ctx.fillStyle = PALETTE.gold;
            ctx.strokeStyle = PALETTE.ink;
            ctx.lineWidth = lw(2);
            ctx.beginPath();
            ctx.arc(px, py, 3 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // "Olga ♥": el ♥ es un trazo vectorial (evita el emoji rojo en iOS)
      const label = 'Olga';
      let fontSize = 22 * s;
      const setFont = () => {
        ctx.font = `italic 600 ${Math.round(fontSize)}px "Fraunces", "Playfair Display", Georgia, serif`;
      };
      const measureTotal = () => {
        const textW = ctx.measureText(label).width;
        return { textW, total: textW + fontSize * 0.26 + fontSize * 0.34 * 2.6 };
      };
      setFont();
      let { textW, total } = measureTotal();
      const maxW = inner.w * 1.05;
      if (maxW > 0 && total > maxW) {
        fontSize = Math.max(14 * s, fontSize * (maxW / total));
        setFont();
        ({ textW, total } = measureTotal());
      }

      const glyphSize = fontSize * 0.34;
      const startX = cx - total / 2;
      const ty = cy + 4 * s;
      const textPop = 0.92 + 0.08 * easeOutBack(smoothstep(0.3, 1, weight));

      ctx.globalAlpha = weight * smoothstep(0.3, 1, weight);
      withPop(cx, ty, textPop, () => {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = PALETTE.cream;
        ctx.lineWidth = fontSize * 0.2;
        ctx.strokeText(label, startX, ty);
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(label, startX, ty);

        const hx = startX + textW + fontSize * 0.26 + glyphSize * 1.3;
        const glyphBeat = 1 + 0.12 * beat * motion;
        ctx.beginPath();
        traceMiniHeart(hx, ty + fontSize * 0.02, glyphSize * glyphBeat);
        ctx.strokeStyle = PALETTE.cream;
        ctx.lineWidth = fontSize * 0.2;
        ctx.stroke();
        ctx.fillStyle = PALETTE.ink;
        ctx.fill();
      });

      ctx.restore();
    };

    const drawBraceletScene = () => {
      const { cx, cy, unit, S, swayPhase, beat, motion } = F;
      // Esperamos a que el casco y la vela de la escena 1 se desvanezcan antes de mostrar la manilla
      const stageAlpha = smoothBracelet * (1 - smoothstep(0.25, 0.85, smoothBirthday));
      const m = smoothMorph;
      const beatScale = 1 + smoothHeart * 0.045 * beat;
      const s = S * beatScale;
      const R = unit * beatScale;
      const sketch = easeInOutSine(sketchAnimRef.current);
      const table = boilTables[F.boilFrame];

      const base = sampleBraceletToHeartPoints(SAMPLE_POINTS, R, m);
      const n = base.length;

      // Dos hebras trenzadas; al acercarse al corazón (m → 1) la trenza se asienta
      const braidAmp = (1 - m * 0.78) * 5.2 * s;
      const strandA: Point2D[] = [];
      const strandB: Point2D[] = [];
      const normals: Point2D[] = [];
      const tangents: Point2D[] = [];
      for (let i = 0; i < n; i++) {
        const prev = base[(i - 1 + n) % n];
        const next = base[(i + 1) % n];
        const pt = base[i];
        const dx = next.x - prev.x; // diferencia central: normales más suaves
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const tx = dx / len;
        const ty = dy / len;
        const nx = -ty;
        const ny = tx;
        const off = Math.sin((i / n) * Math.PI * 2 * 14) * braidAmp;
        strandA.push({ x: pt.x + nx * off, y: pt.y + ny * off });
        strandB.push({ x: pt.x - nx * off, y: pt.y - ny * off });
        normals.push({ x: nx, y: ny });
        tangents.push({ x: tx, y: ty });
      }

      const cordProgress = clamp(sketch * 1.15, 0, 1);

      ctx.save();

      // 1. Cuerpo del corazón con lavado dorado
      if (m > 0.12) {
        drawHandStroke(strandA, cx, cy, {
          progress: 1,
          fill: PALETTE.wash,
          stroke: PALETTE.ink,
          width: lw(5),
          alpha: stageAlpha * smoothstep(0.12, 0.7, m),
          penTip: false,
          scale: s,
        });
        if (m > 0.5) drawHeartShading(strandA, stageAlpha * smoothstep(0.5, 0.95, m));
      }

      // 2. Cuerpo del cordón (relleno dorado bajo las hebras)
      const cordAlpha = stageAlpha * (1 - m);
      if (cordAlpha > 0.02) {
        drawHandStroke(base, cx, cy, {
          progress: cordProgress,
          stroke: PALETTE.goldMid,
          width: braidAmp * 2 + 3 * s,
          alpha: cordAlpha * 0.6,
          doubleInk: false,
          penTip: false,
        });
      }

      // 3. Hebras B (oro profundo) y A (tinta), dibujándose en tiempo real
      drawHandStroke(strandB, cx, cy, {
        progress: cordProgress,
        stroke: PALETTE.goldDark,
        width: 6.8 * s * (1 - m * 0.35),
        alpha: stageAlpha * (1 - m * 0.4),
        penTip: false,
      });
      drawHandStroke(strandA, cx, cy, {
        progress: cordProgress,
        stroke: PALETTE.ink,
        width: lw(4.8),
        alpha: stageAlpha,
        scale: s,
      });

      // 4. Marcas de torsión del cordón
      if (m < 0.6 && cordProgress > 0.02) {
        const crossings = 28;
        const w = braidAmp + 1.5 * s;
        ctx.save();
        ctx.globalAlpha = stageAlpha * (1 - m / 0.6) * 0.75;
        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = lw(2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let c = 0; c < crossings; c++) {
          const idx = Math.round(((c + 0.5) / crossings) * n) % n;
          if (idx / n > cordProgress - 0.01) continue;
          const pt = base[idx];
          const nr = normals[idx];
          const tg = tangents[idx];
          const [jx, jy] = table[idx % table.length];
          const px = cx + pt.x + jx * 0.6;
          const py = cy + pt.y + jy * 0.6;
          ctx.moveTo(px - nr.x * w - tg.x * w * 0.55, py - nr.y * w - tg.y * w * 0.55);
          ctx.lineTo(px + nr.x * w + tg.x * w * 0.55, py + nr.y * w + tg.y * w * 0.55);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 5. Nudos corredizos y colas con cuenta (se mecen; más con la tormenta)
      const knotProgress = clamp((sketch - 0.35) / 0.45, 0, 1);
      if (m < 0.92 && knotProgress > 0.02) {
        const kAlpha = stageAlpha * (1 - m * 0.88);
        for (const side of [-1, 1]) {
          const knotIdx = side === -1 ? Math.floor(n * 0.25) : Math.floor(n * 0.75);
          const { x: kx, y: ky } = base[knotIdx];
          const sw = Math.sin(swayPhase * 0.8 + side * 1.3) * 3 * s * motion * (1 + smoothStorm * 1.5);

          const tail: Point2D[] = [
            { x: kx, y: ky },
            { x: kx + side * 12 * s + sw * 0.3, y: ky + 12 * s },
            { x: kx + side * 21 * s + sw * 0.6, y: ky + 27 * s },
            { x: kx + side * 19 * s + sw * 0.85, y: ky + 38 * s },
            { x: kx + side * 14 * s + sw, y: ky + 46 * s },
          ];
          drawHandStroke(tail, cx, cy, {
            progress: knotProgress,
            stroke: PALETTE.ink,
            width: lw(6.4),
            alpha: kAlpha,
            closed: false,
            stride: 23,
            doubleInk: false,
            scale: s,
          });
          drawHandStroke(tail, cx, cy, {
            progress: knotProgress,
            stroke: PALETTE.gold,
            width: lw(3),
            alpha: kAlpha,
            closed: false,
            stride: 23,
            doubleInk: false,
            penTip: false,
          });

          if (knotProgress > 0.75) {
            ctx.save();
            ctx.globalAlpha = kAlpha * smoothstep(0.75, 1, knotProgress);
            ctx.strokeStyle = PALETTE.ink;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Cuenta al final de la cola
            const bx = cx + kx + side * 14 * s + sw;
            const by = cy + ky + 51 * s;
            ctx.fillStyle = PALETTE.gold;
            ctx.lineWidth = lw(3.8);
            ctx.beginPath();
            ctx.arc(bx, by, 6.8 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = PALETTE.cream;
            ctx.beginPath();
            ctx.arc(bx - 2.2 * s, by - 2.4 * s, 1.9 * s, 0, Math.PI * 2);
            ctx.fill();

            // Vueltas del nudo
            ctx.fillStyle = PALETTE.goldMid;
            ctx.lineWidth = lw(3.2);
            for (const kOffset of [-4, 0, 4]) {
              ctx.beginPath();
              ctx.roundRect(cx + kx - 9 * s, cy + ky + kOffset * s - 3.5 * s, 18 * s, 7 * s, 3.5 * s);
              ctx.fill();
              ctx.stroke();
            }
            ctx.strokeStyle = PALETTE.shine;
            ctx.lineWidth = lw(1.6);
            ctx.beginPath();
            for (const kOffset of [-4, 0, 4]) {
              ctx.moveTo(cx + kx - 5 * s, cy + ky + kOffset * s - 1.2 * s);
              ctx.lineTo(cx + kx - 0.5 * s, cy + ky + kOffset * s - 1.2 * s);
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 6. Dije de trébol (→ corazón interior) con argolla y conector
      const cloverProgress = clamp((sketch - 0.25) / 0.75, 0, 1);
      const b0 = base[0];
      const charmSway = (1 - m) * Math.sin(swayPhase) * (0.08 + smoothStorm * 0.14) * motion;
      const ringX = cx + b0.x;
      const ringY = cy + b0.y + 8 * s;
      const charmFade = stageAlpha * (1 - m);

      if (m < 0.9 && cloverProgress > 0.1) {
        ctx.save();
        ctx.globalAlpha = charmFade * smoothstep(0.1, 0.4, cloverProgress);
        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = lw(6.2);
        ctx.beginPath();
        ctx.ellipse(ringX, ringY, 5.5 * s, 8.5 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = lw(2.6);
        ctx.stroke();
        ctx.restore();
      }

      const clover = sampleCloverToHeartPoints(SAMPLE_POINTS, R, m);
      const cb = getBounds(clover);

      ctx.save();
      const pivotX = ringX;
      const pivotY = cy + b0.y + 12 * s;
      ctx.translate(pivotX, pivotY);
      ctx.rotate(charmSway);
      ctx.translate(-pivotX, -pivotY);

      // Conector argolla → trébol
      if (m < 0.9 && cloverProgress > 0.15) {
        const fromY = ringY + 8 * s;
        const topY = cy + cb.minY;
        if (topY > fromY + 1) {
          ctx.save();
          ctx.globalAlpha = charmFade * smoothstep(0.15, 0.45, cloverProgress);
          ctx.lineCap = 'round';
          ctx.strokeStyle = PALETTE.ink;
          ctx.lineWidth = lw(5);
          ctx.beginPath();
          ctx.moveTo(ringX, fromY);
          ctx.lineTo(cx + cb.cx, topY + 2 * s);
          ctx.stroke();
          ctx.strokeStyle = PALETTE.gold;
          ctx.lineWidth = lw(2);
          ctx.stroke();
          ctx.restore();
        }
      }

      drawHandStroke(clover, cx, cy, {
        progress: cloverProgress,
        fill: PALETTE.gold,
        stroke: PALETTE.ink,
        width: lw(4.4),
        alpha: stageAlpha,
        scale: s,
      });

      // Nervaduras, centro, tallo y brillos de las hojas
      if (m < 0.85 && cloverProgress > 0.55) {
        const detailAlpha = stageAlpha * (1 - m / 0.85) * smoothstep(0.55, 0.95, cloverProgress);
        const ccY = cy + lerp(R * 0.56, 0, m);
        const veinLen = 19 * s;

        ctx.save();
        ctx.globalAlpha = detailAlpha;
        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = lw(3.4);
        ctx.lineCap = 'round';

        for (let leaf = 0; leaf < 4; leaf++) {
          const ang = (leaf * Math.PI) / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(cx, ccY);
          ctx.quadraticCurveTo(
            cx + Math.cos(ang + 0.15) * veinLen * 0.55,
            ccY + Math.sin(ang + 0.15) * veinLen * 0.55,
            cx + Math.cos(ang) * veinLen,
            ccY + Math.sin(ang) * veinLen
          );
          ctx.stroke();

          // Brillo pequeño en cada hoja
          const lx = cx + Math.cos(ang) * veinLen * 0.95;
          const ly = ccY + Math.sin(ang) * veinLen * 0.95;
          ctx.save();
          ctx.globalAlpha = detailAlpha * 0.85;
          ctx.strokeStyle = PALETTE.shine;
          ctx.lineWidth = lw(2.2);
          ctx.beginPath();
          ctx.arc(lx - 2.5 * s, ly - 2.5 * s, 4 * s, Math.PI * 1.05, Math.PI * 1.5);
          ctx.stroke();
          ctx.restore();
        }

        ctx.fillStyle = PALETTE.cream;
        ctx.beginPath();
        ctx.arc(cx, ccY, 4.8 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.lineWidth = lw(3.8);
        ctx.beginPath();
        ctx.moveTo(cx, ccY + 6 * s);
        ctx.quadraticCurveTo(cx + 5 * s, ccY + 34 * s, cx + 15 * s, ccY + 45 * s);
        ctx.stroke();
        ctx.restore();
      }

      // Brillo del corazón interior cuando el trébol ya es corazón
      if (m > 0.6) {
        const a = stageAlpha * smoothstep(0.6, 1, m) * 0.85;
        const hx = cx + cb.minX + cb.w * 0.3;
        const hy = cy + cb.minY + cb.h * 0.3;
        const hr = Math.min(cb.w, cb.h) * 0.12;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = PALETTE.shine;
        ctx.lineWidth = lw(3.6);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(hx, hy, hr, Math.PI * 1.02, Math.PI * 1.42);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      ctx.restore();
      return { innerBounds: cb, s };
    };

    // ─────────────────────────────────────────────────────────────────────
    // Render principal
    // ─────────────────────────────────────────────────────────────────────
    const renderScene = (nowMs: number) => {
      rafId = 0;
      if (disposed || width <= 0 || height <= 0) return;

      const dt = clamp((nowMs - lastFrameMs) / 1000, 0.008, 0.064);
      lastFrameMs = nowMs;
      const tSec = nowMs / 1000;
      const target = stateRef.current;
      const motion = reducedMotion ? 0 : 1;
      const sinceBurstS = Math.max(0, (nowMs - burstStartMs) / 1000);

      // Suavizado independiente del framerate (instantáneo con reduced motion)
      const k =
        reducedMotion || sinceBurstS >= 1.35 ? 1 : 1 - Math.exp(-dt * SMOOTHING_RATE);
      smoothMorph = lerp(smoothMorph, target.braceletToHeartMorph, k);
      smoothBirthday = lerp(smoothBirthday, target.birthdaySceneWeight, k);
      smoothBracelet = lerp(smoothBracelet, target.braceletSceneWeight, k);
      smoothNov = lerp(smoothNov, target.novemberSceneWeight, k);
      smoothStorm = lerp(smoothStorm, target.stormSceneWeight, k);
      smoothHeart = lerp(smoothHeart, target.heartSceneWeight, k);

      // Secuencia limpia Escena 1 → Escena 2:
      // Mientras estamos en la Escena 1 y la manilla es invisible, mantenemos el progreso de dibujo en 0.02.
      // Al pasar a la Escena 2, esperamos a que el casco/vela se desvanezcan (smoothBirthday < 0.45)
      // y dibujamos la manilla una única vez de 0.02 a 1.0 sin reinicios intermedios.
      if (target.braceletSceneWeight <= 0.01 && smoothBracelet <= 0.02) {
        sketchAnimRef.current = 0.02;
      } else if (target.braceletSceneWeight > 0.01 && sketchAnimRef.current < 1 && smoothBirthday < 0.45) {
        const timeSketch = clamp((sinceBurstS - 0.12) / SKETCH_DURATION_S, 0.02, 1);
        sketchAnimRef.current = reducedMotion
          ? 1
          : Math.min(1, Math.max(sketchAnimRef.current + dt / SKETCH_DURATION_S, timeSketch));
      }

      if (smoothHeart > 0.65 && heartBurstArmed) {
        heartBurstArmed = false;
        heartBurstStartMs = nowMs;
      } else if (smoothHeart < 0.2) {
        heartBurstArmed = true;
      }

      const cx = width * 0.5;
      const cy = height * 0.5;
      const unit = Math.min(width, height) * 0.34;
      const beat = reducedMotion ? 0 : heartbeat(tSec);

      F = {
        cx,
        cy,
        unit,
        S: unit / 110,
        boilFrame: reducedMotion ? 0 : Math.floor(nowMs / BOIL_INTERVAL_MS) % BOIL_FRAMES,
        swayPhase: tSec * 3.6,
        tSec,
        nowMs,
        beat,
        motion,
      };

      // Rebote elástico al tocar
      const tapSince = (nowMs - tapStartRef.current) / 1000;
      const tapBump =
        motion && tapSince >= 0 && tapSince < TAP_BOUNCE_MS / 1000
          ? 0.045 * Math.exp(-tapSince * 7) * Math.sin(tapSince * 22)
          : 0;

      // ── Capa de ilustración ──
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, layer.width, layer.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (tapBump !== 0) {
        ctx.translate(cx, cy);
        ctx.scale(1 + tapBump, 1 - tapBump * 0.6);
        ctx.translate(-cx, -cy);
      }

      if (smoothBirthday > 0.01) drawBirthdayScene(smoothBirthday);

      if (smoothBracelet > 0.01) {
        const { innerBounds, s } = drawBraceletScene();
        if (smoothNov > 0.02) drawNovemberBanner(smoothNov);
        if (smoothStorm > 0.02) drawStorm(smoothStorm);
        if (smoothHeart > 0.1) drawHeartFinale(smoothHeart, innerBounds, s);
      }
      ctx.restore();

      // ── Composición final: aura cálida + sombra de impresión ──
      mainCtx.setTransform(1, 0, 0, 1, 0, 0);
      mainCtx.clearRect(0, 0, canvas.width, canvas.height);
      mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const auraA =
        0.16 * smoothBracelet * (1 - smoothHeart) +
        0.32 * smoothHeart * (0.85 + 0.15 * beat) +
        0.1 * smoothBirthday;
      if (auraA > 0.01) {
        const aura = mainCtx.createRadialGradient(cx, cy, unit * 0.1, cx, cy, unit * 1.45);
        aura.addColorStop(0, `rgba(243, 223, 157, ${auraA.toFixed(3)})`);
        aura.addColorStop(0.6, `rgba(230, 193, 90, ${(auraA * 0.35).toFixed(3)})`);
        aura.addColorStop(1, 'rgba(230, 193, 90, 0)');
        mainCtx.fillStyle = aura;
        mainCtx.fillRect(0, 0, width, height);
      }

      mainCtx.setTransform(1, 0, 0, 1, 0, 0);
      mainCtx.save();
      mainCtx.shadowColor = 'rgba(140, 101, 27, 0.22)';
      mainCtx.shadowOffsetY = 3 * dpr;
      mainCtx.shadowBlur = 6 * dpr;
      mainCtx.drawImage(layer, 0, 0);
      mainCtx.restore();

      // ── Programación del siguiente frame ──
      const sketchPending = target.braceletSceneWeight > 0.01 ? 1 - sketchAnimRef.current : 0;
      const delta =
        Math.abs(smoothMorph - target.braceletToHeartMorph) +
        Math.abs(smoothBirthday - target.birthdaySceneWeight) +
        Math.abs(smoothBracelet - target.braceletSceneWeight) +
        Math.abs(smoothNov - target.novemberSceneWeight) +
        Math.abs(smoothStorm - target.stormSceneWeight) +
        Math.abs(smoothHeart - target.heartSceneWeight) +
        sketchPending;

      const burstActive = (nowMs - heartBurstStartMs) / 1000 < HEART_BURST_S;
      const tapActive = nowMs - tapStartRef.current < TAP_BOUNCE_MS;
      const busy =
        (delta >= SETTLE_EPSILON || burstActive || tapActive || sinceBurstS < 0.6) &&
        sinceBurstS < 1.45;

      if (!isVisible || disposed) return;
      if (busy) {
        rafId = window.requestAnimationFrame(renderScene);
      } else if (!reducedMotion) {
        // Reposo vivo: boil, llama, dije y latido siguen animando a 24 fps
        timeoutId = window.setTimeout(() => {
          timeoutId = 0;
          if (!disposed && isVisible) renderScene(performance.now());
        }, IDLE_FRAME_MS);
      }
    };

    const cancelPending = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (timeoutId) window.clearTimeout(timeoutId);
      rafId = 0;
      timeoutId = 0;
    };

    const scheduleRender = () => {
      burstStartMs = performance.now();
      if (disposed || !isVisible || rafId) return;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = 0;
      }
      rafId = window.requestAnimationFrame(renderScene);
    };

    wakeUpRef.current = scheduleRender;

    const updateVisibility = () => {
      const next = inViewport && pageVisible;
      if (next && !isVisible) {
        isVisible = true;
        lastFrameMs = performance.now();
        scheduleRender();
      } else if (!next && isVisible) {
        isVisible = false;
        cancelPending();
      }
    };

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width || 360;
      height = rect.height || 320;
      const pw = Math.round(width * dpr);
      const ph = Math.round(height * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        layer.width = pw;
        layer.height = ph;
      }
      scheduleRender();
    };

    // ── Observadores y listeners ──
    updateSize();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener('resize', updateSize);

    const intersectionObserver =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            inViewport = entry?.isIntersecting ?? true;
            updateVisibility();
          })
        : null;
    intersectionObserver?.observe(canvas);

    const onVisibilityChange = () => {
      pageVisible = document.visibilityState !== 'hidden';
      updateVisibility();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
      scheduleRender();
    };
    motionQuery?.addEventListener?.('change', onMotionChange);

    // Repintar cuando carguen las fuentes del texto
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => {
      if (!disposed) scheduleRender();
    });
    fonts?.addEventListener?.('loadingdone', scheduleRender);

    return () => {
      disposed = true;
      cancelPending();
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', updateSize);
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionQuery?.removeEventListener?.('change', onMotionChange);
      fonts?.removeEventListener?.('loadingdone', scheduleRender);
      wakeUpRef.current = null;
    };
  }, []);

  const interactive = Boolean(onCanvasTap);

  const handleActivate = useCallback(() => {
    tapStartRef.current = performance.now();
    wakeUpRef.current?.();
    onCanvasTap?.();
  }, [onCanvasTap]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    },
    [interactive, handleActivate]
  );

  return (
    <div className="relative flex items-center justify-center w-full select-none">
      <canvas
        ref={canvasRef}
        data-testid="procedural-canvas"
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        tabIndex={interactive ? 0 : -1}
        role={interactive ? 'button' : 'img'}
        aria-label="Ilustración animada a mano: la manilla con dije de trébol dibujándose y transformándose en un corazón para Helga (Olga)"
        className={[
          'w-[310px] max-w-full h-[clamp(150px,38svh,270px)] sm:w-[420px] sm:h-[340px] touch-manipulation rounded-2xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5922A]/60 focus-visible:ring-offset-4',
          interactive ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
      />
    </div>
  );
};
