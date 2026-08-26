# 디자인 시스템

새 화면/컴포넌트를 만들 때 이 문서를 기준으로 삼는다. 토큰은 `src/renderer/styles.css`의 `:root`에
정의돼 있다.

## 1. 토큰

| 종류 | 변수 | 값 |
|---|---|---|
| 여백 | `--space-1` ~ `--space-8` | 4 / 8 / 12 / 16 / 20 / 24 / 32px |
| 라운드 | `--radius-sm/md/lg/xl` | 8 / 12 / 16 / 20px |
| 그림자 | `--shadow-card`, `--shadow-pop` | 카드용 / 팝업용 |
| 전환 | `--transition-fast`, `--transition-base` | (구) `--motion-*`+`--ease-standard`의 별칭 — 새 코드는 아래 Motion System을 직접 쓴다 |
| z-index | `--z-day-panel-floating`(20), `--z-mini-overlay`(50), `--z-overlay`(200), `--z-toast`(9999) | 기존 실제 값을 그대로 이름만 부여(회귀 방지) |
| 컨트롤 높이 | `--control-height-sm/md/lg`(28/34/40px), `--control-height-touch`(44px) | 모바일 breakpoint에서는 touch 값을 쓴다 |

## 2. Typography 스케일 (역할 기준)

| 역할 | 클래스 | 크기 | 용도 |
|---|---|---|---|
| Page title | `.text-page-title` | 19px / 800 | 화면 최상단 제목(장부/비교시트 헤더) |
| Section title | `.text-section-title` | 15px / 700 | 설정 등 섹션 헤더 |
| Card title | `.text-card-title` | 14px / 700 | 카드/모듈 헤더 |
| Body | `.text-body` | 13px / 400 | 본문 |
| Secondary | `.text-secondary` | 12px | 보조 설명 |
| Caption | `.text-caption` | **11px (최소값)** | 가장 작은 설명. 특별한 공간 제약(캘린더 셀 등) 없이는 이보다 작게 쓰지 않는다 |
| Numeric | `.text-numeric` | 상속 크기 + `tabular-nums` | 표/합계 등 자릿수가 맞아야 하는 숫자 |

캘린더 날짜/일정 글씨처럼 사용자가 설정에서 직접 크기를 고르는 예외(`--calendar-date-font-size`,
`--calendar-event-font-size`, 8~16px)는 공간이 원천적으로 좁은 셀 UI라 이 스케일 밖에 둔다.

## 3. 버튼 위계

```html
<button class="btn btn-primary">핵심 액션 (화면당 보통 1개)</button>
<button class="btn btn-secondary">자주 쓰는 보조 액션</button>
<button class="btn btn-tertiary">덜 중요한 보조 액션</button>
<button class="btn btn-ghost">가장 약한 강조 (아이콘/텍스트형)</button>
<button class="btn btn-danger">파괴적 액션</button>
```

크기는 `.btn-sm`(28px) / 기본(34px) / `.btn-lg`(40px). 항상 `.btn`과 역할 클래스를 **함께** 붙인다
— 특이도를 (0,2,0)으로 올려서 화면별 레거시 버튼 클래스(`.chulgo-mini-btn` 등, (0,1,0))보다
항상 이기게 만든 구조다. 기존 화면 클래스는 지우지 않고 그 위에 얹는 방식이라 기능은 그대로다.

라벨은 짧게 쓰고, 부연 설명은 `title` 속성(툴팁)이나 근처 caption 텍스트로 분리한다.
예: `정산서 엑셀` + `title="리텐션·추가수수료·프로모션까지 반영한 내 급여 확인용 정산서"`.

## 4. 모달 크기 체계

```html
<div class="chulgo-mini-card modal-md">...</div>
```

| 클래스 | 폭 | 참고 |
|---|---|---|
| `.modal-xs` | 320px | 확인/선택형 미니 팝업 (이월하기 등) |
| `.modal-sm` | 420px | 짧은 안내 팝업 (업데이트 공지 등) |
| `.modal-md` | 480px (기본) | 일반 입력 팝업 |
| `.modal-lg` | 720px | 여러 섹션이 있는 편집 팝업 |
| `.modal-xl` | min(1500px, 96vw) | 넓은 표 미리보기 |
| `.modal-full` | 96vw (최대 1760px) | 정산서 미리보기처럼 표가 아주 넓은 경우 |

