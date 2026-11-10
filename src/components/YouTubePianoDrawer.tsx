import React, { useEffect, useRef } from 'react';
import { FUTILE_DEVICES_TRACK } from '../utils/proceduralArtLogic';

interface YouTubePianoDrawerProps {
  isPlaying: boolean;
}

/**
 * Plays ONLY "Futile Devices" (Sufjan Stevens) invisibly in the background
 * via YouTube IFrame API with zero synthetic tones and zero visible video.
 */
export const YouTubePianoDrawer: React.FC<YouTubePianoDrawerProps> = ({
  isPlaying,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const { youtubeId, fallbackYoutubeId } = FUTILE_DEVICES_TRACK;
  const origin =
    typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : '';

  const embedSrc = `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&autoplay=${
    isPlaying ? '1' : '0'
  }&loop=1&playlist=${youtubeId},${fallbackYoutubeId}&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1${
    origin ? `&origin=${origin}` : ''
  }`;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;

    const sendCommand = (func: string, args: unknown[] = []) => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*'
      );
    };

    if (isPlaying) {
      sendCommand('unMute');
      sendCommand('setVolume', [85]);
      sendCommand('playVideo');
      const retryTimer = window.setTimeout(() => {
        sendCommand('unMute');
        sendCommand('playVideo');
      }, 600);
      return () => window.clearTimeout(retryTimer);
    } else {
      sendCommand('pauseVideo');
    }
  }, [isPlaying]);

  if (!isPlaying) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed -left-[9999px] -top-[9999px] w-px h-px opacity-0 pointer-events-none overflow-hidden"
    >
      <iframe
        ref={iframeRef}
        src={embedSrc}
        title="Futile Devices - Sufjan Stevens"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};
