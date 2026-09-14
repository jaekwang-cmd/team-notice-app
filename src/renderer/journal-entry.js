// Shared quick-entry logic. Kept independent of the DOM for offline verification.
(function (root) {
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function buildPayload({ title, date, time = '', timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }) {
    title = String(title || '').trim();
    if (!title || title.length > 200) throw new Error('일정 제목을 1~200자로 적어주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dateKey(new Date(`${date}T12:00:00`)) !== date) throw new Error('날짜를 확인해주세요.');
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('시간을 확인해주세요.');
    let start, end;
    if (time) {
      const startDate = new Date(`${date}T${time}:00`);
      start = { dateTime: startDate.toISOString(), timeZone };
      end = { dateTime: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(), timeZone };
    } else {
      const tomorrow = new Date(`${date}T12:00:00`);
      tomorrow.setDate(tomorrow.getDate() + 1);
      start = { date }; end = { date: dateKey(tomorrow) };
    }
    return { event: { summary: title, start, end }, memo: { text: time ? `${time} · ${title}` : title, dueDate: date } };
  }
  async function create(api, payload) {
    let event;
    try { event = await api.googleCreateEvent(payload.event); }
    catch (error) { return { status: 'event-error', error }; }
    try {
      const memo = await api.createMemo(payload.memo);
      return { status: 'complete', event, memo };
    } catch (error) {
      // Do not re-send or roll back a successfully created calendar event.
      return { status: 'memo-error', event, error };
    }
  }
  const api = { buildPayload, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEntry = api;
})(globalThis);
