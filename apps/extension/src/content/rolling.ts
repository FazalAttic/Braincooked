/**
 * src/content/rolling.ts
 * Lightweight vertical number "odometer" animation for the counter bubble.
 *
 * New/changed digits slide UP from the bottom into place; unchanged digits stay
 * put. This replaces torph for the numeric counters, because torph's digit slide
 * is hardcoded to enter from the TOP (downward), which reads as a bug for a counter.
 */

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export class RollingNumber {
  private el: HTMLElement;
  private duration: number;
  private value = '';
  private initialized = false;
  private reducedMotion = false;
  private mediaQuery: MediaQueryList | null = null;

  constructor(el: HTMLElement, duration = 400) {
    this.el = el;
    this.duration = duration;
    el.classList.add('brn-roll');
    this.setupReducedMotion();
  }

  /**
   * Update the displayed value. The first call only hydrates the initial value
   * (no animation); subsequent changes roll new digits up from the bottom.
   */
  public update(next: string): void {
    if (!this.initialized) {
      this.initialized = true;
      this.value = next;
      this.renderStatic(next);
      return;
    }
    if (next === this.value) return;

    const prev = this.value;
    this.value = next;

    if (this.reducedMotion) {
      this.renderStatic(next);
      return;
    }
    this.renderRoll(prev, next);
  }

  public destroy(): void {
    if (this.mediaQuery) {
      try {
        this.mediaQuery.removeEventListener('change', this.onMotionChange);
      } catch {
        // Suppress
      }
      this.mediaQuery = null;
    }
    this.el.classList.remove('brn-roll');
    this.el.textContent = this.value;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private setupReducedMotion(): void {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = this.mediaQuery.matches;
        this.mediaQuery.addEventListener?.('change', this.onMotionChange);
      }
    } catch {
      // Suppress
    }
  }

  private onMotionChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
  };

  private renderStatic(text: string): void {
    this.el.textContent = '';
    for (const ch of text) {
      this.el.appendChild(this.makeColumn(ch, false));
    }
  }

  private renderRoll(prev: string, next: string): void {
    const prevChars = Array.from(prev);
    const nextChars = Array.from(next);

    // Rebuilding removes the old DOM, which also cancels any in-flight
    // animations, so each update starts from a clean state.
    this.el.textContent = '';

    for (let j = 0; j < nextChars.length; j++) {
      const ch = nextChars[j];
      const posFromRight = nextChars.length - 1 - j;
      const prevIdx = prevChars.length - 1 - posFromRight;
      const prevCh = prevIdx >= 0 ? prevChars[prevIdx] : null;
      const changed = prevCh !== ch;
      this.el.appendChild(this.makeColumn(ch, changed));
    }
  }

  private makeColumn(ch: string, animateIn: boolean): HTMLElement {
    const col = document.createElement('span');
    col.className = 'brn-col';

    const digit = document.createElement('span');
    digit.className = 'brn-digit';
    digit.textContent = ch;
    col.appendChild(digit);

    // Only animate when the Web Animations API is available (absent in jsdom).
    if (animateIn && typeof digit.animate === 'function') {
      digit.animate(
        [
          { transform: 'translateY(100%)' },
          { transform: 'translateY(0%)' }
        ],
        { duration: this.duration, easing: EASE, fill: 'both' }
      );
    }

    return col;
  }
}
