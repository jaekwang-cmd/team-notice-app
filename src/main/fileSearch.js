// 내 PC 파일 찾기 — "김범석 서류 찾아줘" 처럼 이름 일부만 알아도 찾아준다.
//
// Everything 같은 별도 프로그램 없이 Windows 기본 기능만 쓴다(직원들이 아무것도 설치
// 안 해도 되게). 실측으로 C 드라이브 전체(시스템 폴더 제외) 5만여 개를 훑는 데 약 1초라
// 충분히 빠르고, 한 번 훑은 목록을 잠깐 기억해두면 그 다음 검색은 즉시 끝난다.

const fs = require('fs');
const path = require('path');
const os = require('os');

// 사용자가 만든 서류가 있을 리 없고 파일 수만 폭증시키는 곳들 — 훑기에서 뺀다.
const SKIP_DIRS = new Set([
  'AppData', 'Windows', 'ProgramData', 'Program Files', 'Program Files (x86)',
  'System Volume Information', '$Recycle.Bin', 'Recovery', 'Config.Msi',
  'node_modules', 'OneDriveTemp', 'adobeTemp', 'Temp', 'ESD', 'PerfLogs',
  'Application Data', 'Local Settings', 'inetpub', '.git', '.cache', '.vscode',
  // 개발 프로젝트 폴더가 있는 PC에서 흔한 의존성/빌드 산출물 폴더 — 사용자 서류가
  // 있을 리 없고 항목 수만 크게 부풀린다.
  'venv', '.venv', 'dist', 'build', 'target', '__pycache__', '.next', '.turbo',
  'vendor', '.gradle', 'Pods', '.pytest_cache', '.mypy_cache', '.idea',
]);

// 열었다가 사고가 날 수 있는 확장자 — 검색 결과에도 안 내보내고, 열지도 않는다.
// (AI 가 실수로 실행파일을 열어버리는 일이 없어야 한다)
const BLOCKED_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.msp', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.jar', '.reg', '.lnk',
  '.dll', '.sys', '.cpl', '.hta', '.pif',
]);

const MAX_DEPTH = 12;
const SCAN_BUDGET_MS = 20000;         // 혹시 디스크가 느려도 여기서 끊는다

// 이 앱은 트레이에 남아 하루 종일 돌아간다. 색인은 10만 항목 규모라 메모리를 꽤
// 차지하는데, 파일 찾기는 가끔 쓰는 기능이라 계속 들고 있을 이유가 없다 —
// 한동안 검색이 없으면 통째로 놓아주고, 다음에 필요할 때 다시 만든다.
const INDEX_IDLE_RELEASE_MS = 10 * 60 * 1000;

// 항목마다 fullPath 를 통째로 들고 있으면 dir+name 을 그대로 한 번 더 복사해
// 보관하는 셈이라(10만 항목 기준 수십 MB), 경로는 검색에 걸린 소수 항목에 대해서만
// 그때그때 만들어 쓴다. dir 문자열은 같은 폴더 항목끼리 참조를 공유하므로 저렴하다.
let indexCache = null;      // [{ name, lowerName, dir, isDir }]
let indexBuiltAt = 0;
let buildingPromise = null;
let idleReleaseTimer = null;

function entryFullPath(entry) {
  return path.join(entry.dir, entry.name);
}

function scheduleIdleRelease() {
  clearTimeout(idleReleaseTimer);
  idleReleaseTimer = setTimeout(() => {
    if (!indexCache) return;
    const count = indexCache.length;
    indexCache = null;
    indexBuiltAt = 0;
    console.log(`[file-search] ${INDEX_IDLE_RELEASE_MS / 60000}분간 검색이 없어 색인 ${count}개를 해제했습니다`);
  }, INDEX_IDLE_RELEASE_MS);
  // 이 타이머 때문에 프로세스가 살아있을 이유는 없다
  if (typeof idleReleaseTimer.unref === 'function') idleReleaseTimer.unref();
}

