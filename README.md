# Team Notice App

부팅 시 자동 실행되는 개인 캘린더 + 팀 실시간 공지 데스크톱 앱 (Electron).

- 캘린더: 대한민국 공휴일 자동 표시 + 각자 구글 계정으로 로그인한 **개인** 구글 캘린더 일정 오버레이/추가/수정/삭제 (팀원 간 공유되지 않음, 각자 본인 캘린더에만 반영)
- 공지: Firebase Firestore 기반 실시간 동기화. 누군가 공지를 올리면 앱을 켜둔 모든 팀원 화면에 즉시 표시되고 Windows 알림도 뜸. 본인 글 또는 관리자는 수정/삭제 가능, 관리자에게만 "확인함" 체크박스 표시
- 구글 로그인 한 번으로 캘린더 접근 + Firestore 인증(공지 작성 권한)이 동시에 부여됨
- 개인화 테마: 배경/날짜 칸 배경/글씨 색/강조색/글씨체를 각자 원하는 대로 설정 가능 (로컬 저장, 팀원끼리 공유 안 됨)
- 📋 출고 관리 장부: 차량 출고 건을 월별로 입력/편집하는 개인 표. Firestore에 본인 계정으로만 저장되어 어느 컴퓨터에서 로그인하든 같은 데이터가 보임 (다른 팀원에게는 안 보임)
- 자동 업데이트: GitHub Releases 기반. 새 버전 배포 시 앱이 자동으로 감지해서 업데이트 여부를 물어봄

## 1. 준비물 (최초 1회, 설정 담당자가 진행)

