// 분리형 "할 일" 위젯 — 메인 창의 메모칸과 같은 구글 Tasks 데이터를 보여주되, 날짜별로
// 거르지 않고 완료 안 된 것 전부를 한 번에 보여준다(폰 위젯과 같은 느낌).
const memoList = document.getElementById('memo-list');
const memoText = document.getElementById('memo-text');
const memoSend = document.getElementById('memo-send');
const memoAlarmEnable = document.getElementById('memo-alarm-enable');
const memoAlarmTime = document.getElementById('memo-alarm-time');
const signinBanner = document.getElementById('widget-signin-banner');
const signinBtn = document.getElementById('widget-signin-btn');

let memos = [];

// 메인 창에서 쓰는 개인 커스텀 테마를 그대로 입힌다(applyTheme 은 theme.js 에서 옴).
window.api.getTheme().then(applyTheme).catch((err) => console.error('테마 불러오기 실패:', err));
// 메인 창에서 설정을 바꾸는 동안 이 위젯을 재시작하지 않아도 바로 반영되게.
window.api.onThemeUpdate((theme) => applyTheme(theme));

// 이 위젯엔 로그인 버튼이 따로 없어서, 로그아웃 상태에선 뭘 눌러도 "실패했습니다"만
// 뜨고 어떻게 해야 하는지 알 방법이 없었다 — 여기서 바로 로그인할 수 있게 한다.
async function refreshSigninBanner() {
  const signedIn = await window.api.googleIsSignedIn();
  signinBanner.classList.toggle('hidden', signedIn);
  // 메인 창의 메모칸과 같은 규칙 — 로그인 전엔 눌러도 실패할 게 뻔하니 아예 입력을 막는다.
  memoText.disabled = !signedIn;
  memoSend.disabled = !signedIn;
  memoText.placeholder = signedIn ? '할 일을 입력하세요...' : '구글 로그인 후 이용할 수 있어요';
  return signedIn;
}
refreshSigninBanner();
// 메인 창에서 로그인/로그아웃해도 이 위젯이 바로 알 수 있게.
window.api.onAuthUpdated(() => refreshSigninBanner());

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  signinBtn.textContent = '로그인 대기 중...';
  try {
    await window.api.googleSignIn();
    await refreshSigninBanner();
  } catch (err) {
    console.error('로그인 실패:', err);
    showWidgetToast('로그인에 실패했습니다.');
  } finally {
    signinBtn.disabled = false;
    signinBtn.textContent = '로그인';
  }
});

// 실패를 콘솔에만 남기면 사용자 입장에선 "눌러도 반응 없음"으로 보인다 — 특히 권한
// 재동의 전(NOT_SIGNED_IN/스코프 부족)엔 매번 조용히 실패하므로, 눈에 보이게 알려준다.
let widgetToastEl = null;
let widgetToastTimer = null;
function showWidgetToast(message) {
  if (!widgetToastEl) {
    widgetToastEl = document.createElement('div');
    widgetToastEl.className = 'app-toast';
    document.body.appendChild(widgetToastEl);
  }
  widgetToastEl.textContent = message;
  widgetToastEl.classList.add('show');
  clearTimeout(widgetToastTimer);
  widgetToastTimer = setTimeout(() => widgetToastEl.classList.remove('show'), 4000);
}

function friendlyTaskError(err) {
  const msg = (err && err.message) || '';
  if (msg.includes('NOT_SIGNED_IN') || msg.includes('insufficient authentication scopes')) {
    return '구글 로그아웃 후 재로그인이 필요합니다(할 일 권한 추가 동의).';
  }
  return '처리에 실패했습니다.';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 마감일 없는 건 "언젠가 할 일"로 보고 위로, 있는 건 가까운 날짜부터.
function sortForWidget(list) {
  return [...list].sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return -1;
    if (!b.due) return 1;
    return new Date(a.due) - new Date(b.due);
  });
}

