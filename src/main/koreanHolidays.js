const Holidays = require('date-holidays');

const hd = new Holidays('KR');

const MS_DAY = 86400000;
const KST_OFFSET_MS = 9 * 3600000;

// hd.getHolidays()가 주는 date 필드 하나만 쓰면 설날/추석처럼 여러 날에 걸친 공휴일
// (YAML에 P3D로 선언됨)이 하루로 뭉개진다 — start/end(UTC, end는 배타적 경계)를
// 한국시간 기준 하루 단위로 펼쳐서 전날/당일/다음날을 각각 별도 날짜로 만든다.
function expandToDailyEntries(raw) {
  const out = [];
  raw.forEach((h) => {
    const startMs = new Date(h.start).getTime();
    const endMs = new Date(h.end).getTime();
    for (let t = startMs; t < endMs; t += MS_DAY) {
      out.push({ date: new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10), name: h.name });
    }
  });
  return out;
}

function publicHolidaysForYear(year) {
  return expandToDailyEntries(hd.getHolidays(year).filter((h) => h.type === 'public'));
}

// 날짜 문자열을 시스템 시간대와 무관하게(Date.UTC만으로) 다루기 위한 헬퍼 —
// 로컬 타임존에 의존하는 Date#setDate 등을 쓰면 사용자 PC 시간대에 따라 결과가 흔들린다.
function toUTCms(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUTCms(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  return fromUTCms(toUTCms(dateStr) + n * MS_DAY);
}
function dayOfWeek(dateStr) {
  return new Date(toUTCms(dateStr)).getUTCDay(); // 0=일 ~ 6=토
}

// --- 대체공휴일 (「관공서의 공휴일에 관한 규정」 제3조, 2023.5.4. 개정 기준) ---
// - 토요일·일요일과 겹치면 대체: 삼일절·제헌절(2026년 공휴일 편입 이후)·광복절·개천절·
//   한글날·어린이날·부처님오신날(석가탄신일)·기독탄신일
// - 설날·추석 연휴는 토요일과 겹친 것만으로는 대체가 안 생기고, 일요일이나 다른
//   공휴일과 겹칠 때만 생긴다
// - 신정(1/1)·현충일(6/6)은 대체공휴일 대상이 아니다
// - 대체공휴일 = 그 공휴일(연휴는 마지막 날) 다음의 첫 번째 비공휴일. 계산된 날이
//   토요일이면 한 번 더 다음 비공휴일로 순연된다(일요일은 어차피 공휴일이라 자동으로 넘어감)
// * 정부가 그때그때 국무회의로 지정하는 "임시공휴일"(예: 2025년 추석 연휴를 개천절·한글날과
//   이어붙인 임시공휴일)은 법으로 정해진 고정 규칙이 아니라 이 계산식으로 예측할 수 없다.
const WEEKEND_RULE_NAMES = new Set(['3·1절', '제헌절', '광복절', '개천절', '한글날', '어린이날', '석가탄신일', '기독탄신일']);
const SUNDAY_RULE_NAMES = new Set(['설날', '추석']);
const NO_SUBSTITUTE_NAMES = new Set(['신정', '현충일']);

function computeSubstitutes(base) {
  // 이름별로 묶어서 "연휴" 단위(설날/추석은 3일, 나머지는 1일)의 period를 만든다.
  // base에는 경계 계산을 위해 앞뒤 연도까지 섞여 있어서, 이름만으로 묶으면 서로 다른
  // 해의 같은 이름 공휴일(예: 2025년 설날과 2026년 설날)이 한 period로 합쳐져
  // "마지막 날"이 엉뚱한 해로 튀는 문제가 생긴다 — 날짜가 연속되는 구간(run)으로 쪼갠다.
  const names = [...new Set(base.map((h) => h.name))];
  let periods = [];
  names.forEach((name) => {
    const days = [...new Set(base.filter((h) => h.name === name).map((h) => h.date))].sort();
    let run = [];
    days.forEach((d) => {
      if (run.length && addDays(run[run.length - 1], 1) !== d) {
        periods.push({ names: [name], days: run });
        run = [];
      }
      run.push(d);
    });
    if (run.length) periods.push({ names: [name], days: run });
  });

  // 서로 다른 공휴일이 같은 날짜에 겹치면(예: 2025년 어린이날=석가탄신일) 대체공휴일이
  // 두 번 잡히지 않도록 하나의 period로 합친다.
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < periods.length; i += 1) {
      for (let j = i + 1; j < periods.length; j += 1) {
        if (periods[i].days.some((d) => periods[j].days.includes(d))) {
          const days = [...new Set([...periods[i].days, ...periods[j].days])].sort();
          const mergedNames = [...new Set([...periods[i].names, ...periods[j].names])];
          periods = periods.filter((_, idx) => idx !== i && idx !== j);
          periods.push({ names: mergedNames, days });
          merged = true;
          break outer;
        }
      }
    }
  }

  const occupied = new Set(base.map((h) => h.date));
  const isFree = (d) => !occupied.has(d) && dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6;

  const substitutes = [];
  periods.forEach((p) => {
    const substitutable = p.names.filter((n) => !NO_SUBSTITUTE_NAMES.has(n));
    if (!substitutable.length) return;

    const crossHolidayOverlap = p.names.length > 1;
    const isSundayRuleOnly = p.names.every((n) => SUNDAY_RULE_NAMES.has(n));
    const hitsSunday = p.days.some((d) => dayOfWeek(d) === 0);
    const hitsWeekend = p.days.some((d) => dayOfWeek(d) === 0 || dayOfWeek(d) === 6);
    const triggered = crossHolidayOverlap || (isSundayRuleOnly ? hitsSunday : hitsWeekend);
    if (!triggered) return;

    let candidate = addDays(p.days[p.days.length - 1], 1);
    while (!isFree(candidate)) candidate = addDays(candidate, 1);

    occupied.add(candidate);
    substitutes.push({ date: candidate, name: `${substitutable.join('·')} 대체공휴일` });
  });

  return substitutes;
}

function getHolidaysForYear(year) {
  const y = Number(year);
  // 대체공휴일 계산이 연말/연초 경계에 걸칠 가능성까지 대비해 앞뒤 해도 같이 놓고
  // 계산한 뒤, 최종 결과는 요청한 연도분만 돌려준다.
  const base = [
    ...publicHolidaysForYear(y - 1),
    ...publicHolidaysForYear(y),
    ...publicHolidaysForYear(y + 1),
  ];
  const substitutes = computeSubstitutes(base);

  return [...base, ...substitutes]
    .filter((h) => h.date.slice(0, 4) === String(y))
    .sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { getHolidaysForYear };
