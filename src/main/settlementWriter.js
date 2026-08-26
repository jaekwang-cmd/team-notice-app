// 정산서 엑셀 작성기
//
// 회사에서 받은 실제 정산서 서식은 한 칸도 달라지면 안 된다. 엑셀 라이브러리로
// 읽고 다시 쓰면 표시형식의 escape 가 빠지거나(\-* #,##0 -> -* #,##0) 데이터
// 유효성 검사가 중복 생성되는 등 미묘하게 바뀌는 게 있어서, 여기서는 xlsx(zip)
// 안의 시트 XML만 직접 손대고 나머지 파트는 원본 바이트 그대로 둔다.
const fs = require('fs');
const JSZip = require('jszip');

const COL_LETTERS = (n) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// 열 문자를 숫자로 (A=1). 정렬해서 셀을 알맞은 자리에 끼워 넣을 때 쓴다.
function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * 시트 XML에서 셀 하나의 값을 바꾼다. 스타일(s 속성)은 반드시 그대로 둔다.
 * value: {type:'n'|'s'|'f'|'blank', value}
 */
function setCell(xml, addr, spec) {
  const rowNum = Number(addr.match(/\d+$/)[0]);
  const cellRe = new RegExp(
    `<c r="${addr}"((?:\\s+[a-zA-Z:]+="[^"]*")*)\\s*(?:/>|>[\\s\\S]*?</c>)`
  );
  const m = xml.match(cellRe);

  const styleOf = (attrs) => {
    const s = /\s+s="(\d+)"/.exec(attrs || '');
    return s ? ` s="${s[1]}"` : '';
  };

  const build = (style) => {
    if (spec.type === 'blank') return `<c r="${addr}"${style}/>`;
    if (spec.type === 'n') return `<c r="${addr}"${style}><v>${spec.value}</v></c>`;
    if (spec.type === 'f') return `<c r="${addr}"${style}><f>${xmlEscape(spec.value)}</f></c>`;
    return `<c r="${addr}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(spec.value)}</t></is></c>`;
  };

  if (m) {
    return xml.slice(0, m.index) + build(styleOf(m[1])) + xml.slice(m.index + m[0].length);
  }

  // 셀이 아직 없으면 해당 행 안에서 열 순서를 지켜 끼워 넣는다.
  const rowRe = new RegExp(`<row[^>]*\\br="${rowNum}"[^>]*(?:/>|>[\\s\\S]*?</row>)`);
  const rm = xml.match(rowRe);
  if (!rm) return xml;                       // 행 자체가 없으면 건드리지 않는다
  let rowXml = rm[0];
  if (rowXml.endsWith('/>')) {
    rowXml = rowXml.slice(0, -2) + `>${build('')}</row>`;
  } else {
    const target = colNum(addr.match(/^[A-Z]+/)[0]);
    const cells = [...rowXml.matchAll(/<c r="([A-Z]+)\d+"/g)];
    const after = cells.find((c) => colNum(c[1]) > target);
    const pos = after ? after.index : rowXml.lastIndexOf('</row>');
    rowXml = rowXml.slice(0, pos) + build('') + rowXml.slice(pos);
  }
  return xml.slice(0, rm.index) + rowXml + xml.slice(rm.index + rm[0].length);
}

/**
 * 수식 셀에 저장된 "계산 결과 캐시"(<v>)를 지운다.
 * 자기닫힘 셀(<c .../>)은 자식이 없으므로 건너뛴다.
 */
function stripFormulaCache(xml) {
  // (?<!\/)> 로 자기닫힘 셀(<c .../>)을 제외한다. 안 그러면 빈 셀부터 다음 </c> 까지를
  // 한 덩어리로 잡아서 엉뚱한 셀의 값까지 지운다.
  return xml.replace(/<c\b[^>]*(?<!\/)>[\s\S]*?<\/c>/g, (cell) =>
    (cell.includes('<f') ? cell.replace(/<v>[^<]*<\/v>/g, '') : cell));
}

/** 파일을 열 때 모든 수식을 다시 계산하도록 표시한다. */
function forceFullRecalc(wbXml) {
  if (/<calcPr[^>]*\/>/.test(wbXml)) {
    return wbXml.replace(/<calcPr([^>]*?)\/>/, (m, attrs) =>
      attrs.includes('fullCalcOnLoad') ? m : `<calcPr${attrs} fullCalcOnLoad="1"/>`);
  }
  return wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
}

/**
 * 템플릿을 읽어 값만 채운 뒤 새 xlsx 버퍼를 만든다.
 * cells: { 'B7': {type,value}, ... }
 */
async function writeSettlement(templatePath, cells, sheetName) {
  const src = await JSZip.loadAsync(fs.readFileSync(templatePath));

  let sheetXml = await src.file('xl/worksheets/sheet1.xml').async('string');
  for (const [addr, spec] of Object.entries(cells)) {
    sheetXml = setCell(sheetXml, addr, spec);
  }

  // 수식 셀에 남아 있는 지난달 계산 결과(<v>)를 지운다. 이게 남아 있으면 H/J/M 에
  // 새 값을 넣어도 엑셀이 옆 수식칸에 예전 숫자를 그대로 보여준다(셀을 지웠다
  // 되돌려야 갱신되는 현상).
  sheetXml = stripFormulaCache(sheetXml);

  let wbXml = await src.file('xl/workbook.xml').async('string');
  if (sheetName) {
    // 첫 번째 <sheet .../> 의 name 만 바꾼다 (원장 시트 이름은 그대로 둔다)
    wbXml = wbXml.replace(/<sheet\s+name="[^"]*"/, `<sheet name="${xmlEscape(sheetName)}"`);
  }
  wbXml = forceFullRecalc(wbXml);

  // 원본 xlsx 에는 폴더 항목이 없는데 JSZip 은 다시 저장할 때 이를 만들어 넣는다.
  // 파트 구성까지 원본과 똑같이 맞추려고 파일 항목만 새 zip 으로 옮겨 담는다.
  const out = new JSZip();
  const overrides = { 'xl/worksheets/sheet1.xml': sheetXml, 'xl/workbook.xml': wbXml };
  for (const name of Object.keys(src.files)) {
    const entry = src.files[name];
    if (entry.dir) continue;
    const data = overrides[name] !== undefined
      ? overrides[name]
      : await entry.async('nodebuffer');
    out.file(name, data, { createFolders: false, date: entry.date });
  }

  return out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', createFolders: false });
}

module.exports = { writeSettlement, COL_LETTERS, setCell, stripFormulaCache, forceFullRecalc };
