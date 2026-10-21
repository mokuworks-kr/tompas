// 낱쪽과 줄에서 규칙의 변수를 잰다. 이름은 rules.json의 변수 이름 그대로다.
import type { Doc, Line, Page } from "./read.ts";

const MM = 25.4 / 72;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const chars = (s: string) => s.replace(/\s/g, "").length;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function quantile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
}
function mode(xs: number[], step = 0.1) {
  const n = new Map<number, number>();
  for (const x of xs) { const k = round(Math.round(x / step) * step, 2); n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
}
// 판면의 끝: 가장자리에서 안쪽으로 훑어, 여러 쪽(5% 이상, 최소 셋)의 글이 1.5mm 안에서 함께 닿는 첫 자리.
// 그보다 바깥으로 나간 쪽(표지, 넘치는 제목)은 판면 밖으로 둔다.
function edgeOf(mm: number[]) {
  const s = [...mm].sort((a, b) => a - b), need = Math.max(3, 0.05 * s.length);
  return s.find(v => s.filter(x => x >= v && x < v + 1.5).length >= need) ?? quantile(s, 0.1); // 함께 닿는 자리가 없으면 아래 10%
}
const spread = (xs: number[]) => xs.length ? { p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) } : null;

// 본문 크기: 글자 수가 가장 많은 크기
function bySize(lines: Line[]) {
  const n = new Map<number, number>();
  for (const l of lines) n.set(round(l.size), (n.get(round(l.size)) ?? 0) + chars(l.text));
  return [...n].sort((a, b) => b[1] - a[1]);
}

// 쪽번호·머리글·섹션 꼬리표·화면 메뉴: 쪽 가장자리에서 여러 쪽에 같은 자리로 반복되는 글.
// 본문보다 작은 짧은 글과 쪽번호는 가장자리 띠 안에서 5% 이상의 쪽에 반복되면 글이 달라도 뺀다.
// 그 밖의 글(본문 크기, 긴 머리글, 본문의 1.5배를 넘는 쪽 제목 등)은 가장자리에 걸치고 같은 글이 세 쪽 이상 반복될 때만 뺀다.
// 기준선 격자 위의 본문 첫 줄도 같은 자리에 반복되지만 글은 쪽마다 다르다.
export function furniture(pages: Page[]) {
  const body = bySize(pages.flatMap(p => p.lines))[0][0];
  const e = (p: Page) => 0.15 * Math.min(p.w, p.h);
  const inside = (p: Page, l: Line) => l.y < e(p) || l.y > p.h - e(p) || l.x1 < e(p) || l.x0 > p.w - e(p);
  const touches = (p: Page, l: Line) => l.y < e(p) || l.y > p.h - e(p) || l.x0 < e(p) || l.x1 > p.w - e(p);
  const folio = (l: Line) => /^\d+$/.test(l.text.trim());
  // 자리만 보는 글과 글까지 보는 글
  const loose = (p: Page, l: Line) => inside(p, l) && (folio(l) || (l.text.length <= 40 && l.size <= 1.5 * body && Math.abs(l.size - body) > 0.06));
  const short = (p: Page, l: Line) => loose(p, l) || touches(p, l);
  const keys = (p: Page, l: Line) => {
    const at = [l.x0 / 4, l.x1 / 4, (l.x0 + l.x1) / 8].map((x, i) => `${p.side}|${Math.round(l.y / 2)}|${i}|${Math.round(x)}`);
    return loose(p, l) ? at : at.map(k => `${k}|${l.text.replace(/[\s|\d]/g, "")}`); // 띄어쓰기·구분선·숫자는 무시
  };
  const seen = new Map<string, Set<number>>(), sides = new Map<string, number>();
  for (const p of pages) {
    sides.set(p.side, (sides.get(p.side) ?? 0) + 1);
    for (const l of p.lines) if (short(p, l)) for (const k of keys(p, l)) (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(p.n);
  }
  const out = new Set<Line>();
  for (const p of pages) for (const l of p.lines)
    if (short(p, l) && keys(p, l).some(k => seen.get(k)!.size >= (loose(p, l) ? Math.max(3, 0.05 * sides.get(p.side)!) : 3))) out.add(l);
  return out;
}

// 왼끝이 같은 줄끼리 묶은 글 기둥. 들여쓰기처럼 앞 기둥 안에서 시작하는 것은 버린다.
function columns(lines: Line[], size: number) {
  const sorted = [...lines].sort((a, b) => a.x0 - b.x0);
  const groups: Line[][] = [];
  for (const l of sorted) {
    const g = groups.at(-1);
    if (g && near(g[0].x0, l.x0, 1.5)) g.push(l); else groups.push([l]);
  }
  const cols: { x0: number; w: number; lines: Line[] }[] = [];
  for (const g of groups.filter(g => g.length >= 3)) { // 표 칸처럼 좁은 것은 단이 아니다
    const w = quantile(g.map(l => l.x1 - l.x0), 0.9);
    const prev = cols.at(-1);
    if (w < 8 * size) continue;
    if (prev && g[0].x0 < prev.x0 + prev.w - size) continue;
    cols.push({ x0: g[0].x0, w, lines: g.sort((a, b) => a.y - b.y) });
  }
  return cols;
}

// 같은 기둥에서 이어지는 두 줄의 기준선 간격
function gaps(lines: Line[]) {
  const out: { size: number; dy: number; a: Line; b: Line }[] = [];
  const byX = new Map<number, Line[]>();
  for (const l of lines) { const k = Math.round(l.x0 / 1.5); (byX.get(k) ?? byX.set(k, []).get(k)!).push(l); }
  for (const g of byX.values()) {
    g.sort((a, b) => a.y - b.y);
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i], dy = b.y - a.y;
      if (near(a.size, b.size, 0.05) && dy >= 0.9 * a.size && dy <= 2.5 * a.size) out.push({ size: a.size, dy, a, b });
    }
  }
  return out;
}

