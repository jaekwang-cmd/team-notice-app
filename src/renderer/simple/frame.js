(() => {
  const menu = document.querySelector('.views');
  function notifyParent() {
    const view = menu.querySelector('[aria-current="page"]')?.dataset.view;
    if (view) parent.postMessage({ type: 'simple-page', view }, '*');
  }
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'simple-design' && ['mint','paper','blue','lavender','apricot','graphite'].includes(event.data.value)) {
      document.documentElement.dataset.simpleDesign = event.data.value;
      return;
    }
    if (event.data?.type !== 'select-simple-page') return;
    const view = event.data.view;
    if (view === 'day' || view === 'month') menu.querySelector('[data-view="' + view + '"]').click();
  });
  new MutationObserver(notifyParent).observe(menu, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  notifyParent();
})();
