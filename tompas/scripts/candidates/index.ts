// candidates: 한 와이어프레임의 후보들을 견준다.
//   node candidates/index.ts <프로젝트 폴더> <와이어프레임 이름> [--render]
// 후보는 data/candidates/<이름>/에 한 파일씩 쓴다(A.txt, B.txt, C.txt). 후보끼리 영역 지도가 비슷하면 다시 뽑으라고 알린다.
// --render면 후보마다 그 와이어프레임을 쓰는 첫 쪽의 원고를 부어 한 문서로 조판하고, 나란히 놓은 그림(out/candidates/<이름>.png)을 만든다.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { load, type Wireframe } from "../wireframe/parse.ts";
import { layout } from "../layout/index.ts";
import { render } from "../render/index.ts";
import { validate, line } from "../validate/index.ts";

// 비슷함의 기준(가설): 칸의 70% 이상이 같은 쓰임이면 같은 구조로 본다. 좌우를 뒤집은 것도 같은 구조다
export const SIMILAR = 0.7;

// 칸마다 쓰임: 주인공(*), 사진, 글, 빈 곳
function map(wf: Wireframe) {
  const kind = new Map(wf.areas.map(a => [a.letter, a.hero ? "*" : a.role === "사진" ? "P" : "T"]));
  return wf.cells.map(r => r.map(c => kind.get(c) ?? "."));
}
export function similarity(a: Wireframe, b: Wireframe) {
  const A = map(a), B = map(b);
  if (A.length !== B.length || A[0]?.length !== B[0]?.length) return 0;
  const same = (M: string[][]) => A.flat().filter((c, i) => c === M.flat()[i]).length / A.flat().length;
  return Math.round(Math.max(same(B), same(B.map(r => [...r].reverse()))) * 100) / 100;
}

export async function candidates(project: string, name: string, draw: boolean) {
  project = path.resolve(project);
  const dir = path.join(project, "data/candidates", name);
  const wfs = load(dir), names = Object.keys(wfs).sort();
  const pairs = names.flatMap((a, i) => names.slice(i + 1).map(b => ({ a, b, same: similarity(wfs[a], wfs[b]) })));
  const errors = names.flatMap(n => wfs[n].errors.map(e => `${n}: ${e}`));
  const result: any = { name, candidates: names, pairs, similar: pairs.filter(p => p.same >= SIMILAR), errors };
  if (draw && !errors.length) Object.assign(result, await preview(project, name, wfs, names));
  fs.writeFileSync(path.join(dir, "candidates.json"), JSON.stringify(result, null, 1) + "\n");
  return result;
}

// 후보마다 스프레드 하나씩, 그 와이어프레임을 쓰는 첫 원고 쪽으로 채워 한 문서에 조판한다
async function preview(project: string, name: string, wfs: Record<string, Wireframe>, names: string[]) {
  const map = JSON.parse(fs.readFileSync(path.join(project, "data/pagemap.json"), "utf8"));
  const entry = map.pages.find((e: any) => e.wireframe === name);
  if (!entry) throw new Error(`페이지 맵에 ${name}을 쓰는 쪽이 없다`);
  const tmp = path.join(project, "out/candidates", name);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, "data/wireframes"), { recursive: true });
  for (const f of ["content.json", "theme.json"]) if (fs.existsSync(path.join(project, "data", f))) fs.copyFileSync(path.join(project, "data", f), path.join(tmp, "data", f));
  names.forEach(n => fs.copyFileSync(path.join(project, "data/candidates", name, `${n}.txt`), path.join(tmp, "data/wireframes", `${n}.txt`)));
  // 1쪽은 홀로 서므로 비우고, 후보 i는 2+2i쪽부터 놓는다(쪽 와이어프레임은 왼쪽 쪽에만)
  const pages = names.map((n, i) => ({
    pages: wfs[n].spread ? [2 + 2 * i, 3 + 2 * i] : [2 + 2 * i], wireframe: n, kind: n,
    content: wfs[n].spread ? entry.content.slice(0, 2) : entry.content.slice(0, 1),
  }));
  fs.writeFileSync(path.join(tmp, "data/pagemap.json"), JSON.stringify({ page: map.page, pages }));
  const L = layout(tmp);
  const R = render(tmp);
  const rules = (await validate(tmp)).filter(r => r.status === "어긋남");
  // 후보별 넘침과 어긋난 규칙(쪽으로 가른다)
  const per = names.map((n, i) => {
    const ps = pages[i].pages, on = (w: string) => ps.some(p => w.startsWith(`${p}쪽`) || w.startsWith(`${p}–`));
    return {
      name: n, pages: ps,
      overflow: R.frames.filter((f: any) => f.overflows && ps.includes(f.page)).map((f: any) => f.name),
      rules: rules.flatMap(r => r.where ? (r.where.some(on) ? [line({ ...r, where: r.where.filter(on) })] : []) : []),
    };
  });
  const file = path.join(project, "out/candidates", `${name}.png`);
  await sheet(path.join(tmp, "out/spreads"), names, file);
  return { preview: file, per, layout: L.errors };
}

// 후보 스프레드를 위아래로 쌓고 번호를 단다. 첫 그림(빈 1쪽)은 뺀다
async function sheet(dir: string, names: string[], file: string) {
  const num = (f: string) => +(f.match(/(\d+)\.jpg$/)?.[1] ?? 1);
  const imgs = await Promise.all(fs.readdirSync(dir).filter(f => f.endsWith(".jpg")).sort((a, b) => num(a) - num(b)).slice(1, names.length + 1).map(f => loadImage(path.join(dir, f))));
  const W = 1400, gap = 24, head = 40, h = (im: any) => im.height * W / im.width;
  const c = createCanvas(W + 2 * gap, imgs.reduce((a, im) => a + h(im) + head + gap, gap));
  const x = c.getContext("2d");
  x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, c.width, c.height);
  let y = gap;
  imgs.forEach((im, i) => {
    x.fillStyle = "#fff"; x.font = "bold 28px sans-serif"; x.fillText(`${i + 1}. ${names[i]}`, gap, y + 30);
    x.drawImage(im, gap, y + head, W, h(im)); y += h(im) + head + gap;
  });
  fs.writeFileSync(file, c.toBuffer("image/png"));
}

if (process.argv[1] === import.meta.filename) {
  const [project, name] = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const r = await candidates(project, name, process.argv.includes("--render"));
  for (const e of r.errors) console.log(`문제: ${e}`);
  console.log(`${name} 후보 ${r.candidates.length}개: ${r.pairs.map((p: any) => `${p.a}·${p.b} ${Math.round(p.same * 100)}%`).join(", ")}`);
  if (r.candidates.length < 2) console.log("후보가 둘 이상이어야 한다");
  for (const p of r.similar) console.log(`  비슷하다: ${p.a}와 ${p.b}(칸의 ${Math.round(p.same * 100)}%가 같은 쓰임). 하나를 구조부터 다시 뽑는다`);
  if (r.preview) {
    for (const c of r.per) console.log(`  ${c.name}: 넘침 ${c.overflow.length}${c.rules.length ? `, ${c.rules.join(" / ")}` : ""}`);
    console.log(`그림: ${r.preview}`);
  }
}
