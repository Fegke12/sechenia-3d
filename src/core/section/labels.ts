import { subscript } from '../polyhedra/build';

/** Буквы для новых точек: традиционные школьные обозначения. */
const POOL = ['P', 'Q', 'R', 'T', 'L', 'F', 'E', 'H', 'G', 'X', 'Y', 'Z', 'U', 'W', 'O', 'J'];
/** Буквы для заданных пользователем точек. */
export const USER_POOL = ['M', 'N', 'K', 'L', 'P', 'Q', 'R', 'T'];

export class LabelPool {
  private used: Set<string>;
  private counter = 1;
  constructor(taken: Iterable<string>) {
    this.used = new Set(taken);
  }
  take(preferred?: string): string {
    if (preferred && !this.used.has(preferred)) {
      this.used.add(preferred);
      return preferred;
    }
    for (const l of POOL)
      if (!this.used.has(l)) {
        this.used.add(l);
        return l;
      }
    for (;;) {
      const l = 'P' + subscript(this.counter++);
      if (!this.used.has(l)) {
        this.used.add(l);
        return l;
      }
    }
  }
  reserve(label: string) {
    this.used.add(label);
  }
}

/** Свободная буква для новой заданной точки. */
export function nextUserLabel(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (const l of USER_POOL) if (!used.has(l)) return l;
  for (let i = 1; ; i++) {
    const l = 'M' + subscript(i);
    if (!used.has(l)) return l;
  }
}

/** Нормализация подписи для сравнения: кириллица → латиница, A1 → A₁, A' → A₁ не делаем (штрих — отдельный символ). */
export function normalizeLabel(s: string): string {
  const map: Record<string, string> = {
    А: 'A',
    В: 'B',
    С: 'C',
    Е: 'E',
    К: 'K',
    М: 'M',
    Н: 'H',
    О: 'O',
    Р: 'P',
    Т: 'T',
    Х: 'X',
    а: 'A',
    в: 'B',
    с: 'C',
    е: 'E',
    к: 'K',
    м: 'M',
    н: 'H',
    о: 'O',
    р: 'P',
    т: 'T',
    х: 'X',
  };
  let out = '';
  for (const ch of s.trim()) {
    if (map[ch]) out += map[ch];
    else if (/[0-9]/.test(ch)) out += '₀₁₂₃₄₅₆₇₈₉'[Number(ch)];
    else out += ch.toUpperCase();
  }
  return out;
}
