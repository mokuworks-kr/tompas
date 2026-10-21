// render.jsx: layout.json을 InDesign 문서로 조판하고 잰다. ExtendScript라 옛 JavaScript로 쓴다.
// arguments: [layout.json, 출력 폴더, 측정 결과 json, 파일 이름]
// render/index.ts가 이 파일 뒤에 styles·table·fit·measure·util과 fill/render.jsx를 이어 붙여 한 스크립트로 부른다
var L = readJSON(arguments[0]);
var OUT = arguments[1], NAME = arguments[3];
var MM = 25.4 / 72, DOC;
var WARN = [], CHUNKS = {}, ROLES = {}, FLOWS = {}, INFLOW = {}, PICS = [];
// 한글 설정 경고, 이야기마다 제목 덩어리 자리(문단 번호 → [시작, 끝])와 문단의 원고 역할, 흐르는 이야기의 상자들, 흐르는 상자 id
var CLOSE = ".,:;!?)]}%·…、。」』》〉’”", OPEN = "([{「『《〈‘“";   // 줄 머리·꼬리 금칙 문자(H2)

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
var result;
try { result = main(); } catch (e) { result = { error: e.message + " (" + e.line + "줄)" }; }
writeText(arguments[2], stringify(result));
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;
"ok";

function main() {
  var g = L.grid, m = g.margin;
  var doc = DOC = app.documents.add(false);
  try {
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
    doc.documentPreferences.properties = {
      pageWidth: L.page.w, pageHeight: L.page.h, facingPages: true,
      documentBleedTopOffset: 3, documentBleedUniformSize: true
    };
    doc.marginPreferences.properties = { top: m.top, bottom: m.bottom, left: m.inner, right: m.outer, columnCount: g.cols, columnGutter: g.gutter };
    var master = doc.masterSpreads[0];
    for (var i = 0; i < master.pages.length; i++)
      master.pages[i].marginPreferences.properties = { top: m.top, bottom: m.bottom, left: m.inner, right: m.outer, columnCount: g.cols, columnGutter: g.gutter };
    doc.documentPreferences.pagesPerDocument = L.total;
    doc.gridPreferences.properties = {
      baselineStart: m.top, baselineDivision: g.baseline,
      baselineGridRelativeOption: BaselineGridRelativeOption.TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION
    };

    // 레이어: 위에서부터 메모(인쇄 안 함), 글, 도식, 그림, 바탕. 도식과 그림은 놓을 것이 있을 때만 만든다
    var layers = { 바탕: doc.layers.add({ name: "바탕" }), 메모: doc.layers.add({ name: "메모", printable: false }) };
    layers.글 = doc.layers.add({ name: "글" });
    layers.바탕.move(LocationOptions.AT_END);
    if (used("draw")) { layers.도식 = doc.layers.add({ name: "도식" }); layers.도식.move(LocationOptions.AFTER, layers.글); }
    if (used("file")) { layers.그림 = doc.layers.add({ name: "그림" }); layers.그림.move(LocationOptions.BEFORE, layers.바탕); }
    doc.activeLayer = layers.글;
    for (var i = doc.layers.length - 1; i >= 0; i--) if (!(doc.layers[i].name in layers) && !doc.layers[i].allPageItems.length) doc.layers[i].remove();   // 새 문서의 빈 "레이어 1"
    layers.메모.move(LocationOptions.AT_BEGINNING);

    var missing = styles(doc);
    folios(doc, master, g, "light");
    // 어두운 쪽의 쪽번호는 색만 다른 상위 페이지 B에 둔다
    var darkMaster = null;
    for (var p = 0; p < L.pages.length; p++) if (L.pages[p].tone == "dark" && L.pages[p].folio && !darkMaster) {
      darkMaster = doc.masterSpreads.add({ namePrefix: "B", baseName: "어두운 쪽" });
      folios(doc, darkMaster, g, "dark");
    }

    for (var p = 0; p < L.pages.length; p++) {
      var P = L.pages[p], page = doc.pages[P.page - 1];
      if (!P.folio) page.appliedMaster = NothingEnum.NOTHING;
      else if (P.tone == "dark") page.appliedMaster = darkMaster;
      for (var f = 0; f < P.frames.length; f++) {
        var F = P.frames[f];
        var b = [F.y, P.x0 + F.x, F.y + F.h, P.x0 + F.x + F.w];
        if (F.kind == "tone" && F.pic && F.pic.file) {
          backdrop(doc, page, P, F, b, layers);   // 패스트 트랙(fill)
        } else if (F.kind == "tone") {
          page.rectangles.add(layers.바탕, undefined, undefined, { geometricBounds: b, fillColor: swatch(doc, L.tones[P.tone].바탕), strokeWeight: 0 });
        } else if (F.kind == "image" && F.pic) {
          picture(doc, page, P, F, b, layers);
        } else if (F.kind == "image") {
          var r = page.rectangles.add(layers.글, undefined, undefined, { geometricBounds: b, fillColor: "Black", fillTint: 40, strokeWeight: 0, label: F.memo || "", name: P.page + F.letter });
          if (F.memo) note(doc, page, layers, b, "사진 자리: " + F.memo);
        } else if (F.kind == "text" && (F.flow || (F.paras && F.paras.length))) {   // ExtendScript는 a || b && c를 (a || b) && c로 읽는다
          var t = page.textFrames.add(layers.글, undefined, undefined, { geometricBounds: b, name: P.page + F.letter, label: F.group || "" });
          if (F.flow) { (FLOWS[F.flow] = FLOWS[F.flow] || []).push(t); INFLOW[t.id] = 1; }
          if (!F.paras || !F.paras.length) continue;
          t.textFramePreferences.insetSpacing = [0, 0, 0, 0];
          if (F.bottom) t.textFramePreferences.verticalJustification = VerticalJustification.BOTTOM_ALIGN;
          var texts = [];
          for (var k = 0; k < F.paras.length; k++) texts.push(F.paras[k].text);
          t.contents = texts.join("\r");
          var sid = t.parentStory.id; ROLES[sid] = [];
          var story = t.parentStory.paragraphs;   // 상자 밖으로 넘친 문단에도 스타일을 건다
          for (var k = 0; k < F.paras.length; k++) {
            // 이야기 끝의 빈 문단(표 자리)은 InDesign이 문단으로 세지 않는다. 이야기 끝 자리에 표를 넣는다
            if (k >= story.length) {
              if (!F.paras[k].table) break;
              var end = t.parentStory.insertionPoints[-1];
              end.appliedParagraphStyle = doc.paragraphStyles.itemByName(F.paras[k].style);
              table(doc, end, F.paras[k].table, P.tone);
              ROLES[sid].push(F.paras[k].role);
              continue;
            }
            var para = story[k], color = paint(doc, P.tone, F.paras[k].color || "글자");
            para.appliedParagraphStyle = F.paras[k].hang ? hangStyle(doc, F.paras[k].style, F.paras[k].icon === true || !!F.paras[k].slot)
              : doc.paragraphStyles.itemByName(F.paras[k].style);
            if (color) para.texts[0].appliedCharacterStyle = color;
            if (F.paras[k].icon === true) para.characters[0].appliedCharacterStyle = iconChar(doc, P.tone, F.paras[k].color || "글자");   // fill
            if (F.paras[k].slot) para.characters[0].appliedCharacterStyle = slotChar(doc, P.tone, F.paras[k].style == "아이콘");
            if (F.paras[k].chunks) chunk(t, k, F.paras[k].chunks, color);
            if (F.paras[k].table) table(doc, para.insertionPoints[0], F.paras[k].table, P.tone);
            ROLES[sid].push(F.paras[k].role);
          }
        }
      }
    }
    // 흐르는 이야기는 상자를 쪽 순서로 잇는다(layout이 줄 세웠다)
    for (var f in FLOWS) for (var i = 0; i + 1 < FLOWS[f].length; i++) FLOWS[f][i].nextTextFrame = FLOWS[f][i + 1];
    if (L.lang != "한글") quotes(doc);
    doc.recompose();
    pictures(doc);
    var flows = measureFlows(doc);
    var rerun = false;
    for (var f in flows) if (flows[f].rerun) rerun = true;
    // 쪽수가 계획과 다르면 여기서 멈춘다. render/index.ts가 data/flows.json을 쓰고 layout부터 다시 돈다
    if (rerun) return { rerun: true, flows: flows };
    var adjust = fit(doc);
    var starts = align(doc);
    capAlign(doc);
    var measured = measure(doc);
    measured.missingFonts = missing;
    measured.adjust = adjust;
    measured.starts = starts;
    measured.flows = flows;
    measured.warnings = WARN;

    for (var i = doc.swatches.length - 1; i >= 0; i--) if (/^C=\d+ M=\d+ Y=\d+ K=\d+$/.test(doc.swatches[i].name)) try { doc.swatches[i].remove(); } catch (e) {}
    var name = OUT + "/" + NAME;
    release(File(name + ".indd"));
    doc.save(File(name + ".indd"));
    var preset = pdfPreset();
    if (preset) doc.exportFile(ExportFormat.PDF_TYPE, File(name + ".pdf"), false, preset);
    else doc.exportFile(ExportFormat.PDF_TYPE, File(name + ".pdf"), false);
    app.jpegExportPreferences.properties = { exportingSpread: true, jpegExportRange: ExportRangeOrAllPages.EXPORT_ALL, exportResolution: 60, jpegQuality: JPEGOptionsQuality.MEDIUM };
    Folder(OUT + "/spreads").create();
    doc.exportFile(ExportFormat.JPG, File(OUT + "/spreads/spread.jpg"), false);
    return measured;
  } finally {
    doc.close(SaveOptions.NO);
  }
}

