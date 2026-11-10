export interface Point2D {
  x: number;
  y: number;
}

export interface NarrativeChapter {
  id: string;
  title: string;
  lines: string[];
  /** Escena final que solo muestra el cierre de la carta (sin título ni párrafos) */
  isClosing?: boolean;
}

export interface PianoTrack {
  id: string;
  youtubeId: string;
  fallbackYoutubeId: string;
  title: string;
  composer: string;
  tempoBpm: number;
  baseScaleFreqs: number[];
}

export interface NarrativeComputedState {
  progress: number;
  activeChapterIndex: number;
  chapterLocalProgress: number;
  /** 0 = Bracelet with dangling 4-leaf clover charm, 1 = Unified Heart */
  braceletToHeartMorph: number;
  /** 0..1 progressive stroke drawing factor as the bracelet/scene is sketched in real time */
  braceletStrokeDrawProgress: number;
  /** Scene 0 weight: Helga Viking hat & birthday candle */
  birthdaySceneWeight: number;
  /** Scene 1..4 weight: The bracelet & dangling clover charm */
  braceletSceneWeight: number;
  /** Scene 2 weight: November 15 hand-lettered note */
  novemberSceneWeight: number;
  /** Scene 3 weight: Hard times / distance rain */
  stormSceneWeight: number;
  /** Scene 4 weight: The completed beating Heart */
  heartSceneWeight: number;
}

/**
 * Only song: "Futile Devices" (Sufjan Stevens - Doveman Piano Mix / Original)
 * Plays invisibly in the background with no video shown on screen.
 */
export const FUTILE_DEVICES_TRACK: PianoTrack = {
  id: 'futile-devices',
  youtubeId: 'UEBPTUbpLoY',
  fallbackYoutubeId: 'RaKXCrogzfk',
  title: 'Futile Devices',
  composer: 'Sufjan Stevens',
  tempoBpm: 56,
  // Db major / F# major warm piano voicings matching Futile Devices
  baseScaleFreqs: [277.18, 311.13, 349.23, 369.99, 415.3, 466.16, 523.25, 554.37],
};

export const PIANO_TRACKS: PianoTrack[] = [FUTILE_DEVICES_TRACK];

export const LETTER_CHAPTERS: NarrativeChapter[] = [
  {
    id: 'escena-1',
    title: 'Feliz cumpleaños, mi Helga',
    lines: [
      'Eras Helga por molestar, como la esposa de Olafo el Amargado, porque eres la que hacía que lo momentos no fueran tan amargos.',
      'Hoy es tu cumpleaños y no quería dejar pasar el día sin hacerte esto.',
    ],
  },
  {
    id: 'escena-2',
    title: 'Hace un año te di esta manilla',
    lines: [
      'Un trébol pequeño para desearte suerte.',
      'Sin saberlo, ahí empezó la mía.',  
      'Fue es ese momento que nos empezamos a acercar de verdad.',
    ],
  },
  {
    id: 'escena-3',
    title: 'El 15 de noviembre',
    lines: [
      'Unos días después, el 15 de noviembre, nos hicimos amorcitos.',
      'Todavía me acuerdo de lo bonito que se sintió empezar a estar juntos.',
    ],
  },
  {
    id: 'escena-4',
    title: 'Sé que ahorita nos cuesta',
    lines: [
      'Sé que estamos pasando por problemas y siento como si ya no me quisieras más.',
      'Hoy llueve entre nosotros, pero me recuerda que también llovía la vez de nuetro primero beso.',
    ],
  },
  {
    id: 'escena-5',
    title: 'Lo que todavía sentimos',
    lines: [
      'Solo quería recordarte todo lo que nos unió desde aquella manilla y aquel trébol.',
      'Yo te sigo queriendo muchísimo, Olga. Feliz cumpleaños.',
    ],
  },
  {
    id: 'escena-6',
    title: 'Con mucho cariño,',
    lines: ['Fabian'],
    isClosing: true,
  },
];

export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Slices a polyline of points up to `drawProgress` in [0, 1] with sub-segment interpolation,
 * enabling smooth real-time hand-drawing stroke animation.
 */
export function slicePointsByDrawProgress(
  points: Point2D[],
  drawProgress: number
): Point2D[] {
  const p = clamp(drawProgress, 0, 1);
  if (points.length === 0 || p <= 0) return [];
  if (p >= 1 || points.length === 1) return points;

  const exactIndex = p * (points.length - 1);
  const wholeIndex = Math.floor(exactIndex);
  const fraction = exactIndex - wholeIndex;

  const sliced = points.slice(0, wholeIndex + 1);
  if (wholeIndex < points.length - 1 && fraction > 0.001) {
    const a = points[wholeIndex];
    const b = points[wholeIndex + 1];
    sliced.push({
      x: lerp(a.x, b.x, fraction),
      y: lerp(a.y, b.y, fraction),
    });
  }
  return sliced;
}

/**
 * Organic, slightly asymmetric cartoon hand-drawn Heart point.
 */
export function getHeartPoint(tRadians: number, scale: number): Point2D {
  const sinT = Math.sin(tRadians);
  // Subtle hand-drawn asymmetry so the heart looks drawn by a person, not a CAD formula
  const organicWobble = 1 + 0.035 * Math.sin(3 * tRadians + 0.4);
  const x = (16 * sinT * sinT * sinT + 0.6 * Math.sin(2 * tRadians)) * organicWobble;
  const y = -(
    13 * Math.cos(tRadians) -
    5 * Math.cos(2 * tRadians) -
    2 * Math.cos(3 * tRadians) -
    Math.cos(4 * tRadians)
  );
  return {
    x: (x / 16.2) * scale,
    y: ((y + 1.5) / 16.2) * scale,
  };
}

