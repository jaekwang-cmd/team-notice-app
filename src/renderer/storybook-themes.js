// PC keeps the original six illustrated worlds and adds three bright places.
(() => {
  const seeds = {
    cherryGarden: { isDark: false, bg: '#fbf0ed', surface: '#fffaf5', text: '#56413f', textSecondary: '#8a6a65', accent: '#b76478', sunday: '#ba6973', saturday: '#76948c' },
    lavenderField: { isDark: false, bg: '#f1eef6', surface: '#fffcf7', text: '#4c4560', textSecondary: '#80758d', accent: '#82709d', sunday: '#ba7780', saturday: '#668f91' },
    rainyCafe: { isDark: false, bg: '#e9efeb', surface: '#fffaf1', text: '#414d45', textSecondary: '#748172', accent: '#617d69', sunday: '#b77468', saturday: '#638990' },
  };
  for (const [id, seed] of Object.entries(seeds)) THEME_PRESETS[id] = buildPreset(seed);
  // Stars belong in the scenery; the writing surface remains light and readable.
  THEME_PRESETS.starObservatory = buildPreset({ isDark: false, bg: '#eeedf4', surface: '#fcfaf4',
    text: '#3e4053', textSecondary: '#737187', accent: '#77739f', sunday: '#ae737e', saturday: '#6489a3' });
  const additions = [
    { id: 'cherryGarden', label: '벚꽃 책방', blurb: '꽃길을 지나, 봄빛이 머무는 창가로' },
    { id: 'lavenderField', label: '라벤더의 오후', blurb: '보랏빛 들판과 작은 프로방스 서재' },
    { id: 'rainyCafe', label: '비 오는 정원', blurb: '유리창의 빗방울, 초록 정원의 작은 카페' },
  ];
  const original = THEME_PRESET_META.filter(theme => ['wood', 'nightStudy', 'secretForest', 'starObservatory', 'sunsetLetter', 'winterCabin'].includes(theme.id));
  THEME_PRESET_META.splice(0, THEME_PRESET_META.length, ...original, ...additions);
  window.storybookThemes = THEME_PRESET_META;
})();