// 사진 자리를 채울 것이 있는가: 받은 파일(file) 또는 도식(draw)
function used(what) {
  for (var p = 0; p < L.pages.length; p++) for (var f = 0; f < L.pages[p].frames.length; f++) {
    var F = L.pages[p].frames[f];
    if (F.kind == "image" && F.pic && F.pic[what] && (what != "draw" || F.pic.draw.length)) return true;
  }
  return false;
}

// 사진 자리에 받은 파일 놓기(고객 자료, 임시 FPO 포함). 그림 레이어에 자리 이름으로 둔다. 도식은 패스트 트랙(fill)이 더한다
function picture(doc, page, P, F, b, layers) {
  var pic = F.pic, items = [];
  if (pic.file) {
    var ins = pic.inset || [0, 0, 0, 0];   // 자리 안쪽으로 들이기(위, 오른쪽, 아래, 왼쪽 mm). 위쪽 자리의 사진을 마주 보는 제목의 대문자 윗선에 맞출 때(L11)
    var f = page.rectangles.add(layers.그림, undefined, undefined, { geometricBounds: [b[0] + ins[0], b[1] + ins[3], b[2] - ins[2], b[3] - ins[1]], strokeWeight: 0, label: F.memo || "" });
    place(f, pic.file, pic.fit);
    f.properties = { strokeWeight: 0, strokeColor: swatch(doc, "None") };   // 비율대로 놓아(fit) 틀이 드러날 때 선이 보이지 않게
    items.push(f);
  }
  if (pic.fpo) note(doc, page, layers, b, "임시(FPO), 고객 원본으로 바꿀 것: " + (F.memo || ""));
  if (pic.draw) drawing(doc, page, P, F, b, layers, items);   // fill
  if (items.length > 1) page.groups.add(items, layers.도식, undefined, { name: P.page + F.letter + " 도식" });
  else if (items.length) items[0].name = P.page + F.letter;
}
