// Download only the selected typeface; system fallbacks remain available offline.
(() => {
  const fonts = [
    { family: 'Gowun Dodum', label: '고운돋움 · 부드러운 고딕', group: '깔끔한 글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Nanum Gothic', label: '나눔고딕 · 편안한 기본체', group: '깔끔한 글씨', weights: '400;700', fallback: 'sans-serif' },
    { family: 'Gothic A1', label: 'Gothic A1 · 단정한 고딕', group: '깔끔한 글씨', weights: '400;600', fallback: 'sans-serif' },
    { family: 'Noto Serif KR', label: 'Noto Serif KR · 정갈한 명조', group: '다이어리 글씨', weights: '400;600', fallback: 'serif' },
    { family: 'Gowun Batang', label: '고운바탕 · 따뜻한 책 느낌', group: '다이어리 글씨', weights: '400;700', fallback: 'serif' },
    { family: 'Nanum Myeongjo', label: '나눔명조 · 차분한 기록', group: '다이어리 글씨', weights: '400;700', fallback: 'serif' },
    { family: 'Nanum Pen Script', label: '나눔손글씨 펜 · 손글씨', group: '손글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Gaegu', label: '개구 · 가벼운 손글씨', group: '손글씨', weights: '400;700', fallback: 'sans-serif' },
    { family: 'Hi Melody', label: '하이 멜로디 · 또박또박 손글씨', group: '손글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Gamja Flower', label: '감자꽃 · 둥근 손글씨', group: '손글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Single Day', label: '싱글데이 · 편안한 일기체', group: '손글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Nanum Brush Script', label: '나눔손글씨 붓 · 자연스러운 붓글씨', group: '손글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Poor Story', label: '푸어스토리 · 소박한 손글씨', group: '손글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Jua', label: '주아 · 도톰한 둥근 글씨', group: '깔끔한 글씨', weights: '400', fallback: 'sans-serif' },
    { family: 'Hahmlet', label: '함렛 · 선명한 책 글씨', group: '다이어리 글씨', weights: '400', fallback: 'serif' },
    { family: 'Diphylleia', label: '산하엽 · 부드러운 명조', group: '다이어리 글씨', weights: '400', fallback: 'serif' },
  ];
  const requested = new Set();
  function ensureLoaded(fontStack) {
    const font = fonts.find(item => String(fontStack).startsWith(`'${item.family}'`));
    if (!font || requested.has(font.family)) return;
    requested.add(font.family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + new URLSearchParams({ family: `${font.family}:wght@${font.weights}`, display: 'swap' });
    link.onerror = () => { requested.delete(font.family); link.remove(); };
    document.head.appendChild(link);
  }
  const picker = document.getElementById('theme-font');
  if (picker) {
    const groups = new Map();
    fonts.forEach(font => {
      if (!groups.has(font.group)) {
        const group = document.createElement('optgroup'); group.label = font.group; picker.appendChild(group); groups.set(font.group, group);
      }
      const option = document.createElement('option');
      option.value = `'${font.family}', 'Malgun Gothic', ${font.fallback}`;
      option.textContent = font.label;
      groups.get(font.group).appendChild(option);
    });
  }
  window.appFonts = { ensureLoaded };
})();