function scanRoots() {
  // 이 PC 의 실제 드라이브들 (보통 C 하나). 사용자가 바탕화면 밖에 꺼내둔 폴더도
  // 잡히도록 드라이브 루트부터 훑되, 위 SKIP_DIRS 로 시스템 영역은 건너뛴다.
  const roots = [];
  for (let i = 67; i <= 90; i += 1) {           // C: ~ Z:
    const drive = `${String.fromCharCode(i)}:\\`;
    try {
      if (fs.existsSync(drive)) roots.push(drive);
    } catch { /* 접근 불가 드라이브는 무시 */ }
  }
  return roots.length ? roots : [os.homedir()];
}

const YIELD_EVERY_DIRS = 150;     // 이만큼 폴더를 읽을 때마다 이벤트 루프에 양보한다
const YIELD_EVERY_ENTRIES = 2000; // 폴더 하나 안 항목이 이만큼 쌓일 때마다도 양보한다

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

// fs.readdirSync는 폴더 사이 양보(YIELD_EVERY_DIRS)로는 못 막는다 — 폴더 하나
// 안의 항목 수가 아주 많으면(브라우저 캐시, 다운로드 폴더 등) 그 호출 자체가
// 통째로 막힌다. opendir 스트리밍으로 항목을 하나씩 읽으며 그 안에서도 주기적으로
// 양보한다. maxEntries를 주면 그만큼만 읽고 멈춘다(색인 전체 훑기가 아니라 검색 중
// 폴더 하나 펼쳐 보여주기처럼 "적당히만 있으면 되는" 경우, 큰 폴더에서도 오래
// 안 걸리게 한다).
async function readDirEntries(dir, maxEntries = Infinity) {
  const entries = [];
  let dh;
  try {
    dh = await fs.promises.opendir(dir);
  } catch {
    return entries; // 권한 없는 폴더 등은 조용히 건너뛴다
  }
  let i = 0;
  try {
    for await (const it of dh) {
      entries.push(it);
      if (entries.length >= maxEntries) break;
      i += 1;
      if (i % YIELD_EVERY_ENTRIES === 0) await yieldToLoop();
    }
  } catch {
    // 읽던 중 에러 나도 지금까지 모은 것만 쓰고 넘어간다
  }
  return entries;
}

// 재귀 대신 명시적 스택 + 중간 양보 방식으로 훑는다.
// 한 번에 쭉 훑으면 10만 개 기준 3초가 넘는데, 그동안 메인 프로세스가 통째로 멈춰서
// 클릭·입력이 다 씹힌다(예전에 겪던 그 증상과 같은 원인). 중간중간 양보해서
// 색인이 도는 동안에도 앱은 평소처럼 반응하게 만든다.
async function buildIndexInner() {
  const started = Date.now();
  const deadline = started + SCAN_BUDGET_MS;
  const out = [];
  const stack = scanRoots().map((root) => ({ dir: root, depth: 0 }));
  let dirsSinceYield = 0;

  while (stack.length) {
    if (Date.now() > deadline) {
      console.warn('[file-search] 시간 초과로 색인을 중간에 마칩니다');
      break;
    }
    const { dir, depth } = stack.pop();
    if (depth > MAX_DEPTH) continue;

    // 폴더 사이 양보(YIELD_EVERY_DIRS)만으론 못 막는 경우가 있다 — 브라우저 캐시나
    // 다운로드 폴더처럼 폴더 하나 안에 항목이 아주 많으면, readdirSync 자체는 한
    // 번의 호출이라 어쩔 수 없지만 그 결과를 처리하는 이 for문은 오래 걸릴 수 있어서
    // 처리 중간에도 양보를 넣는다(대량 비동기 스트리밍은 오히려 전체 속도를 크게
    // 떨어뜨려서, 흔한 "작은 폴더 수만 개" 경우엔 그냥 readdirSync가 훨씬 빠르다).
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 권한 없는 폴더는 조용히 건너뛴다
    }

    let itemsSinceYield = 0;
    for (const it of items) {
      const name = it.name;
      if (it.isSymbolicLink()) continue;        // 순환 참조 방지
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('$')) continue;
        out.push({ name, lowerName: name.toLowerCase(), dir, isDir: true });
        let full;
        try {
          full = path.join(dir, name);
        } catch {
          continue;                             // 경로로 못 만들 이름이면 하위는 못 훑는다
        }
        stack.push({ dir: full, depth: depth + 1 });
      } else {
        if (BLOCKED_EXTS.has(path.extname(name).toLowerCase())) continue;
        out.push({ name, lowerName: name.toLowerCase(), dir, isDir: false });
      }
      itemsSinceYield += 1;
      if (itemsSinceYield >= YIELD_EVERY_ENTRIES) {
        itemsSinceYield = 0;
        await yieldToLoop();
      }
    }

    dirsSinceYield += 1;
    if (dirsSinceYield >= YIELD_EVERY_DIRS) {
      dirsSinceYield = 0;
      await yieldToLoop();
    }
  }

  indexCache = out;
  indexBuiltAt = Date.now();
  console.log(`[file-search] 색인 완료: ${out.length}개 (${Date.now() - started}ms)`);
  scheduleIdleRelease();
  return out;
}

