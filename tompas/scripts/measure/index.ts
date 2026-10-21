// measure: PDF에서 규칙의 변수를 잰다.
//   node measure/index.ts <pdf>...            결과를 화면에 낸다
//   node measure/index.ts --archive [이름]...  아카이브를 재서 archive/measures.json에 더한다
import fs from "node:fs";
import path from "node:path";
import { read } from "./read.ts";
import { measure } from "./vars.ts";
import { look } from "./look.ts";
import { measure2 } from "./spread.ts";

const archive = path.resolve(import.meta.dirname, "../../../archive");

// 문서 언어: 아카이브 목록의 회사·제목 글자로 정한다
export const language = (text: string) => /[\uac00-\ud7a3]/.test(text) ? "한글" : /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? "일본어" : "라틴";

export async function measureFile(file: string, lang?: string) {
  const doc = await read(file);
  const m = measure(doc);
  // 본문이 윤곽선이거나 글자가 깨지면, 문서 언어가 아닌 글(영문 제목 등)만 본문으로 잡히거나 본문 쪽이 거의 없다
  if (m.bodyPages < 10 || (lang && m.script !== lang))
    return { layout: doc.layout, medium: doc.medium, skip: `본문을 읽을 수 없음(윤곽선이거나 글자가 깨짐). 읽힌 본문: ${m.script}, ${m.bodyPages}쪽` };
  const m2 = measure2(doc, await look(file, doc), m.vars["body.size"]);
  return { layout: doc.layout, medium: doc.medium, ...m, vars: { ...m.vars, ...m2 } };
}

const args = process.argv[1] === import.meta.filename ? process.argv.slice(2) : [];
if (args[0] === "--archive") {
  const names = args.slice(1);
  const out = path.join(archive, "measures.json");
  const saved = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : { projects: {} };
  const list = JSON.parse(fs.readFileSync(path.join(archive, "projects.json"), "utf8"))
    .filter((p: any) => p.file && (!names.length || names.some(n => p.file.includes(n))));
  for (const p of list) {
    process.stderr.write(`${p.file} … `);
    try { saved.projects[p.file] = await measureFile(path.join(archive, p.file), language(`${p.client ?? ""} ${p.title}`)); process.stderr.write("ok\n"); }
    catch (e: any) { saved.projects[p.file] = { skip: `읽기 실패: ${e.message}` }; process.stderr.write(`실패 ${e.message}\n`); }
    fs.writeFileSync(out, JSON.stringify(saved, null, 1) + "\n");
  }
} else {
  for (const f of args) console.log(JSON.stringify({ file: f, ...(await measureFile(f)) }, null, 1));
}