모든 사이즈가 `max-width`를 함께 가지므로 좁은(모바일) 화면에서는 자동으로 뷰포트 폭에 맞게
줄어든다 — 별도의 모바일 전용 override가 필요 없다.

## 5. Motion System

한 곳(`src/renderer/styles.css`의 `:root`)에 정의된 시간/이징 토큰을 전체 화면이 공유한다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--motion-instant` | 60ms | hover 진입/이탈처럼 손 반응과 동시에 느껴져야 하는 것 |
| `--motion-fast` | 100ms | press, 아이콘 버튼 반응 |
| `--motion-normal` | 150ms | 일반 UI 전환(토글, 배지, 버튼 hover) |
| `--motion-emphasized` | 200ms | 눈에 띄어야 하는 강조 전환 |
| `--motion-modal` | 160ms | 모달/팝업 등장 |
| `--motion-drawer` | 220ms | 사이드시트류(현재 미사용, 향후 모바일 drawer용으로 예약) |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | 대부분의 UI 전환 |
| `--ease-emphasized` | `cubic-bezier(0.3,0,0.1,1)` | 모달처럼 끝에서 살짝 감속하는 전환 |

원칙:
- hover/press 같은 **직접 입력 반응은 `--motion-instant`/`--motion-fast`** 만 쓴다. 모달/드로어처럼
  "화면에 새로 나타나는" 것만 `--motion-modal`/`--motion-drawer`로 조금 더 여유를 준다.
- `transform`/`opacity`/`border-color`/`box-shadow` 등 **레이아웃에 영향 없는 속성** 위주로만 애니메이션한다
  (`width`/`height`/`top`/`left` 등 reflow를 일으키는 속성은 피한다).
- `display:none`↔`flex` 전환(모달 열기)은 `transition`으로 만들 수 없어서, "지금 막 보인 상태"에
  한해 `@keyframes` + `animation`을 건다(모든 브라우저에서 안전하고, display가 바뀔 때마다 자동으로
  다시 재생된다) — `.chulgo-mini-overlay:not(.hidden)`/`.settings-overlay:not(.hidden)` 참고.
  닫힘은 의도적으로 즉시 처리한다(여러 번 열고 닫아도 굼떠 보이지 않게).
- `prefers-reduced-motion: reduce` 사용자는 `:root` 바로 아래 전역 규칙 하나로 모든 애니메이션
  지속시간이 사실상 0으로 줄어든다 — 기능은 애니메이션에 의존하지 않으므로 안전하다.
- Bounce, 과한 scale/glow, 마우스를 따라다니는 효과, 계속 움직이는 배경은 쓰지 않는다.

## 6. 버튼 상태

Default/Hover/Active/Focus/Disabled는 `.btn` 베이스 규칙 하나로 모든 역할(Primary/Secondary/
Tertiary/Ghost/Danger)에 공통 적용된다 — `:active`에서 1px 눌림, `:disabled`에서 흐림(스피너 없이
0.45 opacity), `:focus-visible`은 전역 accent 아웃라인을 그대로 물려받는다. Selected가 필요한
곳(사이드바, 프리셋 카드, 표의 선택된 행)은 역할별로 별도 규칙을 둔다(예: 사이드바는 accent
서피스 + 왼쪽 인디케이터 바, 프리셋 카드는 `:has(input:checked)`로 라디오 상태를 그대로 반영).
Loading은 별도 스피너 컴포넌트를 새로 만들지 않고, 진행 중엔 버튼을 `disabled` 처리해 흐리게
하는 것으로 충분하다(대부분의 클릭이 0.1초 내로 끝나서 스피너를 얹으면 오히려 번잡해진다).

## 7. 색상 / 화면 톤 / Semantic Color

- **캘린더**: 사용자가 설정에서 고르는 테마(아래 8번 참고)를 그대로 쓴다. 개인화가 핵심 기능이라
  계속 사용자 지정을 우선한다.
- **장부(`#chulgo-panel`) / 비교시트(`#compare-panel`)**: 데이터 밀도가 높아 가독성을 위해 밝은
  surface(흰 카드, 옅은 회색 배경)를 고정하지만, **강조색(`--color-accent`)만은 사용자가 설정에서
  고른 색을 40% 섞어** 이어받는다(`color-mix(in srgb, var(--color-accent) 40%, #2e6ff2 60%)`).
  캘린더와 완전히 같은 색은 아니어도 "내가 고른 색"의 흔적이 남도록 하는 절충이다.
