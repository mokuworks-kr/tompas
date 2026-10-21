// 맞추기: 넘친 글, 흐르는 글의 쪽수, 아래에 붙는 글의 시작 높이, 사진 윗선

// 넘침 자동 조정(docs/production.md): 스타일 변형 → 상자 크기(필드 단위) → 쪽 이동 → 축약 제안.
// 본문 크기는 바꾸지 않는다. 변형은 미리 만든 스타일(예: "Body 자간-10")로만 한다. 재정의는 없다.
// 쪽 이동은 상자가 이어진 긴 본문에서만 뜻이 있어 아직 하지 않는다(구축 순서 12). 남은 넘침은 몇 자 넘는지 적어 축약 제안으로 넘긴다.
function fit(doc) {
  var out = [], g = L.grid, m = g.margin, field = g.rowH + g.baseline;
  for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p], frames = [];
    var items = page.allPageItems;   // pageItems는 틀만 주고 종류(글 상자)를 가리지 못한다
    for (var i = 0; i < items.length; i++) if (loose(items[i]) && items[i].itemLayer.name == "글") frames.push(items[i]);
    for (var i = 0; i < frames.length; i++) {
      var t = frames[i];
      if (!(t instanceof TextFrame) || !t.overflows || INFLOW[t.id]) continue;
      var base = [], steps = [];
      for (var k = 0; k < t.parentStory.paragraphs.length; k++) base.push(t.parentStory.paragraphs[k].appliedParagraphStyle);
      // 1. 스타일 변형: 자간을 조금씩 좁힌다
      if (variant(doc, t, base, steps)) { out.push(done(p, t, steps)); continue; }
      restore(t, base);
      // 2. 상자 크기: 비어 있는 쪽으로 필드 하나씩 키운다. 판면과 다른 상자를 넘지 않는다
      var grew = 0;
      while (t.overflows && grow(t, frames, field, m, page)) grew++;
      if (grew) steps.push("상자 +" + grew + "필드");
      if (t.overflows && !variant(doc, t, base, steps)) restore(t, base);   // 변형으로도 안 되면 원래 스타일로 두고 축약 제안으로 넘긴다
      out.push(done(p, t, steps));
    }
  }
  return out;
}
function variant(doc, t, base, steps) {
  var tr = L.fit.tracking;
  for (var v = 0; v < tr.length; v++) {
    for (var k = 0; k < t.parentStory.paragraphs.length; k++) t.parentStory.paragraphs[k].appliedParagraphStyle = tightened(doc, base[k], tr[v]);
    t.recompose();
    if (!t.overflows) { steps.push("자간" + tr[v]); return true; }
  }
  return false;
}
// 변형 스타일은 원래 스타일 곁에 "이름 자간-10"으로 만든다(예: Body 자간-10)
function tightened(doc, ps, tr) {
  var name = ps.name + " 자간" + tr, home = ps.parent;
  var v = home.paragraphStyles.itemByName(name);
  if (!v.isValid) v = home.paragraphStyles.add({ name: name, basedOn: ps, tracking: tr });
  return v;
}
function restore(t, base) { for (var k = 0; k < t.parentStory.paragraphs.length; k++) t.parentStory.paragraphs[k].appliedParagraphStyle = base[k]; t.recompose(); }
function grow(t, frames, field, m, page) {
  var b = t.geometricBounds, up = t.textFramePreferences.verticalJustification == VerticalJustification.BOTTOM_ALIGN;
  var nb = up ? [b[0] - field, b[1], b[2], b[3]] : [b[0], b[1], b[2] + field, b[3]];
  if (nb[0] < m.top - 0.01 || nb[2] > L.page.h - m.bottom + 0.01) return false;
  for (var i = 0; i < frames.length; i++) {
    if (frames[i] == t) continue;
    var o = frames[i].geometricBounds;
    if (o[0] < nb[2] - 0.1 && o[2] > nb[0] + 0.1 && o[1] < nb[3] - 0.1 && o[3] > nb[1] + 0.1) return false;
  }
  t.geometricBounds = nb; t.recompose();
  return true;
}
function done(p, t, steps) {
  var over = t.overflows ? t.parentStory.characters.length - t.characters.length : 0;
  return { page: p + 1, name: t.name, steps: steps, overset: over };
}

