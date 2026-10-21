// 와이어프레임 텍스트를 읽는다. 표기는 references/wireframe.md
import fs from "node:fs";
import path from "node:path";

export type Area = { letter: string; role: string; step: number; per?: number; hero: boolean; bottom: boolean; flow: boolean; c0: number; r0: number; cols: number; rows: number };
export type Wireframe = { name: string; spread: boolean; cols: number; rows: number; tones: string[]; cells: string[][]; areas: Area[]; errors: string[] };

export function parse(name: string, text: string): Wireframe {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const errors: string[] = [];
  const head = lines[0]?.match(/^(page|spread)\s+(\d+)\s*[×x]\s*(\d+)\s*,\s*tone:\s*((?:light|dark)(?:\s+(?:light|dark))?)$/);
  if (!head) return { name, spread: false, cols: 0, rows: 0, tones: [], cells: [], areas: [], errors: [`첫 줄을 읽을 수 없다: ${lines[0]}`] };
  const spread = head[1] === "spread", [cols, rows] = [+head[2], +head[3]];
  const tones = head[4].split(/\s+/);
  if (spread && tones.length === 1) tones.push(tones[0]);
  const cells = lines.filter(l => l.startsWith('"')).map(l => l.replace(/"/g, "").trim().split(/\s+/));
  if (cells.length !== rows) errors.push(`행이 ${cells.length}줄이다. ${rows}줄이어야 한다`);
  cells.forEach((r, i) => r.length !== cols && errors.push(`${i + 1}행이 ${r.length}칸이다. ${cols}칸이어야 한다`));

  const legend = new Map<string, Omit<Area, "letter" | "c0" | "r0" | "cols" | "rows">>();
  for (const l of lines.slice(1).filter(l => !l.startsWith('"')))
    for (const item of l.split(/\s{2,}/)) {
      const m = item.match(/^(\S)\s*:\s*(\S+)(.*)$/);
      if (!m) { errors.push(`범례를 읽을 수 없다: ${item}`); continue; }
      const rest = m[3];
      legend.set(m[1], {
        role: m[2],
        step: +(rest.match(/([+-]\d+)/)?.[1] ?? 0),
        per: rest.match(/×\s*(\d+)/) ? +rest.match(/×\s*(\d+)/)![1] : undefined,
        hero: rest.includes("*"),
        bottom: rest.includes("↓"),
        flow: rest.includes("→"),
      });
    }

  const legendRole = (k: string) => legend.get(k)?.role;
  const areas: Area[] = [];
  for (const letter of new Set(cells.flat().filter(c => c !== "."))) {
    const at = cells.flatMap((r, y) => r.flatMap((c, x) => c === letter ? [[x, y]] : []));
    const xs = at.map(p => p[0]), ys = at.map(p => p[1]);
    const c0 = Math.min(...xs), r0 = Math.min(...ys), w = Math.max(...xs) - c0 + 1, h = Math.max(...ys) - r0 + 1;
    if (w * h !== at.length) errors.push(`${letter} 영역이 직사각형이 아니다`);
    if (spread && c0 < cols / 2 && c0 + w > cols / 2 && legendRole(letter) !== "사진") errors.push(`${letter} 글 영역이 가운데를 넘는다`);
    const l = legend.get(letter);
    if (!l) { errors.push(`${letter}가 범례에 없다`); continue; }
    areas.push({ letter, ...l, c0, r0, cols: w, rows: h });
  }
  for (const k of legend.keys()) if (!areas.some(a => a.letter === k)) errors.push(`범례의 ${k}가 격자에 없다`);
  return { name, spread, cols, rows, tones, cells, areas, errors };
}

export const load = (dir: string) => Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith(".txt"))
  .map(f => { const name = path.basename(f, ".txt"); return [name, parse(name, fs.readFileSync(path.join(dir, f), "utf8"))]; }));