- 세 화면 모두 카드 radius(20~24px), hover 시 `translateY(-1px)` 패턴을 공유한다 — 톤(밝기)은
  달라도 "같은 제품"이라는 인상은 유지. **클릭 가능한 카드만** hover 반응을 준다 — 정보 표시용
  카드(히어로 통계 등)는 hover에 반응하지 않는다(클릭 요소가 아닌데 반응하면 오히려 혼란).
- **Semantic color**는 의미로만 쓴다: 초록(`--color-success`류) = 성공/완료, 주황/앰버 = 경고,
  빨강(`#d03b3b`류) = 오류/위험, 파랑 = 정보, **테마 accent = 선택/주 액션 전용**. 같은 의미가
  화면마다 다른 색으로 나오지 않게 하고, accent는 Primary 액션/선택/포커스/오늘 날짜처럼
  진짜 강조가 필요한 곳에만 쓴다(모든 요소에 바르지 않는다).

## 8. Theme System

`src/renderer/theme.js`가 색 토큰 전체(`COLOR_FIELDS`, 21개 필드)를 관리한다. 저장 형식/필드
이름은 항상 그대로 유지한다(사용자가 이미 저장해둔 테마와의 호환성 때문).

- **모드**: 다크 / 라이트 / 프리셋 5종 / 사용자 설정, 총 8가지가 `theme.mode` 값(=라디오
  `value`=`THEME_PRESETS`의 key)으로 저장된다. 설정 화면의 `#theme-preset-grid`가
  `THEME_PRESET_META`를 읽어 스와치 카드를 자동으로 그린다 — 프리셋을 추가/삭제해도
  `index.html`은 손댈 필요가 없다.
- **팔레트 생성**: 프리셋마다 21개 필드를 전부 손으로 채우는 대신, `buildPreset(seed)`가
  `{bg, surface, text, textSecondary, accent, sunday, saturday}` 7개 씨앗값에서 나머지(border,
  divider, hover, selected, today, eventBg 등)를 `shadeHex`(밝기 이동)/`mixHex`(accent를 배경
  쪽으로 선형 보간)로 파생시킨다. 이렇게 하면 프리셋마다 계층 규칙이 항상 일관되고, 씨앗값
  7개만 잘 고르면 나머지는 자동으로 조화를 이룬다.
- **다크 계열**(다크/소프트 다크/미드나잇): 순수 검정(`#000`)을 배경으로 쓰지 않는다. 배경은
  `#12~#22` 범위의 차콜/네이비 계열, 서피스는 배경보다 밝은 단계 하나, 보더는 서피스보다 한 단계
  더 밝은 중립색(불투명 흰색 대신) — 예전엔 보더 필드가 `#ffffff`(완전 불투명 흰색)였는데, 이
  색이 `<input type=color>`(알파 채널 없음) 기반이라 CSS에서 늘 raw로 쓰였던 걸 감안해 이제는
  서피스 기준으로 파생된 중립 회색을 쓴다.
  텍스트도 순백 대신 `#e2~#ec` 범위의 오프화이트를 쓴다.
- **라이트 계열**(라이트/포레스트/오션/라벤더): 배경과 서피스를 분명히 다른 단계로 둔다(배경은
  옅은 뉴트럴 그레이, 서피스는 거의 흰색이지만 완전한 `#fff` 반복이 아니라 계층이 느껴지게).
  텍스트는 순수 검정 대신 다크 차콜(`#20~#2b` 범위)을 쓴다.
- **사용자 설정**: 기존처럼 21개 필드를 각각 직접 고를 수 있는 기능은 그대로 유지한다. 다만
  극단적인 색(너무 밝거나 너무 어두운 accent 등)을 선택했을 때의 자동 대비 보정은 이번 범위에
  포함하지 않았다(아래 "일부러 하지 않은 것" 참고) — 각 필드가 독립적인 컬러피커라 "무엇을
  사용자가 직접 건드렸는지" 구분할 안전한 방법이 없어서, 잘못 건드리면 기존 저장값을 덮어쓸
  위험이 있었다.

## 9. Font System

기본은 Pretendard Variable(CDN, `<head>`의 preload+fallback 패턴 — 인터넷이 없으면 시스템 기본
서체로 조용히 대체). 설정 > 글씨체에서 고를 수 있는 선택지를 넓혔다:

| 글꼴 | 라이선스 | 성격 |
|---|---|---|
| Pretendard (기본) | OFL | 현대적인 업무 UI |
| Noto Sans KR | SIL OFL 1.1 | 범용성·안정성, 어디서나 무난 |
| IBM Plex Sans KR | SIL OFL 1.1 | 조금 더 기술적·전문적인 인상 |
| 맑은 고딕/굴림/돋움/바탕/Consolas | Windows 시스템 폰트 | 기존 그대로 유지 |

Noto Sans KR/IBM Plex Sans KR은 Pretendard와 같은 방식(Google Fonts, `preload`+`onload` 전환+
`noscript` 폴백)으로 불러오고, 실제 쓰는 굵기 4단계(400/500/600/700)만 요청해 용량을 줄였다.
둘 다 재배포 허용 오픈소스 라이선스라 안전하다.

설정 화면에 실제 폰트로 렌더링되는 미리보기 문장(`가나다라마바사 ABC 123,456원` — 한글/영문/
숫자/금액이 섞인 샘플)을 뒀다. `--font-family`가 전역 CSS 변수라 select를 바꾸는 즉시 이
미리보기와 앱 전체에 함께 반영된다(별도 JS 동기화 코드가 필요 없다).

**의도적으로 하지 않은 것**: 폰트 파일을 앱에 직접 번들링(로컬 자산화)하지 않았다 — 실제 폰트
바이너리를 내려받아 라이선스 파일까지 함께 검증하는 작업은 이번 세션의 도구로 안전하게 하기
어려워서, 기존에 이미 검증된 방식(Pretendard의 CDN+오프라인 폴백)을 그대로 확장했다. 완전한
오프라인 번들링은 별도 작업으로 남겨둔다.

## 10. 반응형 breakpoint

- **Desktop**: 1024px 초과 (기본 스타일)
- **Tablet**: 768px ~ 1024px — 사이드바 아이콘만 남기고 라벨 숨김, 비교시트 2칸을 세로로 쌓음
- **Mobile**: 768px 미만 (향후 Android/Play스토어 빌드 기준) — 사이드바가 하단 탭바로 전환,
  일정 패널이 캘린더 아래로 이동, 버튼 최소 높이 `--control-height-touch`(44px) 적용

표(장부/비교시트)는 모바일에서 셀 단위 "카드형"으로 바꾸지 않고 **가로 스크롤을 유지**했다.
카드형 전환은 각 `<td>`에 `data-label` 같은 라벨 정보를 새로 붙여야 해서 마크업 변경 범위가
커지고, 실제 터치 기기에서 눈으로 확인하지 못한 채 구조를 바꾸는 건 회귀 위험이 크다고 판단했다
— 다음 단계(실제 모바일 빌드 착수 시)에 기기에서 직접 검증하며 진행하는 걸 권장한다.

## 11. 화면별 창 크기 기억 (Electron 전용 기능)

캘린더/메모/AI/장부/비교시트 화면은 각자 마지막으로 조절한 창 크기를 기억한다
(`renderer.js`의 `VIEW_WINDOW_SIZE`, `saveCurrentWindowSize`/`restoreWindowSize`). 이 기능은
의도된 것이라 유지하되, 같은 크기로 다시 맞출 땐 `setWindowSize` IPC를 재호출하지 않도록
`lastKnownWindowSize` 캐시를 둬서 불필요한 네이티브 리사이즈(화면 튐)를 없앴다. 향후 모바일
빌드에서는 창 크기 개념 자체가 없으므로 이 기능은 플랫폼 분기(`window.api` 유무 등)로 자연스럽게
무력화된다 — 별도 처리 불필요.

## 12. 새 화면을 만들 때 체크리스트

1. 색상/여백/라운드/그림자는 토큰만 쓴다 (하드코딩 금지)
2. 텍스트는 typography 클래스 중 하나를 쓴다 (11px 미만 금지, 캘린더 예외 제외)
3. 버튼은 `.btn` + 역할 클래스 조합을 쓴다 (하나만 Primary)
4. 팝업은 `.modal-*` 중 하나를 쓴다
5. 반응형이 필요하면 이 문서의 breakpoint(1024 / 768)를 그대로 쓴다
6. 액션 버튼과 설정/메타데이터 입력은 같은 줄에 섞지 않는다
7. hover/press는 `--motion-instant`/`--motion-fast`, 등장 애니메이션만 `--motion-modal` 이상 쓴다
8. Semantic color(success/warning/error/info)는 의미에 맞게만 쓰고, accent는 아껴 쓴다
9. 정보 표시용 카드에는 hover 반응을 넣지 않는다 — 클릭 가능한 요소에만 넣는다
