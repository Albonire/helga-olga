import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LETTER_CHAPTERS,
  clamp,
  computeNarrativeState,
} from './utils/proceduralArtLogic';
import { ProceduralGoldCanvas } from './components/ProceduralGoldCanvas';
import { YouTubePianoDrawer } from './components/YouTubePianoDrawer';
import { LetterOpeningModal } from './components/LetterOpeningModal';

export default function App() {
  const isAutostart = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1';
  }, []);

  const [isLetterOpened, setIsLetterOpened] = useState<boolean>(isAutostart);
  const [showSwipeHintScreen, setShowSwipeHintScreen] = useState<boolean>(false);

  // Continuous story progress [0..1] on a single fixed screen (5 scenes)
  const [progress, setProgress] = useState<number>(0);

  // Background music state: ONLY "Futile Devices" plays from YouTube (no secondary synth tones)
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(false);

  const touchStartYRef = useRef<number | null>(null);

  const narrativeState = useMemo(
    () => computeNarrativeState(progress, null),
    [progress]
  );

  const activeChapter =
    LETTER_CHAPTERS[narrativeState.activeChapterIndex] || LETTER_CHAPTERS[0];

  // Auto-dismiss the momentary "Desliza hacia abajo" screen after 2.1 seconds
  useEffect(() => {
    if (!showSwipeHintScreen) return;
    const timer = window.setTimeout(() => {
      setShowSwipeHintScreen(false);
    }, 2100);
    return () => window.clearTimeout(timer);
  }, [showSwipeHintScreen]);

  const goToScene = useCallback((sceneIndex: number) => {
    setShowSwipeHintScreen(false);
    const total = LETTER_CHAPTERS.length;
    const clampedIdx = clamp(sceneIndex, 0, total - 1);
    const targetProgress = clampedIdx === total - 1 ? 0.96 : (clampedIdx + 0.2) / total;
    setProgress(targetProgress);
  }, []);

  const stepNext = useCallback(() => {
    const nextIdx = Math.min(
      LETTER_CHAPTERS.length - 1,
      narrativeState.activeChapterIndex + 1
    );
    goToScene(nextIdx);
  }, [narrativeState.activeChapterIndex, goToScene]);

  const stepPrev = useCallback(() => {
    const prevIdx = Math.max(0, narrativeState.activeChapterIndex - 1);
    goToScene(prevIdx);
  }, [narrativeState.activeChapterIndex, goToScene]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isLetterOpened) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        stepNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        stepPrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLetterOpened, stepNext, stepPrev]);

  const lastStepTimeRef = useRef<number>(0);
  const wheelAccumRef = useRef<number>(0);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isLetterOpened) return;
    if (showSwipeHintScreen) {
      setShowSwipeHintScreen(false);
      lastStepTimeRef.current = performance.now();
      wheelAccumRef.current = 0;
      return;
    }

    const now = performance.now();
    if (now - lastStepTimeRef.current < 650) {
      wheelAccumRef.current = 0;
      return;
    }

    wheelAccumRef.current += e.deltaY;
    if (wheelAccumRef.current >= 42) {
      wheelAccumRef.current = 0;
      lastStepTimeRef.current = now;
      stepNext();
    } else if (wheelAccumRef.current <= -42) {
      wheelAccumRef.current = 0;
      lastStepTimeRef.current = now;
      stepPrev();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (showSwipeHintScreen) {
      setShowSwipeHintScreen(false);
      lastStepTimeRef.current = performance.now();
      touchStartYRef.current = null;
      return;
    }
    if (e.touches.length === 1) {
      touchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null || e.touches.length !== 1) return;
    const now = performance.now();
    if (now - lastStepTimeRef.current < 600) return;

    const currentY = e.touches[0].clientY;
    const dy = touchStartYRef.current - currentY;
    if (dy >= 38) {
      touchStartYRef.current = currentY;
      lastStepTimeRef.current = now;
      stepNext();
    } else if (dy <= -38) {
      touchStartYRef.current = currentY;
      lastStepTimeRef.current = now;
      stepPrev();
    }
  };

  const handleTouchEnd = () => {
    touchStartYRef.current = null;
  };

  const handleOpenWithMusic = () => {
    setIsLetterOpened(true);
    setShowSwipeHintScreen(true);
    setIsMusicPlaying(true);
  };

  const handleOpenSilent = () => {
    setIsLetterOpened(true);
    setShowSwipeHintScreen(true);
    setIsMusicPlaying(false);
  };

  const handleCanvasTap = () => {
    if (showSwipeHintScreen) {
      setShowSwipeHintScreen(false);
      return;
    }
    if (narrativeState.activeChapterIndex < LETTER_CHAPTERS.length - 1) {
      stepNext();
    } else {
      goToScene(0);
    }
  };

  return (
    <div
      data-state={
        !isLetterOpened
          ? 'envelope'
          : showSwipeHintScreen
            ? 'swipe-hint'
            : `scene-${narrativeState.activeChapterIndex + 1}`
      }
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="h-screen w-screen overflow-hidden bg-[#FAF6EE] text-[#2B2118] flex flex-col justify-between px-6 py-8 sm:px-12 sm:py-10 relative"
    >
      {!isLetterOpened && (
        <LetterOpeningModal
          onOpenWithMusic={handleOpenWithMusic}
          onOpenSilent={handleOpenSilent}
        />
      )}

      {/* Momentary "Desliza hacia abajo" screen that appears briefly right after opening */}
      {isLetterOpened && showSwipeHintScreen && (
        <div
          onClick={() => setShowSwipeHintScreen(false)}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#FAF6EE] px-6 text-center cursor-pointer transition-opacity duration-500"
        >
          <svg
            width="64"
            height="84"
            viewBox="0 0 64 84"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="mb-5 animate-bounce"
          >
            <path
              d="M32 12 C31 30, 33 48, 32 68"
              stroke="#2B2118"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <path
              d="M18 54 C24 62, 28 67, 32 71 C36 67, 40 62, 46 54"
              stroke="#2B2118"
              strokeWidth="4.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="32" cy="12" r="4.5" fill="#E6C15A" stroke="#2B2118" strokeWidth="3" />
          </svg>

          <p className="font-signature italic text-3xl sm:text-4xl text-[#2B2118]">
            Desliza hacia abajo
          </p>
          <p className="mt-2 font-prose text-sm sm:text-base text-[#5C4A35]">
            Desliza suavemente para ir viendo cada parte
          </p>
        </div>
      )}

      {/* Invisible background audio player for "Futile Devices" ONLY */}
      <YouTubePianoDrawer isPlaying={isMusicPlaying} />

      {/* Top Dedication Title in expressive Fraunces signature typography */}
      <header className="w-full text-center z-20 pt-1">
        <span className="font-signature italic text-2xl sm:text-3xl font-normal text-[#3D2E1E] tracking-tight">
          Para Helga, mi Olga
        </span>
      </header>

      {/* Center Single-Screen Stage: Organic Hand-Drawn Illustration + Fade-In & Slide-Up Chapter Text */}
      <main className="flex-1 flex flex-col items-center justify-center w-full max-w-xl mx-auto text-center my-auto">
        <ProceduralGoldCanvas
          narrativeState={narrativeState}
          onCanvasTap={handleCanvasTap}
        />

        {/* Keyed by activeChapter.id so every scene change triggers the fade-in & slide-up animation */}
        <div
          key={activeChapter.id}
          aria-live="polite"
          className="mt-3 sm:mt-5 px-2"
        >
          {activeChapter.isClosing ? (
            /* Escena de cierre: la firma manuscrita de la carta, sin más texto */
            <>
              <p className="animate-chapter-title font-prose italic text-sm sm:text-base text-[#6E5636]">
                {activeChapter.title}
              </p>
              <p className="animate-chapter-line-1 mt-1 font-signature italic text-4xl sm:text-5xl text-[#2B2118]">
                {activeChapter.lines[0]}
              </p>

              {/* Divisoria a pluma con punto dorado, como en el sobre */}
              <svg
                width="132"
                height="16"
                viewBox="0 0 132 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="animate-chapter-line-2 mx-auto mt-2"
              >
                <path
                  d="M8 8 C28 6, 44 9, 56 8 M76 8 C88 9, 104 6, 124 8"
                  stroke="#2B2118"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <circle cx="66" cy="8" r="3.6" fill="#E6C15A" stroke="#2B2118" strokeWidth="2.2" />
              </svg>
            </>
          ) : (
            <>
              <h1
                className="animate-chapter-title font-display text-3xl sm:text-4xl font-medium text-[#2B2118]"
                style={{ textWrap: 'balance' }}
              >
                {activeChapter.title}
              </h1>

              <div className="mt-3 space-y-2 text-base sm:text-lg text-[#3D3022] font-prose leading-relaxed">
                {activeChapter.lines.map((line, idx) => (
                  <p
                    key={`${activeChapter.id}-${idx}`}
                    className={idx === 0 ? 'animate-chapter-line-1' : 'animate-chapter-line-2'}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      <div className="h-4" aria-hidden="true" />
    </div>
  );
}
