// 도움 함수

function extend(a, b) { for (var k in b) a[k] = b[k]; return a; }

function place(r, file, fit) {
  try {
    r.place(File(file));
    r.fit(fit == "fill" ? FitOptions.FILL_PROPORTIONALLY : FitOptions.PROPORTIONALLY);
    r.fit(FitOptions.CENTER_CONTENT);
  } catch (e) { WARN.push("그림: " + file + " " + e.message); }
}

// 같은 파일이 InDesign에 열려 있으면(충돌 뒤 복구, 지난 실행) 저장하지 못한다. 저장하지 않고 닫는다
function release(file) {
  for (var i = app.documents.length - 1; i >= 0; i--) {
    var d = app.documents[i];
    if (d != DOC && d.saved && d.fullName.fsName == file.fsName) d.close(SaveOptions.NO);
  }
}

// 교정용 PDF. InDesign 언어에 따라 사전 설정 이름이 다르다
function pdfPreset() {
  for (var i = 0; i < app.pdfExportPresets.length; i++)
    if (/High Quality Print|고품질 인쇄/.test(app.pdfExportPresets[i].name)) return app.pdfExportPresets[i];
  return null;
}
// 쪽에 놓인 틀인가. 표 칸 속 그림 틀과 틀 속 그림은 아니다
function loose(it) { return it.parent instanceof Spread; }
function pt(mm) { return Math.round(mm / MM * 100) / 100; }
function safe(f) { try { return f(); } catch (e) { return null; } }
function keys(o) { var a = []; for (var k in o) a.push(isNaN(+k) ? k : +k); return a; }
function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
function readJSON(path) { var f = File(path); f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close(); return eval("(" + s + ")"); }
function writeText(path, s) { var f = File(path); f.encoding = "UTF-8"; f.open("w"); f.write(s); f.close(); }

// ExtendScript에는 JSON이 없다
function stringify(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v == "number") return isFinite(v) ? String(v) : "null";
  if (typeof v == "boolean") return String(v);
  if (typeof v == "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/[\x00-\x1f]/g, " ") + '"';
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(stringify(v[i])); return "[" + a.join(",") + "]"; }
  var o = []; for (var k in v) o.push(stringify(k) + ":" + stringify(v[k])); return "{" + o.join(",") + "}";
}
