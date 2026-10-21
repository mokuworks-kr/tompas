// 색 역할의 명도와 채도. CMYK를 단순 변환으로 L*a*b*로 바꾼다(ICC 프로파일 없이). 검사의 눈금으로만 쓴다
const named: Record<string, number[]> = { Paper: [0, 0, 0, 0], Black: [0, 0, 0, 100] };

export function lab(cmyk: number[]) {
  const [c, m, y, k] = cmyk.map(v => v / 100);
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = [c, m, y].map(v => lin((1 - v) * (1 - k)));
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089);
  return { L: 116 * Y - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
}
export const cmykOf = (name: string, colors: Record<string, number[]>) => colors[name] ?? named[name];

// C1 강조색 수(유채색, C* 20 이상), C3 글자와 바탕의 명도 차, C2 흑백 계획(기본 테마)에서 벗어난 명도
export function colorVars(t: any, plan: any) {
  const L = (tones: any, colors: any, tone: string, role: string) => { const v = cmykOf(tones[tone]?.[role], colors); return v ? lab(v).L : null; };
  const chroma = (v: number[]) => { const x = lab(v); return Math.hypot(x.a, x.b); };
  const used = new Set(Object.values(t.tones).flatMap((r: any) => Object.values(r) as string[]));
  const accents = [...used].filter(n => { const v = cmykOf(n, t.colors ?? {}); return v && chroma(v) >= 20; }).length;
  const tones = Object.keys(t.tones);
  const text = tones.map(tone => Math.abs(L(t.tones, t.colors ?? {}, tone, "글자")! - L(t.tones, t.colors ?? {}, tone, "바탕")!));
  const shift = tones.flatMap(tone => Object.keys(t.tones[tone]).map(role => {
    const a = L(t.tones, t.colors ?? {}, tone, role), b = L(plan.tones, plan.colors ?? {}, tone, role);
    return a == null || b == null ? 0 : Math.abs(a - b);
  }));
  const r = (v: number) => Math.round(v);
  return { accents, "tone.text": r(Math.min(...text)), "tone.shift": r(Math.max(...shift)) };
}
