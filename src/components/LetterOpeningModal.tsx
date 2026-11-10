import React from 'react';
import { Music } from 'lucide-react';

interface LetterOpeningModalProps {
  onOpenWithMusic: () => void;
  onOpenSilent: () => void;
}

export const LetterOpeningModal: React.FC<LetterOpeningModalProps> = ({
  onOpenWithMusic,
  onOpenSilent,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="envelope-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAF6EE] px-6 text-center"
    >
      {/* Hand-drawn double-ink cartoon envelope with golden heart & clover wax seal */}
      <svg
        width="156"
        height="128"
        viewBox="0 0 156 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        onClick={onOpenWithMusic}
        className="mb-5 cursor-pointer"
      >
        {/* Soft hand-sketched ground shadow beneath the envelope */}
        <ellipse cx="78" cy="116" rx="54" ry="6" fill="#C5922A" fillOpacity="0.22" />
        <path
          d="M42 116 L48 114 M58 117 L64 115 M76 117 L82 115 M94 117 L100 115 M110 116 L116 114"
          stroke="#6E5636"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeOpacity="0.45"
        />

        {/* Little sparkles around the envelope */}
        <path
          d="M18 32 Q20 32 21 25 Q22 32 24 32 Q22 32 21 39 Q20 32 18 32 Z"
          fill="#E6C15A"
          stroke="#2B2118"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d="M134 26 Q136 26 137 19 Q138 26 140 26 Q138 26 137 33 Q136 26 134 26 Z"
          fill="#E6C15A"
          stroke="#2B2118"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />

        {/* Envelope body with organic double-ink contour */}
        <rect
          x="20"
          y="24"
          width="116"
          height="78"
          rx="12"
          fill="#FAF3DD"
          stroke="#2B2118"
          strokeWidth="4.2"
          strokeLinejoin="round"
        />
        <rect
          x="21.5"
          y="25.2"
          width="113"
          height="75.5"
          rx="11"
          stroke="#2B2118"
          strokeOpacity="0.28"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />

        {/* Delicate pen hatch lines on lower left corner of envelope */}
        <path
          d="M27 88 L35 83 M27 93 L38 86 M32 96 L42 90"
          stroke="#8C651B"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeOpacity="0.55"
        />

        {/* Bottom envelope fold lines */}
        <path
          d="M23 99 L62 66 M133 99 L94 66"
          stroke="#6E5636"
          strokeOpacity="0.45"
          strokeWidth="2.6"
          strokeLinecap="round"
        />

        {/* Top envelope flap */}
        <path
          d="M22 28 L78 70 L134 28"
          stroke="#2B2118"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M24 30 L78 71.5 L132 30"
          stroke="#2B2118"
          strokeOpacity="0.3"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Golden Heart Wax Seal */}
        <path
          d="M78 82 C78 82, 56 68, 56 54 C56 46, 63 42, 69 45 C73 47, 76 50, 78 54 C80 50, 83 47, 87 45 C93 42, 100 46, 100 54 C100 68, 78 82, 78 82 Z"
          fill="#E6C15A"
          stroke="#2B2118"
          strokeWidth="3.8"
          strokeLinejoin="round"
        />
        {/* Specular highlight inside heart seal */}
        <path
          d="M86 49 C90 48, 94 50, 94 55"
          stroke="#FAF3DD"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Tiny center pearl inside the heart seal */}
        <circle cx="78" cy="61" r="3" fill="#FAF3DD" stroke="#2B2118" strokeWidth="1.8" />
      </svg>

      <h1
        id="envelope-title"
        className="font-signature italic text-4xl sm:text-5xl font-semibold text-[#2B2118] tracking-tight"
      >
        Para Helga, mi Olga
      </h1>

      {/* Hand-drawn dip-pen flourish divider under the title */}
      <svg
        width="132"
        height="16"
        viewBox="0 0 132 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="mt-2"
      >
        <path
          d="M8 8 C28 6, 44 9, 56 8 M76 8 C88 9, 104 6, 124 8"
          stroke="#2B2118"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="66" cy="8" r="3.6" fill="#E6C15A" stroke="#2B2118" strokeWidth="2.2" />
      </svg>

      <p className="mt-3 font-prose text-base sm:text-lg text-[#4A3B2C] max-w-md leading-relaxed">
        Pequeño detalle, pero significa mucho para mí, para ti. Súbele el volumen
      </p>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
        <button
          type="button"
          onClick={onOpenWithMusic}
          className="px-7 py-3 bg-[#E6C15A] text-[#2B2118] border-2 border-[#2B2118] font-medium text-sm sm:text-base hover:bg-[#D9B04C] transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Music className="w-4 h-4" />
          <span>Abrir con piano</span>
        </button>

        <button
          type="button"
          onClick={onOpenSilent}
          className="px-5 py-3 text-sm text-[#5C4A35] hover:text-[#2B2118] underline underline-offset-4 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          Abrir en silencio
        </button>
      </div>
    </div>
  );
};
