// 재기: 조판 결과를 규칙 검사(check)에 넘긴다

// 잰다: 넘침, 문단의 줄, 첫 줄 위치, 쓰인 크기·행간·서체, 쪽마다 놓인 글
function measure(doc) {
  var frames = [], sizes = {}, leadings = {}, families = {}, text = {}, cells = [], tables = {}, apart = [];
  for (var p = 0; p < doc.pages.length; p++) text[p + 1] = "";
  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p], n = p + 1;
    for (var i = 0; i < page.textFrames.length; i++) {
      var t = page.textFrames[i];
      if (t.itemLayer.name != "글") continue;
      var paras = [], sid = t.parentStory.id, starts = [].concat(t.parentStory.paragraphs.everyItem().index), k0 = -1;
      for (var k = 0; k < t.paragraphs.length; k++) {
        var para = t.paragraphs[k];
        if (k0 < 0) for (var q = 0; q < starts.length; q++) if (starts[q] == para.index) { k0 = q - k; break; }
        if (safe(function () { return para.characters[0].parentTextFrames[0].id; }) != t.id) continue;   // 앞 상자에서 이어진 문단
        if (para.tables.length) continue;   // 표를 든 문단은 글 줄이 아니다(표 칸 글은 따로 센다)
        var lines = para.lines, chars = [], texts = [];
        for (var j = 0; j < lines.length; j++) { texts.push(String(lines[j].contents)); chars.push(trim(texts[j]).length); }
        sizes[pt(para.pointSize)] = 1; leadings[pt(para.leading)] = 1; families[para.appliedFont.fontFamily] = 1;
        paras.push({ style: para.appliedParagraphStyle.name, role: ROLES[sid] ? ROLES[sid][k0 + k] : null, lines: chars,
          breaks: breaks(texts, CHUNKS[sid] && CHUNKS[sid][k0 + k]), widow: widow(lines) });
      }
      text[n] += (t.texts.length ? String(t.texts[0].contents) : "") + "\r";   // 상자에 보이는 글만(넘친 글은 인쇄되지 않는다)
      // 표의 칸 글은 칸이 놓인 쪽에 센다(쪽을 넘는 표). 넘친 칸은 인쇄되지 않는다
      for (var q = 0; q < t.tables.length; q++) {
        // 흐르는 글에서 표만 다음 쪽으로 넘어가 앞 글(소개·소제목)이 쪽 끝에 홀로 남았나. 붙이기는 걸지 않고 알리기만 한다
        var anchor = t.tables[q].storyOffset, pi = anchor.paragraphs[0].index, story = t.parentStory;
        var before = safe(function () { var ps = story.paragraphs.itemByRange(0, anchor.paragraphs[0]).getElements(); return ps.length > 1 ? ps[ps.length - 2] : null; });
        var firstCell = safe(function () { return t.tables[q].cells[0].texts[0].parentTextFrames[0].parentPage.documentOffset; });
        var lastLine = before && !before.tables.length ? safe(function () { return before.lines[-1].parentTextFrames[0].parentPage.documentOffset; }) : null;
        if (firstCell !== null && lastLine !== null && firstCell != lastLine) apart.push((lastLine + 1) + "쪽 끝 " + String(before.contents).replace(/[\r\n]+/g, " ").slice(0, 20));
        var all = t.tables[q].cells.everyItem().getElements();
        for (var j = 0; j < all.length; j++) {
          var cl = all[j];
          if (cl.overflows) { cells.push(n + t.name.replace(/^\d+/, "") + " " + (cl.parentRow.index + 1) + "줄 " + (cl.parentColumn.index + 1) + "칸"); continue; }
          var tf = safe(function () { return cl.texts[0].parentTextFrames[0]; }), at = tf ? tf.parentPage.documentOffset + 1 : n;
          text[at] += String(cl.contents) + "\r";
          // 표가 쪽마다 차지한 자리: 칸 글의 첫 줄 위와 끝 줄 아래, 칸 속 그림. 규칙 검사는 표를 요소 하나로 본다
          if (!tf) continue;
          var key = q + ":" + t.id + ":" + tf.id, tb = tf.geometricBounds;
          var box = tables[key] || (tables[key] = { page: at, x: tb[1] - tf.parentPage.bounds[1], w: tb[3] - tb[1], y0: 1e9, y1: -1e9 });
          var ls = cl.lines;
          if (ls.length) { box.y0 = Math.min(box.y0, ls[0].baseline - ls[0].pointSize); box.y1 = Math.max(box.y1, ls[ls.length - 1].baseline + L.grid.baseline * 0.3); }
          for (var e = 0; e < cl.allPageItems.length; e++) {
            var gb = safe(function () { return cl.allPageItems[e].geometricBounds; });
            if (gb) { box.y0 = Math.min(box.y0, gb[0]); box.y1 = Math.max(box.y1, gb[2]); }
          }
        }
      }
      frames.push({
        page: n, name: t.name, overflows: t.overflows,
        firstBaseline: safe(function () { return t.paragraphs[0].tables.length ? null : t.lines[0].baseline; }),   // 표로 시작하는 상자(쪽을 넘어온 표 포함)는 첫 줄이 표다
        bounds: t.geometricBounds, paras: paras
      });
    }
  }
  var regions = [];
  for (var k in tables) { var b = tables[k]; if (b.y1 > b.y0) regions.push({ page: b.page, x: b.x, y: b.y0, w: b.w, h: b.y1 - b.y0 }); }
  return { frames: frames, sizes: keys(sizes), leadings: keys(leadings), families: keys(families), text: text, cells: cells, tables: regions, apart: apart };
}