/**
 * Point on an organic hand-sketched cord bracelet ("la manilla") with natural hand-drawn wave.
 */
export function getBraceletPoint(tRadians: number, scale: number): Point2D {
  const angle = tRadians + Math.PI * 0.5;
  // Natural hand-drawn cord irregularity (not a mechanical ellipse)
  const handWaveX = 0.04 * Math.sin(3 * angle + 0.7) + 0.02 * Math.cos(5 * angle);
  const handWaveY = 0.045 * Math.cos(2 * angle - 0.3) + 0.02 * Math.sin(4 * angle);
  return {
    x: (Math.cos(angle) * 1.16 + handWaveX) * scale,
    y: (Math.sin(angle) * 0.52 + handWaveY) * scale - scale * 0.26,
  };
}

/**
 * Point on the dangling 4-leaf clover charm hanging from the bottom of the bracelet.
 */
export function getCloverCharmPoint(tRadians: number, scale: number): Point2D {
  const angle = tRadians + Math.PI / 4;
  const lobe = Math.abs(Math.cos(2 * angle));
  const heartIndent = 0.1 * Math.cos(8 * angle);
  // Hand-drawn organic leaf variation across the 4 clover leaves
  const organicLeaf = 1 + 0.04 * Math.sin(3 * tRadians);
  const r = (0.17 + 0.7 * Math.pow(lobe, 0.52) - heartIndent) * organicLeaf * scale * 0.44;
  return {
    x: Math.cos(tRadians) * r,
    y: Math.sin(tRadians) * r + scale * 0.56,
  };
}

/**
 * Morphs the Bracelet Cord points (morph = 0) into the outer thick contour of the Heart (morph = 1).
 */
export function sampleBraceletToHeartPoints(
  sampleCount: number,
  scale: number,
  morphToHeart: number
): Point2D[] {
  const count = Math.max(8, Math.floor(sampleCount));
  const m = smoothstep(0, 1, clamp(morphToHeart, 0, 1));
  const points: Point2D[] = [];

  for (let i = 0; i < count; i++) {
    const tBracelet = (i / count) * Math.PI * 2;
    const tHeart = tBracelet + Math.PI;
    const bPt = getBraceletPoint(tBracelet, scale);
    const hPt = getHeartPoint(tHeart, scale * 0.98);

    points.push({
      x: lerp(bPt.x, hPt.x, m),
      y: lerp(bPt.y, hPt.y, m),
    });
  }

  return points;
}

/**
 * Morphs the dangling Four-Leaf Clover Charm (morph = 0) into the inner golden heart (morph = 1).
 */
export function sampleCloverToHeartPoints(
  sampleCount: number,
  scale: number,
  morphToHeart: number
): Point2D[] {
  const count = Math.max(8, Math.floor(sampleCount));
  const m = smoothstep(0, 1, clamp(morphToHeart, 0, 1));
  const points: Point2D[] = [];

  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const cPt = getCloverCharmPoint(t, scale);
    const hPt = getHeartPoint(t, scale * 0.52);

    points.push({
      x: lerp(cPt.x, hPt.x, m),
      y: lerp(cPt.y, hPt.y, m),
    });
  }

  return points;
}

/**
 * Computes the 6-scene single-screen narrative state from normalized progress [0, 1].
 */
export function computeNarrativeState(
  rawProgress: number,
  manualMorphOverride: number | null = null
): NarrativeComputedState {
  const progress = clamp(rawProgress, 0, 1);
  const totalChapters = LETTER_CHAPTERS.length; // 6 scenes (0..5)

  const scaled = progress * (totalChapters - 0.0001);
  const activeChapterIndex = clamp(Math.floor(scaled), 0, totalChapters - 1);
  const chapterLocalProgress = clamp(scaled - activeChapterIndex, 0, 1);

  // Las dos últimas escenas (5 y 6) muestran ya el corazón completo
  const autoMorph = activeChapterIndex >= 4 ? 1 : 0;
  const braceletToHeartMorph =
    manualMorphOverride !== null ? clamp(manualMorphOverride, 0, 1) : autoMorph;

  // Progressive real-time stroke drawing factor as the user enters Scene 2 (the bracelet)
  const braceletStrokeDrawProgress =
    activeChapterIndex >= 1 ? smoothstep(0.2, 0.34, Math.max(progress, 0.35)) : 0;

  const birthdaySceneWeight = activeChapterIndex === 0 ? 1 : 0;
  const braceletSceneWeight = activeChapterIndex >= 1 ? 1 : 0;
  const novemberSceneWeight = activeChapterIndex === 2 ? 1 : 0;
  const stormSceneWeight = activeChapterIndex === 3 ? 1 : 0;
  const heartSceneWeight = smoothstep(0.25, 0.95, braceletToHeartMorph);

  return {
    progress,
    activeChapterIndex,
    chapterLocalProgress,
    braceletToHeartMorph,
    braceletStrokeDrawProgress,
    birthdaySceneWeight,
    braceletSceneWeight,
    novemberSceneWeight,
    stormSceneWeight,
    heartSceneWeight,
  };
}

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed) && /[A-Z0-9]/.test(trimmed)) {
    return trimmed;
  }

  const regex =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}
