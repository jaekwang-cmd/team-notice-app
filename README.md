# Team Notice App

부팅 시 자동 실행되는 개인 캘린더 + 팀 실시간 공지 데스크톱 앱 (Electron).

- 캘린더: 대한민국 공휴일 자동 표시 + 각자 구글 계정으로 로그인한 **개인** 구글 캘린더 일정 오버레이 (팀원 간 공유되지 않음)
- 공지: Firebase Firestore 기반 실시간 동기화. 누군가 공지를 올리면 앱을 켜둔 모든 팀원 화면에 즉시 표시되고 Windows 알림도 뜸

## 1. 준비물 (최초 1회, 설정 담당자가 진행)

### Firebase 프로젝트 만들기
1. https://console.firebase.google.com 에서 새 프로젝트 생성 (무료)
2. 왼쪽 메뉴 **Firestore Database** → 데이터베이스 만들기 (프로덕션 모드)
3. 왼쪽 메뉴 **Authentication** → Sign-in method → **익명(Anonymous)** 로그인 사용 설정
4. **프로젝트 설정 → 일반 → 내 앱 → 웹 앱 추가** 로 `firebaseConfig` 값(apiKey, authDomain 등) 확인
5. **Firestore → 규칙** 탭에서 아래처럼 설정 (익명 로그인한 사용자만 공지 읽기/쓰기 가능):

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
1. https://console.cloud.google.com 에서 프로젝트 생성 (Firebase와 같은 프로젝트 사용 가능)
2. **API 및 서비스 → 라이브러리** 에서 "Google Calendar API" 활성화
3. **API 및 서비스 → OAuth 동의 화면** 설정 (테스트 사용자로 팀원 이메일 추가, 또는 내부용으로 게시)
4. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 애플리케이션 유형: 데스크톱 앱**
5. 생성된 **클라이언트 ID / 클라이언트 보안 비밀번호** 확인

## 2. 설정 파일 채우기

```bash
cp config/config.example.json config/config.json
```

`config/config.json`을 열어 위에서 확인한 값들을 채워 넣습니다.
(이 파일은 `.gitignore`에 포함되어 있어 git에는 올라가지 않습니다)

## 3. 실행

```bash
npm install
npm start
```

앱 우측 상단 ⚙️ 설정에서 **표시 이름**을 입력하면 공지에 작성자로 표시됩니다.
"Windows 시작 시 자동 실행"을 체크하면 다음 부팅부터 자동 실행됩니다. (단, 패키징된 exe 기준으로 정확히 동작 — 개발 모드에서는 참고용)

## 4. 팀원 배포 (exe 패키징)

`config/config.json`을 먼저 채운 뒤 아래 명령으로 설치 파일을 만듭니다 (config.json이 exe 안에 함께 포함됩니다):

```bash
npm run dist
```

`dist/Team Notice Setup 0.1.0.exe` 파일이 생성됩니다. 이 설치 파일 하나를 20명에게 그대로 나눠주면 됩니다.

각 팀원은:
1. 같은 `config/config.json` (Firebase/Google 설정 공통) 을 사용
2. 앱 실행 후 각자 자신의 구글 계정으로 "연동하기" 클릭 → 본인 캘린더만 보임
3. 설정에서 본인 이름 입력 → 공지 작성 시 이름 표시