// 굵기·너비·기울기·형식 표기. 이것들만으로 된 조각은 가족 이름이 아니다.
const STYLE = "ultra|extra|semi|demi|thin|hairline|light|lt|regular|reg|rg|plain|book|roman|normal|medium|med|md|bold|bd|heavy|hv|black|bk|"
  + "condensed|cond|cn|narrow|wide|italic|ita|it|oblique|two|eighteen|twenty|std|pro|otf|ttf|tt|mt|ps|lt";
const STYLE_ONLY = new RegExp(`^(?:${STYLE}|w\\d+|\\d{3}c?|mb\\d+|[lrmbh]|ul|el|xl|sb|eb|xb|de|[a-d](?=lt|rg|bd|md|eb|hv))+$`, "i");
const STYLE_TAIL = new RegExp(`(?<=[A-Za-z0-9])(?:${STYLE.split("|").map(w => w[0].toUpperCase() + w.slice(1)).join("|")}|OTF|LT|MT|PS|TT)$`);
// 이름을 하이픈·밑줄로 나눠 굵기 조각을 뒤에서부터 뗀다. Arita-dotum-Light_OTF → Arita-dotum, HiraKakuStd-W4 → HiraKaku
export function family(font: string) {
  const parts = font.split(/[-_,]/);
  while (parts.length > 1 && STYLE_ONLY.test(parts.at(-1)!)) parts.pop();
  let f = parts.join("-");
  while (STYLE_TAIL.test(f)) f = f.replace(STYLE_TAIL, "");
  return f
    .replace(/(?<=[a-z])(UL|EL|XL|L|R|M|SB|B|EB|XB|H)$/, "") // NanumSquareEB 같은 짧은 굵기 표기
    .replace(/(?<=[a-z])(Small|Big|Display|Text|Caption|Micro|Deck|Headline|Poster|Banner|Subhead)(?=[A-Z]|$)/, ""); // 크기별 변형(제목용·본문용)은 한 가족
}

function script(text: string) {
  const n = { 한글: 0, 일본어: 0, 라틴: 0 };
  for (const c of text) {
    if (/[가-힣]/.test(c)) n.한글++;
    else if (/[぀-ヿ一-鿿]/.test(c)) n.일본어++;
    else if (/[A-Za-zÀ-ž]/.test(c)) n.라틴++;
  }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
}

// 제목 크기(본문의 1.15배 이상)끼리 이웃한 크기 비율 중 가장 작은 값. 제목 크기가 둘 미만이면 없다.
function titleStep(sizes: number[], body: number) {
  const t = sizes.filter(s => s >= 1.15 * body);
  return t.length < 2 ? null : round(Math.min(...t.slice(1).map((s, i) => s / t[i])), 2);
}