### Firebase 프로젝트 만들기
1. https://console.firebase.google.com 에서 새 프로젝트 생성 (무료)
2. 왼쪽 메뉴 **Firestore Database** → 데이터베이스 만들기 (프로덕션 모드, 위치는 asia-northeast3 추천)
3. 왼쪽 메뉴 **Authentication** → Sign-in method → **Google** 로그인 사용 설정
4. **프로젝트 설정 → 일반 → 내 앱 → 웹 앱 추가** 로 `firebaseConfig` 값(apiKey, authDomain 등) 확인
5. **Firestore → 규칙** 탭에서 아래처럼 설정 (로그인한 사용자만 공지 읽기/쓰기 가능):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // --- 조직 관리(본부/지점/팀/직급/권한)에서 쓰는 헬퍼 — 요청자 본인의 orgMembers
    // 문서를 찾아 소속/팀/권한을 읽는다. 본인 문서가 없을 수도 있는 상황(신규 로그인
    // 직후 등)에서도 규칙 평가 자체가 에러로 죽지 않도록 exists()로 먼저 확인한다.
    function myOrgExists() {
      return exists(/databases/$(database)/documents/orgMembers/$(request.auth.uid));
    }
    function myOrgDoc() {
      return get(/databases/$(database)/documents/orgMembers/$(request.auth.uid)).data;
    }
    function myPermission() {
      return myOrgExists() ? myOrgDoc().permission : 'member';
    }

    // 개인 메모: 본인이 쓴 문서만 읽기/쓰기 가능 (다른 팀원에게 공유되지 않음)
    match /memos/{docId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.authorUid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.authorUid;
    }
    match /teamEvents/{docId} {
      allow read, write: if request.auth != null;
    }
    // settings/branchLinks(본부·지점별 시트 링크)도 여기 포함 — 앱이 IPC 단계에서
    // superAdmin만 쓰도록 막는다(관리자 목록/기타 설정도 기존부터 같은 방식).
    match /settings/{docId} {
      allow read, write: if request.auth != null;
    }
    // 출고 관리 장부: 본인은 항상 전체 권한. 그 외엔 "이 항목을 쓴 사람의 현재 조직
    // 배정"을 기준으로 같은 본부/지점의 orgManager, 같은 팀의 teamManager, 그리고
    // superAdmin에게 읽기만 허용한다(수정/삭제는 절대 불가) — 사람이 다른 본부로
    // 옮기면 그 즉시 예전 관리자는 못 보고 새 관리자가 과거 기록까지 보게 된다.
    match /chulgoEntries/{docId} {
      allow read: if request.auth != null && (
        request.auth.uid == resource.data.authorUid ||
        myPermission() == 'superAdmin' ||
        (myPermission() == 'orgManager' &&
          exists(/databases/$(database)/documents/orgMembers/$(resource.data.authorUid)) &&
          get(/databases/$(database)/documents/orgMembers/$(resource.data.authorUid)).data.organization == myOrgDoc().organization) ||
        (myPermission() == 'teamManager' && myOrgDoc().teamId != null &&
          exists(/databases/$(database)/documents/orgMembers/$(resource.data.authorUid)) &&
          get(/databases/$(database)/documents/orgMembers/$(resource.data.authorUid)).data.teamId == myOrgDoc().teamId)
      );
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.authorUid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.authorUid;
    }
    // 고객 리마인더: 본인이 쓴 문서만 읽기/쓰기 가능 (다른 팀원 데이터는 안 보임)
    match /customerReminders/{docId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.authorUid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.authorUid;
    }

    // 조직 구성원 — 최초 로그인 시 본인이 "존재 등록"만 가능(permission은 무조건
    // member로 강제, 스스로 승격 불가). 그 이후 조직/팀/직급/권한 변경은 superAdmin만.
    // 읽기는 본인 문서 + 같은 소속 사람끼리 + superAdmin 전체.
    match /orgMembers/{uid} {
      allow read: if request.auth != null && (
        request.auth.uid == uid ||
        myPermission() == 'superAdmin' ||
        myOrgDoc().organization == resource.data.organization
      );
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.uid == uid
        && request.resource.data.permission == 'member'
        && request.resource.data.organization == null
        && request.resource.data.teamId == null
        && request.resource.data.active == true;
      allow update: if request.auth != null && myPermission() == 'superAdmin';
      allow delete: if false;
    }
    // 팀 — 이름/담당자 등은 민감정보가 아니라 로그인한 사람 전체가 읽을 수 있게 두고,
    // 쓰기(생성/수정/삭제)만 superAdmin 전용으로 막는다.
    match /orgTeams/{teamId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && myPermission() == 'superAdmin';
    }
    // 인사이동/변경 로그 — superAdmin만 읽고 쓸 수 있다. 수정/삭제는 아예 막아서
    // 로그가 사후에 조작되지 않게 한다.
    match /orgHistory/{id} {
      allow read, create: if request.auth != null && myPermission() == 'superAdmin';
      allow update, delete: if false;
    }
    // 계정 메모(상호명/ID/PW) — 암호화 없이 평문 저장(재광님 확인, 나중에 Blaze 준비되면
    // 암호화 구조로 옮길 수 있음). 그래서 읽기 범위를 "같은 소속(organization)"으로만
    // 최대한 좁혀둔다 — 다른 본부/지점 사람은 아예 못 본다. 수정/삭제는 작성자 본인
    // 또는 superAdmin만.
    match /financeCredentials/{docId} {
      allow read: if request.auth != null && (
        myPermission() == 'superAdmin' ||
        (myOrgExists() && myOrgDoc().organization == resource.data.organization)
      );
      allow create: if request.auth != null && request.auth.uid == request.resource.data.authorUid;
      allow update, delete: if request.auth != null && (
        request.auth.uid == resource.data.authorUid || myPermission() == 'superAdmin'
      );
    }
  }
}
```

**최초 1회, superAdmin(최고관리자) 직접 지정 필요**: 위 규칙상 앱 안에서는 아무도 스스로
superAdmin이 될 수 없다(의도된 설계 — 권한 상승 공격 방지). 조직 관리 기능을 처음 쓰기
전에, 최고관리자가 될 계정으로 앱에 한 번 로그인한 뒤(그러면 `orgMembers` 컬렉션에
`permission: "member"`로 본인 문서가 자동 생성됨) **Firestore 콘솔 → orgMembers 컬렉션 →
본인 이메일로 된 문서를 찾아 `permission` 필드 값을 직접 `superAdmin`으로 수정**해야 한다.

### Google Calendar 연동용 OAuth 클라이언트 만들기
1. https://console.cloud.google.com 에서 프로젝트 생성 (Firebase와 같은 프로젝트 사용)
2. **API 및 서비스 → 라이브러리** 에서 "Google Calendar API" 활성화
3. **API 및 서비스 → OAuth 동의 화면(Google 인증 플랫폼)** 설정 → 대상(Audience)을 프로덕션으로 전환하면 팀원 이메일을 미리 등록할 필요 없음 (단, "확인되지 않은 앱" 경고가 뜨는데 "고급 → 이동"으로 통과 가능)
4. **사용자 인증 정보(클라이언트) → 만들기 → OAuth 클라이언트 ID → 애플리케이션 유형: 데스크톱 앱**
5. 생성된 **클라이언트 ID / 클라이언트 보안 비밀번호** 확인
6. Firebase 콘솔 → Authentication → Sign-in method → Google → **"외부 프로젝트의 클라이언트 ID 허용 목록"**에 위 클라이언트 ID를 추가로 등록 (Firebase 인증과 연결하기 위해 필요)

## 2. 설정 파일 채우기

```bash
cp config/config.example.json config/config.json
```

`config/config.json`을 열어 위에서 확인한 값들을 채우고, `adminEmails`에 관리자(공지 확인 체크박스를 볼 사람)의 구글 이메일을 넣습니다.
(이 파일은 `.gitignore`에 포함되어 있어 git에는 올라가지 않습니다)

## 3. 실행 (개발 모드)

```bash
npm install
npm start
```

## 4. 팀원 배포 (exe 패키징 + GitHub Release 배포)

`config/config.json`을 먼저 채운 뒤:

```bash
npm.cmd run publish
```

- `package.json`의 `build.publish` (owner/repo)로 설정된 GitHub 저장소에 새 릴리즈로 자동 업로드됨
- 실행 전 `$env:GH_TOKEN = '깃허브 토큰'` 으로 배포용 토큰을 설정해야 함 (repo 권한)
- 생성된 설치 파일(`dist/Team Notice Setup x.x.x.exe`)을 GitHub Release 페이지에서 다운로드 링크로 팀원에게 공유하거나, 파일 자체를 전달

각 팀원은:
1. 설치 파일 실행 → 설치 (관리자 권한 불필요)
2. 앱 실행 후 본인 구글 계정으로 **로그인** 클릭 → 캘린더 + 공지 작성 권한 모두 활성화
3. ⚙️ 설정에서 자동 실행/테마 등 개인 설정

## 5. 새 버전 업데이트 배포하기

코드를 수정한 뒤:

1. `package.json`의 `version`을 올림 (예: 0.1.0 → 0.1.1)
2. `$env:GH_TOKEN = '토큰'` 설정 후 `npm.cmd run publish` 실행
3. GitHub Releases에 새 버전이 올라가면, 팀원들의 앱이 실행될 때 자동으로 "새로운 버전이 있습니다. 업데이트 후 실행하시겠습니까?" 팝업을 띄우고, 승인 시 자동으로 다운로드·설치 후 재시작됨
4. 팀원들에게 새 exe를 다시 배포할 필요 없음 (최초 설치 이후로는 이 방식으로만 갱신)