function buildIndex() {
  if (buildingPromise) return buildingPromise;
  buildingPromise = buildIndexInner().finally(() => { buildingPromise = null; });
  return buildingPromise;
}

// 예전엔 3분짜리 별도 TTL이 있었는데, 유휴 해제(10분, INDEX_IDLE_RELEASE_MS)보다
// 훨씬 짧아서 검색 간격이 4분만 넘어도 아직 멀쩡히 살아있는 색인을 버리고 디스크
// 전체를 다시 훑었다 — 로컬 파일은 3분 만에 바뀔 일이 거의 없으니, 색인이 실제로
// 해제된 경우에만(=indexCache가 없을 때만) 다시 만든다.
async function ensureIndex() {
  if (indexCache) return indexCache;
  return buildIndex();
}

// "김범석 서류" 처럼 여러 낱말을 주면 전부 포함하는 것만 찾는다.
function matchesAll(lowerName, terms) {
  return terms.every((t) => lowerName.includes(t));
}

async function searchFiles(keyword, limit = 30) {
  const raw = String(keyword || '').trim();
  if (!raw) return { results: [], total: 0 };

  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const index = await ensureIndex();
  scheduleIdleRelease();   // 계속 쓰는 동안엔 색인을 놓지 않는다

  const dirHits = [];
  const fileHits = [];
  for (const entry of index) {
    if (!matchesAll(entry.lowerName, terms)) continue;
    (entry.isDir ? dirHits : fileHits).push(entry);
  }

  // 폴더가 이름과 맞으면 그 안의 파일들도 같이 보여준다 — "김범석 폴더" 를 찾으면
  // 보통 그 안의 서류를 열고 싶어 하기 때문.
  // 결과는 최종적으로 limit개만 쓰이니, 폴더 하나가 아무리 커도 넉넉한 배수만
  // 읽고 멈춘다 — 그래야 매 검색마다(색인 재구성이 아니라) 큰 폴더 하나 때문에
  // 요청이 오래 걸리는 일이 없다.
  const PER_DIR_ENTRY_CAP = limit * 3;
  const fromDirs = [];
  for (const d of dirHits.slice(0, 5)) {
    const dirPath = entryFullPath(d);
    for (const it of await readDirEntries(dirPath, PER_DIR_ENTRY_CAP)) {
      if (!it.isFile()) continue;
      if (BLOCKED_EXTS.has(path.extname(it.name).toLowerCase())) continue;
      fromDirs.push({ name: it.name, dir: dirPath, isDir: false });
    }
  }

  // 경로 문자열은 여기(검색에 걸린 소수 항목)에서만 만든다 — 색인 전체가 들고 있을
  // 이유가 없어서 메모리를 크게 아낀다.
  const seen = new Set();
  const ordered = [];
  for (const e of [...dirHits, ...fromDirs, ...fileHits]) {
    const fullPath = entryFullPath(e);
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    ordered.push({ name: e.name, path: fullPath, dir: e.dir, isDir: !!e.isDir });
  }

  return { results: ordered.slice(0, limit), total: ordered.length };
}

function isOpenable(target) {
  const ext = path.extname(target).toLowerCase();
  return !BLOCKED_EXTS.has(ext);
}

module.exports = { searchFiles, buildIndex, isOpenable, BLOCKED_EXTS };