// 흐르는 이야기가 몇 쪽을 쓰는지 잰다. 넘치면 이야기 끝 쪽 뒤에 같은 쪽의 상자 자리를 본뜬 쪽을 더해 가며 다 들어갈 때까지 잇는다.
// 이 쪽 더하기는 재기만을 위한 것이다(뒤 쪽의 좌우가 바뀐다). 계획과 다르면 render/index.ts가 layout부터 다시 돈다.
// 쪽수를 두 쪽씩 바꾸는 문서(layout)도 있어, 계획보다 많거나 두 쪽 넘게 적을 때만 다시 돈다. 한 쪽 적으면 끝 쪽이 빈다(리포트가 알린다)
function measureFlows(doc) {
  var out = {};
  for (var f in FLOWS) {
    var fs = FLOWS[f], pages = {}, first = fs[0].parentPage.documentOffset, planned = 0;
    for (var i = 0; i < fs.length; i++) if (!pages[fs[i].parentPage.documentOffset]) { pages[fs[i].parentPage.documentOffset] = 1; planned++; }
    var added = 0;
    while (fs[fs.length - 1].overflows && added < 200) {
      var last = fs[fs.length - 1].parentPage, model = null;
      var np = doc.pages.add(LocationOptions.AFTER, last);
      for (var i = fs.length - 1; i >= 0 && !model; i--) if (fs[i].parentPage.side == np.side) model = fs[i].parentPage;
      // 같은 쪽(왼·오른)이 없으면(한 쪽짜리 이야기) 마지막 쪽을 좌우로 뒤집어 본뜬다. 안쪽·바깥 여백이 바뀐다
      var flip = !model;
      if (flip) model = last;
      var made = 0;
      for (var i = 0; i < fs.length && model; i++) if (fs[i].parentPage == model || fs[i].parentPage.id == model.id) {
        var b = fs[i].geometricBounds, mb = model.bounds, nb = np.bounds;
        var x = flip ? [nb[1] + mb[3] - b[3], nb[1] + mb[3] - b[1]] : [b[1] - mb[1] + nb[1], b[3] - mb[1] + nb[1]];
        var t = np.textFrames.add(fs[i].itemLayer, undefined, undefined, { geometricBounds: [b[0], x[0], b[2], x[1]] });
        t.textFramePreferences.insetSpacing = [0, 0, 0, 0];
        fs[fs.length - 1].nextTextFrame = t; fs.push(t); made++;
      }
      if (!made) break;
      added++; fs[fs.length - 1].recompose();
      if (PICS.length) pictures(doc);
    }
    // 글이 실제로 닿은 마지막 쪽
    var end = first;
    for (var i = 0; i < fs.length; i++) if (fs[i].characters.length) end = Math.max(end, fs[i].parentPage.documentOffset);
    var need = end - first + 1, diff = need - planned;
    out[f] = { planned: planned, need: need, overflows: fs[fs.length - 1].overflows, rerun: diff > 0 || diff <= -2 };
  }
  return out;
}

