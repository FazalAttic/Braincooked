/**
 * src/assets/mascots.ts
 * Visual SVG Mascot definitions for each of the 5 Brain Fatigue Stages.
 * Provides raw SVG template strings for zero-latency, CSP-compliant in-memory DOM rendering.
 */

import type { FatigueStage } from '../shared/types';

export const MASCOT_SVGS: Record<FatigueStage, string> = {
  fresh: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-label="Fresh Mind Mascot">
  <defs>
    <filter id="glow-fresh" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <radialGradient id="grad-fresh" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#9AE67C" />
      <stop offset="100%" stop-color="#79D056" />
    </radialGradient>
  </defs>
  <circle cx="60" cy="58" r="46" fill="#79D056" opacity="0.15" filter="url(#glow-fresh)" />
  <path d="M 58 30 C 50 20, 32 22, 26 34 C 18 36, 14 48, 18 60 C 14 70, 22 84, 34 86 C 42 88, 52 84, 58 78 Z"
        fill="url(#grad-fresh)" stroke="#5AA73A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 62 30 C 70 20, 88 22, 94 34 C 102 36, 106 48, 102 60 C 106 70, 98 84, 86 86 C 78 88, 68 84, 62 78 Z"
        fill="url(#grad-fresh)" stroke="#5AA73A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 32 40 C 40 42, 44 48, 42 54 C 40 60, 48 64, 54 62"
        fill="none" stroke="#4F9532" stroke-width="2" stroke-linecap="round" />
  <path d="M 26 58 C 32 60, 36 68, 38 74"
        fill="none" stroke="#4F9532" stroke-width="2" stroke-linecap="round" />
  <path d="M 88 40 C 80 42, 76 48, 78 54 C 80 60, 72 64, 66 62"
        fill="none" stroke="#4F9532" stroke-width="2" stroke-linecap="round" />
  <path d="M 94 58 C 88 60, 84 68, 82 74"
        fill="none" stroke="#4F9532" stroke-width="2" stroke-linecap="round" />
  <path d="M 60 28 L 60 78" fill="none" stroke="#4F9532" stroke-width="2.5" stroke-linecap="round" />
  <g transform="translate(42, 54)">
    <path d="M 0 -5 Q 0 0, 5 0 Q 0 0, 0 5 Q 0 0, -5 0 Q 0 0, 0 -5 Z" fill="#0A0907" />
    <circle cx="2" cy="-2" r="1.5" fill="#FFFFFF" />
  </g>
  <g transform="translate(78, 54)">
    <path d="M 0 -5 Q 0 0, 5 0 Q 0 0, 0 5 Q 0 0, -5 0 Q 0 0, 0 -5 Z" fill="#0A0907" />
    <circle cx="2" cy="-2" r="1.5" fill="#FFFFFF" />
  </g>
  <circle cx="34" cy="62" r="4" fill="#60BD3B" opacity="0.6" />
  <circle cx="86" cy="62" r="4" fill="#60BD3B" opacity="0.6" />
  <path d="M 52 64 Q 60 72, 68 64" fill="none" stroke="#0A0907" stroke-width="2.5" stroke-linecap="round" />
  <g transform="translate(60, 16)" fill="#79D056">
    <path d="M 0 -4 Q 0 0, 4 0 Q 0 0, 0 4 Q 0 0, -4 0 Q 0 0, 0 -4 Z" />
  </g>
  <g transform="translate(22, 22)" fill="#9AE67C">
    <path d="M 0 -3 Q 0 0, 3 0 Q 0 0, 0 3 Q 0 0, -3 0 Q 0 0, 0 -3 Z" />
  </g>
  <g transform="translate(98, 22)" fill="#9AE67C">
    <path d="M 0 -3 Q 0 0, 3 0 Q 0 0, 0 3 Q 0 0, -3 0 Q 0 0, 0 -3 Z" />
  </g>
</svg>`,

  warming: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-label="Warming Up Mascot">
  <defs>
    <radialGradient id="grad-warming" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#FFF3D4" />
      <stop offset="100%" stop-color="#FFE9B4" />
    </radialGradient>
  </defs>
  <path d="M 58 30 C 50 20, 32 22, 26 34 C 18 36, 14 48, 18 60 C 14 70, 22 84, 34 86 C 42 88, 52 84, 58 78 Z"
        fill="url(#grad-warming)" stroke="#D4BE84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 62 30 C 70 20, 88 22, 94 34 C 102 36, 106 48, 102 60 C 106 70, 98 84, 86 86 C 78 88, 68 84, 62 78 Z"
        fill="url(#grad-warming)" stroke="#D4BE84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 32 40 C 40 42, 44 48, 42 54 C 40 60, 48 64, 54 62"
        fill="none" stroke="#C2AB70" stroke-width="2" stroke-linecap="round" />
  <path d="M 26 58 C 32 60, 36 68, 38 74"
        fill="none" stroke="#C2AB70" stroke-width="2" stroke-linecap="round" />
  <path d="M 88 40 C 80 42, 76 48, 78 54 C 80 60, 72 64, 66 62"
        fill="none" stroke="#C2AB70" stroke-width="2" stroke-linecap="round" />
  <path d="M 94 58 C 88 60, 84 68, 82 74"
        fill="none" stroke="#C2AB70" stroke-width="2" stroke-linecap="round" />
  <path d="M 60 28 L 60 78" fill="none" stroke="#C2AB70" stroke-width="2.5" stroke-linecap="round" />
  <path d="M 38 48 L 48 51" fill="none" stroke="#0A0907" stroke-width="2.2" stroke-linecap="round" />
  <path d="M 82 48 L 72 51" fill="none" stroke="#0A0907" stroke-width="2.2" stroke-linecap="round" />
  <circle cx="43" cy="56" r="4.5" fill="#0A0907" />
  <circle cx="45" cy="54" r="1.5" fill="#FFFFFF" />
  <circle cx="77" cy="56" r="4.5" fill="#0A0907" />
  <circle cx="79" cy="54" r="1.5" fill="#FFFFFF" />
  <path d="M 92 46 C 92 46, 96 52, 94 54 C 92 56, 89 54, 89 52 C 89 50, 92 46, 92 46 Z"
        fill="#75C2F6" stroke="#4682B4" stroke-width="1" />
  <path d="M 53 66 Q 60 69, 67 66" fill="none" stroke="#0A0907" stroke-width="2.2" stroke-linecap="round" />
</svg>`,

  tired: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-label="Tired Brain Mascot">
  <defs>
    <radialGradient id="grad-tired" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#FFC88A" />
      <stop offset="100%" stop-color="#FFB367" />
    </radialGradient>
  </defs>
  <path d="M 58 32 C 50 23, 30 25, 24 38 C 16 42, 14 54, 18 66 C 14 76, 24 88, 36 89 C 44 90, 52 84, 58 79 Z"
        fill="url(#grad-tired)" stroke="#D98A3C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 62 32 C 70 23, 90 25, 96 38 C 104 42, 106 54, 102 66 C 106 76, 96 88, 84 89 C 76 90, 68 84, 62 79 Z"
        fill="url(#grad-tired)" stroke="#D98A3C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 30 44 C 38 46, 42 52, 40 58 C 38 64, 46 67, 52 65"
        fill="none" stroke="#C4782A" stroke-width="2" stroke-linecap="round" />
  <path d="M 24 64 C 30 66, 34 74, 38 78"
        fill="none" stroke="#C4782A" stroke-width="2" stroke-linecap="round" />
  <path d="M 90 44 C 82 46, 78 52, 80 58 C 82 64, 74 67, 68 65"
        fill="none" stroke="#C4782A" stroke-width="2" stroke-linecap="round" />
  <path d="M 96 64 C 90 66, 86 74, 82 78"
        fill="none" stroke="#C4782A" stroke-width="2" stroke-linecap="round" />
  <path d="M 60 30 L 60 79" fill="none" stroke="#C4782A" stroke-width="2.5" stroke-linecap="round" />
  <circle cx="42" cy="58" r="4.5" fill="#0A0907" />
  <path d="M 36 57 Q 42 54, 48 58" fill="#FFB367" stroke="#0A0907" stroke-width="1.8" />
  <path d="M 35 55 L 47 57" fill="none" stroke="#0A0907" stroke-width="2" stroke-linecap="round" />
  <circle cx="78" cy="58" r="4.5" fill="#0A0907" />
  <path d="M 72 58 Q 78 54, 84 57" fill="#FFB367" stroke="#0A0907" stroke-width="1.8" />
  <path d="M 73 57 L 85 55" fill="none" stroke="#0A0907" stroke-width="2" stroke-linecap="round" />
  <path d="M 37 64 Q 42 67, 47 64" fill="none" stroke="#C4782A" stroke-width="1.2" stroke-linecap="round" />
  <path d="M 73 64 Q 78 67, 83 64" fill="none" stroke="#C4782A" stroke-width="1.2" stroke-linecap="round" />
  <path d="M 52 71 Q 60 67, 68 71" fill="none" stroke="#0A0907" stroke-width="2.2" stroke-linecap="round" />
  <path d="M 22 52 C 22 52, 26 57, 24 59 C 22 61, 19 59, 19 57 C 19 55, 22 52, 22 52 Z"
        fill="#75C2F6" stroke="#4682B4" stroke-width="1" />
</svg>`,

  drained: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-label="Drained Brain Mascot">
  <defs>
    <radialGradient id="grad-drained" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#FF7278" />
      <stop offset="100%" stop-color="#FC4A52" />
    </radialGradient>
  </defs>
  <path d="M 58 34 C 48 24, 28 26, 22 40 C 14 44, 12 56, 16 68 C 12 78, 22 90, 36 91 C 44 92, 52 86, 58 80 Z"
        fill="url(#grad-drained)" stroke="#C82830" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 62 34 C 72 24, 92 26, 98 40 C 106 44, 108 56, 104 68 C 108 78, 98 90, 84 91 C 76 92, 68 86, 62 80 Z"
        fill="url(#grad-drained)" stroke="#C82830" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 30 36 L 36 44 L 32 50 L 38 56" fill="none" stroke="#660A10" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  <path d="M 90 36 L 84 44 L 88 50 L 82 56" fill="none" stroke="#660A10" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  <path d="M 22 66 C 28 68, 32 76, 36 80"
        fill="none" stroke="#B01D24" stroke-width="2" stroke-linecap="round" />
  <path d="M 98 66 C 92 68, 88 76, 84 80"
        fill="none" stroke="#B01D24" stroke-width="2" stroke-linecap="round" />
  <path d="M 60 32 L 60 80" fill="none" stroke="#B01D24" stroke-width="2.5" stroke-linecap="round" />
  <g stroke="#0A0907" stroke-width="2.5" stroke-linecap="round">
    <line x1="37" y1="53" x2="47" y2="63" />
    <line x1="47" y1="53" x2="37" y2="63" />
  </g>
  <g stroke="#0A0907" stroke-width="2.5" stroke-linecap="round">
    <line x1="73" y1="53" x2="83" y2="63" />
    <line x1="83" y1="53" x2="73" y2="63" />
  </g>
  <path d="M 34 67 Q 42 71, 50 67" fill="none" stroke="#660A10" stroke-width="1.6" stroke-linecap="round" />
  <path d="M 70 67 Q 78 71, 86 67" fill="none" stroke="#660A10" stroke-width="1.6" stroke-linecap="round" />
  <ellipse cx="60" cy="72" rx="6" ry="4" fill="#3D0307" stroke="#0A0907" stroke-width="2" />
  <path d="M 18 50 C 18 50, 22 56, 20 58 C 18 60, 15 58, 15 56 C 15 54, 18 50, 18 50 Z"
        fill="#75C2F6" stroke="#4682B4" stroke-width="1" />
  <path d="M 102 50 C 102 50, 106 56, 104 58 C 102 60, 99 58, 99 56 C 99 54, 102 50, 102 50 Z"
        fill="#75C2F6" stroke="#4682B4" stroke-width="1" />
</svg>`,

  rot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-label="Brain Rot Alert Mascot">
  <defs>
    <radialGradient id="grad-rot" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#BE7BF5" />
      <stop offset="100%" stop-color="#9B51E0" />
    </radialGradient>
  </defs>
  <path d="M 58 36 C 46 22, 26 26, 20 42 C 12 48, 12 62, 16 74 C 18 84, 26 86, 32 86 C 34 94, 38 98, 42 98 C 46 98, 48 90, 52 88 C 56 96, 62 96, 66 88 C 70 98, 76 98, 80 88 C 86 88, 98 88, 102 76 C 108 62, 106 48, 98 42 C 92 26, 72 22, 62 36 Z"
        fill="url(#grad-rot)" stroke="#6C28AB" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="42" cy="104" r="2.5" fill="#9B51E0" stroke="#6C28AB" stroke-width="1" />
  <circle cx="74" cy="105" r="2" fill="#9B51E0" stroke="#6C28AB" stroke-width="1" />
  <path d="M 32 38 L 40 46 L 36 52 L 44 58" fill="none" stroke="#451273" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 88 38 L 80 46 L 84 52 L 76 58" fill="none" stroke="#451273" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 60 34 Q 57 56, 62 76" fill="none" stroke="#6C28AB" stroke-width="2.5" stroke-linecap="round" />
  <path d="M 42 58 A 2 2 0 0 1 44 56 A 4 4 0 0 1 48 60 A 6 6 0 0 1 40 64 A 8 8 0 0 1 36 54 A 10 10 0 0 1 50 50"
        fill="none" stroke="#0A0907" stroke-width="2.2" stroke-linecap="round" />
  <path d="M 78 58 A 2 2 0 0 1 80 56 A 4 4 0 0 1 84 60 A 6 6 0 0 1 76 64 A 8 8 0 0 1 72 54 A 10 10 0 0 1 86 50"
        fill="none" stroke="#0A0907" stroke-width="2.2" stroke-linecap="round" />
  <path d="M 50 72 Q 56 68, 62 74 Q 68 80, 72 72" fill="none" stroke="#0A0907" stroke-width="2.5" stroke-linecap="round" />
  <path d="M 58 72 C 58 72, 57 82, 62 82 C 67 82, 66 72, 66 72 Z"
        fill="#FC4A52" stroke="#0A0907" stroke-width="1.5" />
  <path d="M 62 73 L 62 78" stroke="#3D0307" stroke-width="1" />
  <circle cx="20" cy="28" r="3" fill="#00FFCC" opacity="0.8" />
  <circle cx="24" cy="20" r="1.5" fill="#00FFCC" opacity="0.6" />
  <circle cx="100" cy="28" r="3.5" fill="#00FFCC" opacity="0.8" />
  <circle cx="96" cy="18" r="2" fill="#00FFCC" opacity="0.6" />
</svg>`
};

export function getMascotSvg(stage: FatigueStage): string {
  return MASCOT_SVGS[stage] || MASCOT_SVGS.fresh;
}
