/* Desktop ledger presentation. Existing calculations, row saves and exports remain authoritative. */
(() => {
  const panel = document.getElementById('chulgo-panel');
  const $ = (id) => document.getElementById(id);
  const esc = escapeHtml;
  const actions = document.createElement('div'); actions.className = 'ledger-entry-actions';
  const add = $('chulgo-add-row'), ai = $('chulgo-ai-fill-btn');
  add.textContent = '＋ 직접 추가'; add.className = 'btn ledger-direct-add';
  ai.textContent = '✧ AI로 출고건 추가하기'; ai.className = 'btn ledger-ai-add';
  actions.append(add, ai); panel.querySelector('.chulgo-header').insertBefore(actions, $('chulgo-refresh'));
  $('chulgo-empty').textContent = '등록된 출고 건이 없습니다. 직접 추가하거나 AI로 내용을 채워보세요.';

  const goal = document.createElement('section'); goal.className = 'ledger-goal';
  goal.setAttribute('aria-label', '월별 목표 달성률');
  goal.innerHTML = `<div class="ledger-goal-head"><h3>이번 달 달성률</h3><span id="ledger-goal-month"></span></div><div class="ledger-goal-main"><strong id="ledger-goal-percent">—</strong><div class="ledger-goal-progress"><div class="ledger-goal-counts"><span id="ledger-goal-count"></span><span id="ledger-goal-badge"></span></div><div class="ledger-goal-track" role="meter" aria-label="월 목표 달성률" aria-valuemin="0"><div class="ledger-goal-fill"><div class="ledger-goal-extra"></div></div><span class="ledger-goal-marker">100%</span></div><div class="ledger-goal-scale"><span>0%</span><span id="ledger-goal-max">100%</span></div></div></div><details><summary>목표 설정</summary><form id="ledger-goal-form"><label><span id="ledger-goal-label">월 목표</span><input id="ledger-goal-input" type="number" min="1" step="1" required aria-label="월 목표 대수"> 대</label><button class="btn" type="submit">저장</button><span>인정 대수 기준 · 계정별로 이 PC에 저장</span></form><p id="ledger-goal-error" role="status"></p></details>`;
  panel.prepend(goal);
  let goalContext = '', goalKey = '', goalMonth = '';
  function refresh() {
    const month = chulgoActiveMonth(); if (!month) return;
    const uid = currentUser?.uid || '';
    const key = `yeobaek_ledger_goals_v1:${uid}`;
    let targets = {}; try { targets = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
    const target = Number(targets[month]);
    const valid = Number.isSafeInteger(target) && target > 0;
    const achieved = chulgoCountedUnits(chulgoEntries.filter(e => e.month === month));
    const percent = valid ? achieved / target * 100 : 0;
    const max = Math.max(100, Math.ceil(percent / 100) * 100);
    const n = value => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
    $('ledger-goal-month').textContent = chulgoMonthLabel(month);
    $('ledger-goal-percent').textContent = valid ? `${n(percent)}%` : '목표 미설정';
    $('ledger-goal-percent').classList.toggle('unset', !valid);
    $('ledger-goal-count').textContent = `${n(achieved)}대 달성${valid ? ` / 목표 ${n(target)}대` : ''}`;
    $('ledger-goal-badge').textContent = !valid ? '이번 달 목표를 정해보세요' : percent > 100 ? `+${n(achieved-target)}대 초과` : percent === 100 ? '목표 달성' : `${n(target-achieved)}대 남음`;
    const meter = goal.querySelector('[role=meter]');
    meter.setAttribute('aria-valuenow', String(percent)); meter.setAttribute('aria-valuemax', String(max));
    meter.setAttribute('aria-valuetext', valid ? `${n(percent)}%, 목표 ${target}대 중 ${achieved}대 달성` : '목표 미설정');
    goal.querySelector('.ledger-goal-fill').style.width = `${percent / max * 100}%`;
    goal.querySelector('.ledger-goal-extra').style.width = `${percent > 100 ? (percent - 100) / percent * 100 : 0}%`;
    goal.querySelector('.ledger-goal-marker').style.left = `${100 / max * 100}%`;
    $('ledger-goal-max').textContent = `${n(max)}%`;
    if (goalContext !== `${uid}:${month}`) {
      goalContext = `${uid}:${month}`; goalKey = key; goalMonth = month;
      $('ledger-goal-input').value = valid ? target : '';
      $('ledger-goal-label').textContent = `${chulgoMonthLabel(month)} 목표`;
      $('ledger-goal-error').textContent = '';
    }
  }
  $('ledger-goal-form').onsubmit = e => {
    e.preventDefault();
    const value = Number($('ledger-goal-input').value);
    if (!currentUser?.uid) { $('ledger-goal-error').textContent = '로그인 후 목표를 설정해주세요.'; return; }
    if (!Number.isSafeInteger(value) || value < 1) return;
    try {
      const saved = JSON.parse(localStorage.getItem(goalKey) || '{}') || {};
      saved[goalMonth] = value; localStorage.setItem(goalKey, JSON.stringify(saved));
      refresh(); goal.querySelector('details').open = false; showToast('월 목표를 저장했어요.');
    } catch (_) { $('ledger-goal-error').textContent = '목표를 저장하지 못했어요. 다시 시도해주세요.'; }
  };

  const drawer = document.createElement('div'); drawer.id = 'ledger-entry-drawer';
  drawer.className = 'chulgo-mini-overlay ledger-drawer hidden';
  drawer.innerHTML = `<section class="ledger-drawer-card" role="dialog" aria-modal="true" aria-labelledby="ledger-entry-title"><header><div><h3 id="ledger-entry-title">새로운 출고 기록</h3><p id="ledger-entry-month"></p></div><button type="button" id="ledger-entry-close" aria-label="입력 패널 닫기">×</button></header><form id="ledger-entry-form"><div id="ledger-entry-fields"></div><footer><p id="ledger-entry-status" role="status"></p><div><button type="button" id="ledger-entry-cancel">취소</button><button type="submit" id="ledger-entry-save">장부에 등록</button></div></footer></form></section>`;
  document.body.append(drawer);
  let editingId = null, original = {}, baseline = {}, draftMonth = '', owner = '', busy = false, returnFocus = null;
  const schema = Object.fromEntries(CHULGO_COLS.map(c => [c.key, c]));
  const groups = [['고객과 차량', ['dbType','name','car','vehiclePrice']],['금융 · 계약 조건',['finType','company','contractPeriod','mileage','initialFunds','status','deployDate']],['정산 기준',['fee','recognizedUnits','nonPartner','retention','memo']]];
  Object.assign(schema, {
    deployDate: {label:'출고일 / 예정일',type:'text'}, recognizedUnits:{label:'인정 대수',type:'units'},
    nonPartner:{label:'비제휴',type:'checkbox'},retention:{label:'리텐션',type:'checkbox'},memo:{label:'메모',type:'text'}
  });
  function field(key, value) {
    const c = schema[key]; const attrs = `data-field="${key}" id="ledger-field-${key}"`;
    let input;
    if (c.type === 'select') {
      const opts = [...new Set(['', ...c.options, ...(value ? [String(value)] : [])])];
      input = `<select ${attrs}>${opts.map(v => `<option value="${esc(v)}" ${String(value ?? '') === v ? 'selected' : ''}>${esc(v || '선택')}</option>`).join('')}</select>`;
    } else if (c.type === 'checkbox') input = `<input ${attrs} type="checkbox" ${value ? 'checked' : ''}>`;
    else if (c.type === 'units') input = `<input ${attrs} type="number" min="0" max="9" step="1" value="${Number(value) || 0}">`;
    else input = `<input ${attrs} type="text" ${c.type==='money'?'inputmode="numeric"':''} value="${esc(String(c.type === 'money' ? (Number(value) || 0).toLocaleString('ko-KR') : value ?? ''))}">`;
    return `<label class="ledger-field ${['dbType','initialFunds','memo','company'].includes(key)?'wide':''} ${c.type==='checkbox'?'check':''}" for="ledger-field-${key}"><span>${esc(c.label)}${c.type==='money'?' (원)':''}</span>${input}</label>`;
  }
  function read() {
    const values = {};
    drawer.querySelectorAll('[data-field]').forEach(el => { const key=el.dataset.field,c=schema[key]; values[key]=c.type==='checkbox'?el.checked:c.type==='money'?chulgoParseMoneyRaw(el.value):c.type==='units'?Number(el.value):el.value; });
    return values;
  }
  function openDraft(seed = {}, id = null) {
    if (busy) return;
    owner = currentUser?.uid; if (!owner) { showToast('로그인 후 장부를 입력해주세요.'); return; }
    editingId = id; returnFocus = document.activeElement;
    draftMonth = seed.month || chulgoActiveMonth();
    original = id ? {...seed} : {finType:'렌트',status:'-',countsQuota:true,recognizedUnits:1,...seed};
    const values = {...original,recognizedUnits:id?chulgoRecognizedUnits(original):original.recognizedUnits};
    $('ledger-entry-fields').innerHTML = groups.map(([title,keys],index)=>`<section><h4><span>0${index+1}</span>${title}</h4><div class="ledger-field-grid">${keys.map(key=>field(key,values[key])).join('')}</div></section>`).join('') + '<p class="ledger-entry-help">추가 수수료·프로모션·대리점수당·용품비·페이백은 저장 후 행의 💰 정산 상세에서 항목별로 관리할 수 있어요.</p>';
    baseline = read();
    $('ledger-entry-title').textContent = id ? '출고 기록 수정' : '새로운 출고 기록';
    $('ledger-entry-month').textContent = chulgoMonthLabel(draftMonth);
    $('ledger-entry-save').textContent = id ? '변경사항 저장' : '장부에 등록';
    $('ledger-entry-status').textContent = '';
    drawer.classList.remove('hidden'); $('ledger-entry-fields').scrollTop=0;
    $('ledger-field-dbType').focus();
  }
  function close() {
    if (busy) return;
    drawer.classList.add('hidden'); if(returnFocus?.isConnected) returnFocus.focus();
    chulgoRenderWhenIdle();
  }
  $('ledger-entry-close').onclick = close; $('ledger-entry-cancel').onclick = close;
  drawer.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab') {const nodes=[...drawer.querySelectorAll('input,select,button')].filter(el=>!el.disabled);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
  drawer.addEventListener('focusout', e => { if(schema[e.target.dataset.field]?.type==='money')e.target.value=chulgoParseMoneyRaw(e.target.value).toLocaleString('ko-KR'); });
  $('ledger-entry-form').onsubmit = async e => {
    e.preventDefault(); if(busy)return;
    if(owner!==currentUser?.uid){$('ledger-entry-status').textContent='로그인 계정이 바뀌었습니다. 창을 닫고 다시 열어주세요.';return;}
    const values=read(),patch={};
    for(const [key,value] of Object.entries(values)) if(!editingId||value!==baseline[key]) patch[key]=value;
    if(!editingId&&!values.name.trim()&&!values.car.trim()){$('ledger-entry-status').textContent='고객명 또는 차종을 입력해주세요.';return;}
    if('recognizedUnits' in patch)patch.countsQuota=true;
    busy=true;drawer.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);$('ledger-entry-status').textContent='저장 중…';
    let succeeded=false;
    try {
      if(editingId) {
        const row=chulgoEntries.find(x=>x.id===editingId);if(!row)throw new Error('삭제되었거나 더 이상 접근할 수 없는 출고 건입니다.');
        await chulgoUpdateFields(editingId,patch,{throwOnError:true});Object.assign(row,patch);
      } else {
        await window.api.createChulgoEntry({...original,...patch,month:draftMonth,order:chulgoEntries.filter(x=>x.month===draftMonth).length});
      }
      succeeded=true;
    } catch(err){$('ledger-entry-status').textContent=chulgoFriendlyError(err);}
    finally{busy=false;drawer.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);}
    if(succeeded){close();renderChulgo();showToast('장부에 저장했어요.');}
  };
  chulgoTableWrap.addEventListener('click', e=>{
    const button=e.target.closest('.chulgo-edit-btn');if(!button)return;
    const row=chulgoEntries.find(x=>x.id===button.dataset.id);if(row)openDraft(row,row.id);
  });
  window.ledgerUI={refresh,openDraft};
  refresh();
})();