// 아래에 붙는 글(↓)의 시작 높이: 같은 와이어프레임의 같은 영역(같은 줄의 칸)은 쪽마다 같은 높이에서 시작한다.
// 그 묶음에서 가장 긴 글이 영역 아래에 딱 붙는 높이가 공통 시작선이다. 짧은 글은 아래 요소와의 간격만 몇 줄 넓어진다.
// 한 상자만 유난히 길면(둘째보다 3줄 넘게) 그 상자를 알린다. 에이전트가 줄일 문장을 제안하거나 변형을 쓴다
function align(doc) {
  var bl = L.grid.baseline, groups = {}, out = [];
  for (var p = 0; p < doc.pages.length; p++) {
    var tfs = doc.pages[p].textFrames;
    for (var i = 0; i < tfs.length; i++) if (tfs[i].label) (groups[tfs[i].label] = groups[tfs[i].label] || []).push(tfs[i]);
  }
  for (var key in groups) {
    var fs = groups[key], need = [];
    for (var i = 0; i < fs.length; i++) {
      var t = fs[i];
      t.textFramePreferences.verticalJustification = VerticalJustification.TOP_ALIGN;
      t.recompose();
      // 기준선 몇 줄을 쓰는가. 상자 위가 기준선 위에 있어 첫 줄은 한 줄 아래에 앉는다
      need.push(t.overflows || !t.lines.length ? null : Math.round((t.lines[-1].baseline - t.geometricBounds[0]) / bl));
    }
    var most = 0, second = 0, who = null;
    for (var i = 0; i < need.length; i++) if (need[i] !== null) { if (need[i] > most) { second = most; most = need[i]; who = fs[i]; } else if (need[i] > second) second = need[i]; }
    // 가장 긴 글은 InDesign의 아래 정렬 그대로 두고, 그 첫 줄 높이에서 나머지가 시작한다(상자 위는 그 한 줄 위 기준선)
    for (var i = 0; i < fs.length; i++) if (need[i] === null || fs[i] == who) fs[i].textFramePreferences.verticalJustification = VerticalJustification.BOTTOM_ALIGN;
    if (!who) continue;
    who.recompose();
    var top = who.lines[0].baseline - bl;
    for (var i = 0; i < fs.length; i++) {
      if (need[i] === null || fs[i] == who) continue;
      var b = fs[i].geometricBounds;
      fs[i].geometricBounds = [top, b[1], b[2], b[3]];
      fs[i].recompose();
      if (fs[i].overflows) { fs[i].geometricBounds = b; fs[i].textFramePreferences.verticalJustification = VerticalJustification.BOTTOM_ALIGN; }
    }
    out.push({ group: key, lines: most, frames: fs.length, alone: fs.length > 1 && most - second > 3 ? who.name : null });
  }
  return out;
}

// L3: 옆 글과 같은 필드선에서 시작하는 사진은 윗선을 그 글의 대문자 윗선까지 내린다.
// 상자는 같은 선에서 시작해도, 눈에 보이는 글의 윗선은 첫 기준선만큼 아래에 있다. 아랫선은 필드선(기준선) 그대로 둔다
function capAlign(doc) {
  for (var sp = 0; sp < doc.spreads.length; sp++) {
    var spread = doc.spreads[sp], rects = [], texts = [];
    for (var i = 0; i < spread.allPageItems.length; i++) {
      var it = spread.allPageItems[i];
      if (!loose(it) || it.itemLayer.name != "글") continue;
      if (it instanceof Rectangle) rects.push(it);
      else if (it instanceof TextFrame && it.lines.length) texts.push(it);
    }
    for (var r = 0; r < rects.length; r++) {
      var b = rects[r].geometricBounds, cap = null;
      for (var t = 0; t < texts.length; t++) {
        if (Math.abs(texts[t].geometricBounds[0] - b[0]) > 0.1) continue;
        if (safe(function () { return texts[t].lines[0].tables.length; })) continue;   // 표로 시작하는 상자는 첫 줄이 표다
        var line = texts[t].lines[0], st = L.styles[line.appliedParagraphStyle.name.replace(/ 자간-?\d+$/, "")];
        var top = line.baseline - (st ? st.capHeight : 0.73) * line.pointSize;   // 스크립트 단위가 mm라 크기도 mm로 온다
        if (cap === null || top < cap) cap = top;
      }
      if (cap !== null) rects[r].geometricBounds = [cap, b[1], b[2], b[3]];
    }
  }
}
