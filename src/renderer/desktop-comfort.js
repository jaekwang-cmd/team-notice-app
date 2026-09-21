// Reuse the live chat DOM: history, file actions and tool execution stay unchanged.
(() => {
  const journal = document.getElementById('journal-panel');
  const side = journal.querySelector('.journal-sidepage');
  const aiPanel = document.getElementById('ai-panel');
  const chat = aiPanel.querySelector('.ai-card');
  const dock = document.createElement('section');
  dock.className = 'journal-ai-dock';
  dock.setAttribute('aria-label', '나의 AI 비서');
  side.appendChild(dock);
  function syncChat() {
    const destination = journal.classList.contains('hidden') ? aiPanel : dock;
    if (chat.parentElement !== destination) destination.appendChild(chat);
  }
  new MutationObserver(syncChat).observe(journal, { attributes: true, attributeFilter: ['class'] });
  syncChat();
  chat.querySelector('h3').textContent = '✧ 나의 AI 비서';

  const popup = document.getElementById('chulgo-settlement-popup');
  const card = popup.querySelector('.chulgo-settlement-card');
  const toolbar = document.createElement('div');
  toolbar.className = 'settlement-zoom-tools';
  toolbar.innerHTML = '<span>Ctrl + 마우스 휠로 확대</span><button type="button" aria-label="정산서 축소">−</button><button type="button" title="기본 크기로">100%</button><button type="button" aria-label="정산서 확대">+</button>';
  card.before(toolbar);
  let scale = 100;
  const buttons = toolbar.querySelectorAll('button');
  function zoom(next) {
    scale = Math.max(75, Math.min(200, next));
    card.style.zoom = String(scale / 100);
    buttons[1].textContent = `${scale}%`;
  }
  buttons[0].onclick = () => zoom(scale - 10);
  buttons[1].onclick = () => zoom(100);
  buttons[2].onclick = () => zoom(scale + 10);
  popup.addEventListener('wheel', event => {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    zoom(scale + (event.deltaY < 0 ? 10 : -10));
  }, { passive: false });
})();
