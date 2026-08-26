// 사용자가 설정에서 고른 색상 테마를 CSS 변수로 입히는 로직 — 메인 창과 분리형
// "할 일" 위젯이 똑같은 테마를 보여줘야 해서 공용 스크립트로 뺐다.
// (양쪽 다 <script src="theme.js"> 로 이 파일을 먼저 불러온 뒤 renderer 스크립트를 로드한다.)

const COLOR_FIELDS = [
  { key: 'bg', id: 'theme-bg', cssVar: '--color-app-bg' },
  { key: 'panelBg', id: 'theme-panel-bg', cssVar: '--color-panel-bg', shadeVars: ['--color-panel-tint-light', '--color-panel-tint-dark'] },
  { key: 'accent', id: 'theme-accent', cssVar: '--color-accent', shadeVars: ['--color-accent-2'] },
  { key: 'border', id: 'theme-border', cssVar: '--color-border' },
  { key: 'divider', id: 'theme-divider', cssVar: '--color-divider' },
  { key: 'calendarBg', id: 'theme-calendar-bg', cssVar: '--color-calendar-bg' },
  { key: 'cellBg', id: 'theme-cell-bg', cssVar: '--color-day-cell-bg' },
  { key: 'cellHover', id: 'theme-cell-hover', cssVar: '--color-day-cell-hover' },
  { key: 'selectedDay', id: 'theme-selected-day', cssVar: '--color-selected-day-bg' },
  { key: 'today', id: 'theme-today', cssVar: '--color-today-bg' },
  { key: 'mutedDate', id: 'theme-muted-date', cssVar: '--color-muted-date' },
  { key: 'sunday', id: 'theme-sunday', cssVar: '--color-sunday' },
  { key: 'saturday', id: 'theme-saturday', cssVar: '--color-saturday' },
  { key: 'eventBg', id: 'theme-event-bg', cssVar: '--color-event-bg' },
  { key: 'eventBorder', id: 'theme-event-border', cssVar: '--color-event-border' },
  { key: 'eventText', id: 'theme-event-text', cssVar: '--color-event-text' },
  { key: 'inputBg', id: 'theme-input-bg', cssVar: '--color-input-bg' },
  { key: 'buttonBg', id: 'theme-button-bg', cssVar: '--color-button-bg' },
  { key: 'buttonText', id: 'theme-button-text', cssVar: '--color-button-text' },
  { key: 'secondaryButtonBg', id: 'theme-secondary-button-bg', cssVar: '--color-secondary-button-bg' },
  { key: 'text', id: 'theme-text', cssVar: '--color-text-primary' },
  { key: 'textSecondary', id: 'theme-text-secondary', cssVar: '--color-text-secondary' },
];

// positive amount lightens, negative darkens (clamped to the 0-255 range per channel)
function shadeHex(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// shadeHex는 "밝기만" 옮기지만, 서로 다른 색조(예: 배경의 회색 vs 강조색의 파랑)를
// 자연스럽게 섞을 땐 실제 RGB 선형 보간이 훨씬 자연스럽다 — 프리셋의 selectedDay/today/
// eventBg 처럼 "강조색을 배경 쪽으로 옅게 희석한" 값을 만들 때 쓴다.
function mixHex(hexA, hexB, t) {
  const a = parseInt(hexA.replace('#', ''), 16);
  const b = parseInt(hexB.replace('#', ''), 16);
  const ch = (shift) => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * t);
  };
  const r = ch(16), g = ch(8), bch = ch(0);
  return `#${((r << 16) | (g << 8) | bch).toString(16).padStart(6, '0')}`;
}

// 팔레트 하나를 "씨앗 색 6~7개"에서 나머지 15개 필드로 파생시킨다 — 21개 필드를 프리셋마다
// 일일이 손으로 채우면 (a) 시간이 오래 걸리고 (b) 프리셋 사이에 명도/채도 규칙이 미묘하게
// 어긋나기 쉽다. 여기서 한 번만 정확히 정의해두면 모든 프리셋이 같은 계층 규칙을 공유한다.
function buildPreset(seed) {
  const { isDark, bg, surface, text, textSecondary, accent, sunday, saturday } = seed;
  const up = isDark ? 1 : -1; // 다크는 "밝게"가 계층을 올리는 방향, 라이트는 "어둡게"가 그 방향
  return {
    bg,
    panelBg: surface,
    accent,
    border: shadeHex(surface, up * 30),
    divider: shadeHex(surface, up * 16),
    calendarBg: bg,
    cellBg: shadeHex(bg, up * 5),
    cellHover: shadeHex(surface, up * 16),
    selectedDay: mixHex(accent, bg, isDark ? 0.68 : 0.78),
    today: mixHex(accent, bg, isDark ? 0.82 : 0.88),
    mutedDate: mixHex(textSecondary, bg, 0.45),
    sunday,
    saturday,
    eventBg: mixHex(accent, bg, isDark ? 0.85 : 0.9),
    eventBorder: mixHex(accent, bg, isDark ? 0.45 : 0.55),
    eventText: text,
    inputBg: shadeHex(surface, up * 4),
    buttonBg: accent,
    buttonText: '#ffffff',
    secondaryButtonBg: mixHex(accent, bg, isDark ? 0.72 : 0.8),
    text,
    textSecondary,
    dateFontSize: '11',
    eventFontSize: '9',
  };
}

