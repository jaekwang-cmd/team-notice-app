# Team Notice App

부팅 시 자동 실행되는 개인 캘린더 + 팀 실시간 공지 데스크톱 앱 (Electron).

- 캘린더: 대한민국 공휴일 자동 표시 + 각자 구글 계정으로 로그인한 **개인** 구글 캘린더 일정 오버레이/추가/수정/삭제 (팀원 간 공유되지 않음, 각자 본인 캘린더에만 반영)
- 공지: Firebase Firestore 기반 실시간 동기화. 누군가 공지를 올리면 앱을 켜둔 모든 팀원 화면에 즉시 표시되고 Windows 알림도 뜸. 본인 글 또는 관리자는 수정/삭제 가능, 관리자에게만 "확인함" 체크박스 표시
- 구글 로그인 한 번으로 캘린더 접근 + Firestore 인증(공지 작성 권한)이 동시에 부여됨
- 개인화 테마: 배경/날짜 칸 배경/글씨 색/강조색/글씨체를 각자 원하는 대로 설정 가능 (로컬 저장, 팀원끼리 공유 안 됨)
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
    match /announcements/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

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