function dueLabel(dueIso) {
  if (!dueIso) return '';
  const d = new Date(dueIso);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const dKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (dKey === todayKey) return '오늘';
  const diffDays = Math.round((new Date(dKey.replace(/-/g, '/')) - new Date(todayKey.replace(/-/g, '/'))) / 86400000);
  if (diffDays < 0) return `${-diffDays}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function render() {
  memoList.innerHTML = '';
  const pending = sortForWidget(memos.filter((m) => !m.done));

  if (!pending.length) {
    const empty = document.createElement('div');
    empty.className = 'notice-empty';
    empty.textContent = '할 일이 없습니다.';
    memoList.appendChild(empty);
    return;
  }

  pending.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'notice-item';

    const badges = [];
    if (m.due) badges.push(`<span>${escapeHtml(dueLabel(m.due))}</span>`);
    if (m.alarmTime) badges.push(`<span>⏰ ${escapeHtml(m.alarmTime)}</span>`);
    if (badges.length) {
      const meta = document.createElement('div');
      meta.className = 'notice-meta';
      meta.innerHTML = badges.join('');
      item.appendChild(meta);
    }

    // 구글 Tasks 는 폰/Gmail 어디서나 체크박스로 완료 표시를 하므로 여기도 맞춘다.
    const row = document.createElement('div');
    row.className = 'notice-main-row';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'notice-check';

    const text = document.createElement('div');
    text.className = 'notice-text';
    text.textContent = m.text;

    check.onchange = () => {
      window.api.updateMemo({ id: m.id, done: true }).catch((err) => {
        console.error('완료 처리 실패:', err);
        showWidgetToast(friendlyTaskError(err));
        render(); // 실패했으니 방금 지운 항목을 다시 보여준다
      });
      item.remove(); // optimistic — 완료된 건 이 위젯에서 즉시 목록에서 뺀다
    };

    row.appendChild(check);
    row.appendChild(text);
    item.appendChild(row);

    const actions = document.createElement('div');
    actions.className = 'notice-actions';

    const delBtn = document.createElement('button');
    delBtn.textContent = '삭제';
    delBtn.onclick = async () => {
      if (!confirm('이 할 일을 삭제할까요?')) return;
      try {
        await window.api.deleteMemo(m.id);
      } catch (err) {
        console.error('삭제 실패:', err);
        showWidgetToast(friendlyTaskError(err));
      }
    };
    actions.appendChild(delBtn);

    item.appendChild(actions);
    memoList.appendChild(item);
  });
}

async function sendMemo() {
  const text = memoText.value.trim();
  if (!text) return;

  const data = { text };
  if (memoAlarmEnable.checked && memoAlarmTime.value) {
    const [h, m] = memoAlarmTime.value.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
    data.remindAt = target.getTime();
  }

  memoSend.disabled = true;
  try {
    await window.api.createMemo(data);
    memoText.value = '';
    memoAlarmEnable.checked = false;
    memoAlarmTime.value = '';
    memoAlarmTime.classList.add('hidden');
  } catch (err) {
    console.error('할 일 등록 실패:', err);
    showWidgetToast(friendlyTaskError(err));
  } finally {
    memoSend.disabled = false;
    memoText.focus();
  }
}

memoSend.addEventListener('click', sendMemo);
memoText.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') sendMemo();
});
memoAlarmEnable.addEventListener('change', () => {
  memoAlarmTime.classList.toggle('hidden', !memoAlarmEnable.checked);
});

window.api.onMemosUpdate((updated) => {
  memos = updated;
  render();
});

const memoAlarmPopup = document.getElementById('memo-alarm-popup');
const memoAlarmPopupText = document.getElementById('memo-alarm-text');
window.api.onMemoAlarm((memo) => {
  memoAlarmPopupText.textContent = memo.text;
  memoAlarmPopup.classList.remove('hidden');
  const target = memos.find((m) => m.id === memo.id);
  if (target) {
    target.alarmTime = null;
    render();
  }
});
document.getElementById('memo-alarm-close').addEventListener('click', () => {
  memoAlarmPopup.classList.add('hidden');
});
