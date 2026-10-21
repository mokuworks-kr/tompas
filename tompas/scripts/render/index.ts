// render: layout.json을 InDesign으로 조판하고 잰다.
//   node render/index.ts <프로젝트 폴더>   out/에 INDD·PDF·스프레드 그림, data/render.json에 측정값
// 맥에서 AppleScript로 InDesign의 ExtendScript를 부른다. 그동안 InDesign을 다른 일에 쓰지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { layout } from "../layout/index.ts";

// 가장 새 InDesign
export function indesign() {
  const apps = fs.readdirSync("/Applications").filter(d => /^Adobe InDesign \d{4}$/.test(d))
    .filter(d => fs.existsSync(`/Applications/${d}/${d}.app`)).sort();
  if (!apps.length) throw new Error("InDesign을 찾지 못했다");
  return apps.at(-1)!;
}

// 흐르는 글(→)의 쪽수가 계획과 다르면 InDesign이 재 본 쪽수를 data/flows.json에 적고 layout부터 다시 돈다(엔진만 도는 고리)
export function render(project: string) {
  project = path.resolve(project);
  const file = path.join(project, "data/flows.json");
  for (let round = 0; ; round++) {
    const r = once(project);
    if (!r.rerun) return r;
    if (round >= 3) throw new Error(`흐르는 글의 쪽수가 정해지지 않는다: ${JSON.stringify(r.flows)}`);
    const flows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    for (const [name, f] of Object.entries<any>(r.flows)) flows[name] = f.need;
    fs.writeFileSync(file, JSON.stringify(flows, null, 1) + "\n");
    layout(project);
  }
}

// InDesign 스크립트는 여러 파일로 나뉘어 있다. 엔진(render/)과 패스트 트랙 층(fill/)을 이어 붙여 한 스크립트로 부른다.
// 오류의 줄 번호는 이어 붙인 파일의 것이라 원래 파일과 줄로 되돌린다
const parts = ["render/render.jsx", "render/styles.jsx", "render/table.jsx", "render/fit.jsx", "render/measure.jsx", "render/util.jsx", "fill/render.jsx"];
function joined() {
  const at: { file: string; from: number }[] = [];
  let line = 1;
  const body = parts.map(f => {
    const s = fs.readFileSync(path.join(import.meta.dirname, "..", f), "utf8").replace(/\n*$/, "\n");
    at.push({ file: f, from: line }); line += s.split("\n").length - 1;
    return s;
  }).join("");
  const file = path.join(os.tmpdir(), "tompas-render.jsx");
  fs.writeFileSync(file, body);
  const where = (n: number) => { const p = at.filter(a => a.from <= n).at(-1)!; return `${p.file} ${n - p.from + 1}줄`; };
  return { file, where };
}

function once(project: string) {
  const out = path.join(project, "out"), result = path.join(project, "data/render.json");
  fs.mkdirSync(out, { recursive: true });
  fs.rmSync(path.join(out, "spreads"), { recursive: true, force: true });
  fs.rmSync(result, { force: true });
  const name = path.basename(project);
  const { file: jsx, where } = joined();
  const q = (s: string) => JSON.stringify(s);
  const script = `with timeout of 900 seconds
  tell application ${q(indesign())} to do script (POSIX file ${q(jsx)}) language javascript with arguments {${[path.join(project, "data/layout.json"), out, result, name].map(q).join(", ")}}
end timeout`;
  execFileSync("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"], timeout: 1000 * 960 });
  const r = JSON.parse(fs.readFileSync(result, "utf8"));
  if (r.error) throw new Error(`InDesign: ${r.error.replace(/\((\d+)줄\)/, (_: string, n: string) => `(${where(+n)})`)}`);
  return r;
}

if (process.argv[1] === import.meta.filename) for (const p of process.argv.slice(2)) {
  const r = render(p);
  const over = r.frames.filter((f: any) => f.overflows);
  for (const [name, f] of Object.entries<any>(r.flows ?? {})) console.log(`흐름 ${name}: ${f.need}쪽${f.overflows ? " (다 들어가지 않았다)" : ""}`);
  console.log(`글 상자 ${r.frames.length}개, 넘침 ${over.length}개${over.length ? ": " + over.map((f: any) => f.name).join(" ") : ""}`);
  if (r.missingFonts.length) console.log(`  없는 서체: ${r.missingFonts.join(", ")}`);
}