// --- 기본 다크/라이트 (기존 톤을 이어받되, 순수 검정/순수 흰색 남발을 줄이고
// 계층(배경/서피스/보더)을 더 뚜렷하게 나눴다) ---
const DARK_DEFAULTS = buildPreset({
  isDark: true,
  bg: '#1b1d24',
  surface: '#242730',
  text: '#e7e9f0',
  textSecondary: '#9aa0b4',
  accent: '#7c93f5',
  sunday: '#ef8a8a',
  saturday: '#7fa8f0',
});

const LIGHT_DEFAULTS = buildPreset({
  isDark: false,
  bg: '#eef0f4',
  surface: '#ffffff',
  text: '#20242e',
  textSecondary: '#667085',
  accent: '#5b63d6',
  sunday: '#e0645f',
  saturday: '#4f7fd6',
});

// --- 추가 프리셋 5종 — "Accent 색만 다른 복사본"이 아니라 배경/서피스 톤(중립·웜·네이비 등)
// 자체가 다른, 서로 완결된 팔레트가 되도록 씨앗값을 따로 잡았다. ---
const THEME_PRESET_SEEDS = {
  softDark: {
    isDark: true, bg: '#211f1e', surface: '#2b2825', text: '#ece7e1', textSecondary: '#a89f95',
    accent: '#d2954f', sunday: '#e2887c', saturday: '#7fa0c9',
  },
  midnight: {
    isDark: true, bg: '#12141f', surface: '#1b1f2e', text: '#e2e6f5', textSecondary: '#8992b8',
    accent: '#6d8dfb', sunday: '#f08a8a', saturday: '#7fb0ff',
  },
  forest: {
    isDark: false, bg: '#eef2ee', surface: '#ffffff', text: '#20291f', textSecondary: '#5b6b57',
    accent: '#4f8f6b', sunday: '#d1665f', saturday: '#4f7fae',
  },
  ocean: {
    isDark: false, bg: '#eaf2f5', surface: '#ffffff', text: '#1c2b33', textSecondary: '#5a7480',
    accent: '#3d94ad', sunday: '#d1665f', saturday: '#3d7fae',
  },
  lavender: {
    isDark: false, bg: '#f2f0f6', surface: '#ffffff', text: '#2a2438', textSecondary: '#726a85',
    accent: '#8570c9', sunday: '#d1665f', saturday: '#5f7fc9',
  },
};

const THEME_PRESETS = { dark: DARK_DEFAULTS, light: LIGHT_DEFAULTS };
Object.keys(THEME_PRESET_SEEDS).forEach((id) => {
  THEME_PRESETS[id] = buildPreset(THEME_PRESET_SEEDS[id]);
});

// 설정 화면의 프리셋 미리보기 카드를 그릴 때 쓰는 메타 정보 — 실제 색은
// THEME_PRESETS[id]에서 그대로 가져오므로 여기엔 이름/한 줄 설명만 둔다.
const THEME_PRESET_META = [
  { id: 'dark', label: '다크', blurb: '차분한 슬레이트 톤' },
  { id: 'light', label: '라이트', blurb: '깔끔한 뉴트럴 톤' },
  { id: 'softDark', label: '소프트 다크', blurb: '따뜻한 차콜 + 앰버' },
  { id: 'midnight', label: '미드나잇', blurb: '깊은 네이비 + 인디고' },
  { id: 'forest', label: '포레스트', blurb: '뉴트럴 + 세이지 그린' },
  { id: 'ocean', label: '오션', blurb: '뉴트럴 + 뮤트 틸' },
  { id: 'lavender', label: '라벤더', blurb: '뉴트럴 + 뮤트 퍼플' },
];

function applyTheme(theme) {
  const root = document.documentElement.style;

  COLOR_FIELDS.forEach((f) => {
    const value = theme[f.key];
    if (value) {
      root.setProperty(f.cssVar, value);
      if (f.shadeVars) {
        root.setProperty(f.shadeVars[0], shadeHex(value, 40));
        if (f.shadeVars[1]) root.setProperty(f.shadeVars[1], shadeHex(value, -40));
      }
    } else {
      root.removeProperty(f.cssVar);
      (f.shadeVars || []).forEach((v) => root.removeProperty(v));
    }
  });

  if (theme.font) root.setProperty('--font-family', theme.font);
  else root.removeProperty('--font-family');

  root.setProperty('--calendar-date-font-size', `${theme.dateFontSize || DARK_DEFAULTS.dateFontSize}px`);
  root.setProperty('--calendar-event-font-size', `${theme.eventFontSize || DARK_DEFAULTS.eventFontSize}px`);

  document.body.setAttribute('data-bold', theme.bold ? 'true' : 'false');
  document.body.setAttribute('data-card-style', theme.cardStyle || 'glass');
}