// H1·H2·H5: 줄이 바뀐 자리를 본다. 어절 가운데, 금칙 문자, 제목 덩어리 안에서 바뀐 줄 수
function breaks(texts, chunks) {
  var mid = 0, kin = 0, split = chunks ? 0 : null, at = 0, word = /[가-힣A-Za-z0-9]/;
  if (L.lang != "한글" && L.hyphenate) word = /[가-힣]/;   // 라틴 원고에서 낱말 가운데 바뀐 줄은 하이픈 자리다(영어 사전이 나눈다)
  for (var j = 0; j < texts.length; j++) {
    var forced = /[\n\u2028\u0003]$/.test(texts[j]);   // 강제 줄바꿈으로 끝난 줄은 어절을 끊은 게 아니다
    var line = texts[j].replace(/[\r\n\u2028\u0003]+$/, ""), end = line.replace(/\s+$/, "");
    // ’ 뒤에 숫자면 연도를 줄인 표시('25)라 닫는 따옴표가 아니다
    if (CLOSE.indexOf(line.charAt(0)) >= 0 && j > 0 && !(line.charAt(0) == "\u2019" && /\d/.test(line.charAt(1)))) kin++;
    if (OPEN.indexOf(end.charAt(end.length - 1)) >= 0 && j < texts.length - 1) kin++;
    at += line.length;
    if (j == texts.length - 1) break;
    var next = texts[j + 1].charAt(0);
    // 끊긴 낱말(긴 주소처럼)이 한 줄보다 길면 다른 데서 끊을 수 없었다
    var piece = (end.match(/\S+$/) || [""])[0] + (texts[j + 1].match(/^\S+/) || [""])[0];
    if (!forced && end.length == line.length && piece.length < line.length && word.test(end.charAt(end.length - 1)) && word.test(next)) mid++;
    // 덩어리 안: 줄 끝이 어느 덩어리의 시작과 끝 사이에 있다
    if (chunks) for (var c = 0; c < chunks.length; c++) if (at > chunks[c][0] && at < chunks[c][1]) split++;
  }
  return { midword: mid, kinsoku: kin, splits: split };
}
// H4: 문단 끝줄 하나만 다음 상자로 넘어갔다
function widow(lines) {
  if (lines.length < 2) return false;
  var a = safe(function () { return lines[lines.length - 1].parentTextFrames[0].id; }), b = safe(function () { return lines[lines.length - 2].parentTextFrames[0].id; });
  return a !== null && b !== null && a != b;
}