export function measure(doc: Doc) {
  const furn = furniture(doc.pages);
  const content = doc.pages.map(p => ({ ...p, lines: p.lines.filter(l => !furn.has(l)) }));
  const all = content.flatMap(p => p.lines);

  // 글자 크기와 서체
  const sized = bySize(all), byFont = new Map<string, number>();
  for (const l of all) byFont.set(l.font, (byFont.get(l.font) ?? 0) + chars(l.text));
  const total = sized.reduce((a, [, n]) => a + n, 0);
  const body = sized[0][0];
  const isBody = (l: Line) => near(l.size, body, 0.06);
  const bodyFont = [...all.filter(isBody).reduce((m, l) => m.set(l.font, (m.get(l.font) ?? 0) + chars(l.text)), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0];
  const sizes = sized.filter(([, n]) => n / total >= 0.005).map(([s]) => s).sort((a, b) => a - b);

  // 행간: 크기마다 가장 흔한 기준선 간격 { 크기: 행간 }
  const allGaps = content.flatMap(p => gaps(p.lines));
  const leadings = Object.fromEntries(sizes.map(s => [s, mode(allGaps.filter(g => near(g.size, s, 0.06)).map(g => g.dy))]).filter(([, v]) => !isNaN(v)));
  const bodyLeading = mode(allGaps.filter(g => near(g.size, body, 0.06)).map(g => g.dy));

  // 서체 가족: 글자의 1% 넘게 쓰인 것만 센다
  const fam = new Map<string, number>();
  for (const [f, n] of byFont) fam.set(family(f), (fam.get(family(f)) ?? 0) + n);
  const families = [...fam].filter(([, n]) => n / total >= 0.01).sort((a, b) => b[1] - a[1]);

  // 판면, 단, 한 줄 글자 수, 끝줄: 본문 줄이 6줄 이상인 쪽에서만 잰다
  const margins = { inner: [] as number[], top: [] as number[], outer: [] as number[], bottom: [] as number[] };
  const colN: number[] = [], gutters: number[] = [], measures: number[] = [], lasts: number[] = [];
  let bodyPages = 0;
  for (const p of content) {
    const bl = p.lines.filter(l => isBody(l) && l.font === bodyFont);
    if (bl.length < 6) continue;
    bodyPages++;
    const block = p.lines.filter(l => l.size >= 0.8 * body);
    const left = Math.min(...block.map(l => l.x0)), right = p.w - Math.max(...block.map(l => l.x1));
    margins.top.push(Math.min(...block.map(l => l.y - 0.8 * l.size)));
    margins.bottom.push(p.h - Math.max(...block.map(l => l.y)));
    margins.inner.push(p.side === "L" ? right : left);
    margins.outer.push(p.side === "L" ? left : right);

    const cols = columns(bl, body);
    colN.push(cols.length);
    for (let i = 1; i < cols.length; i++) gutters.push(cols[i].x0 - (cols[i - 1].x0 + cols[i - 1].w));
    for (const c of cols) c.lines.forEach((l, i) => {
      const full = l.x1 - l.x0 >= 0.9 * c.w;
      if (full) measures.push(l.text.length);
      const prev = c.lines[i - 1];
      if (!full && prev && prev.x1 - prev.x0 >= 0.9 * c.w && near(l.y - prev.y, bodyLeading, 0.3 * body)) lasts.push(chars(l.text));
    });
  }

  const w = mode(doc.pages.map(p => p.w * MM), 1), h = mode(doc.pages.map(p => p.h * MM), 1);
  const m = Object.fromEntries(Object.entries(margins).map(([k, v]) => [k, round(edgeOf(v.map(x => x * MM)))])) as Record<keyof typeof margins, number>;
  const tw = w - m.inner - m.outer, th = h - m.top - m.bottom;
  const n = mode(colN, 1);

  return {
    script: script(all.filter(isBody).map(l => l.text).join("")),
    fonts: Object.fromEntries([...byFont].sort((a, b) => b[1] - a[1]).map(([f, c]) => [f, round(c / total, 3)])),
    bodyPages,
    vars: {
      "page.w": w, "page.h": h, "pages": doc.pages.length,
      "margin.inner": m.inner, "margin.top": m.top, "margin.outer": m.outer, "margin.bottom": m.bottom,
      "margin.ends": Math.max(m.top, m.bottom), "margin.sides": Math.max(m.inner, m.outer),
      "page.ratio": round(w / h, 3), "text.ratio": round(tw / th, 3), "text.share": round((tw * th) / (w * h), 3),
      "body.size": body, "body.leading": bodyLeading, "sizes": sizes, "sizes.n": sizes.length, "leadings": leadings, "title.step": titleStep(sizes, body),
      "families": families.length, "family.names": families.map(([f]) => f),
      "col.n": n, "col.gutter": round(quantile(gutters, 0.5) * MM),
      "measure": spread(measures), "lastline.chars": spread(lasts) && { ...spread(lasts), short: round(lasts.filter(c => c <= 2).length / lasts.length, 3) },
    },
  };
}
