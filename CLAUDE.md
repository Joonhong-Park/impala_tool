# CLAUDE.md — impala_query_monitor 프로젝트 가이드

이 문서는 `impala_query_monitor` 프로젝트의 구조, 목적, 개발 컨벤션, HTTP API 명세를 정의합니다.
Claude가 이 프로젝트를 보조할 때 이 문서를 최우선 참조 기준으로 사용합니다.

---

## 1. 프로젝트 목적

Impala Daemon(impalad)의 기본 Web UI(`http://coord:25000/queries`)는 코디네이터별로 독립 운영되어
5개 클러스터 × 다수 코디네이터를 개별 브라우저로 순회해야 하는 불편함이 있습니다.

`impala_query_monitor`는 이 문제를 해결하기 위한 **사내 전용 통합 쿼리 모니터링 웹 UI**입니다.
각 impalad의 HTTP endpoint를 백엔드에서 직접 호출하여 조회/Cancel 기능을 제공합니다.

---

## 2. 시스템 아키텍처

### 2-1. 클러스터 및 코디네이터 구성

| 클러스터 | 운영 코디네이터 | 유저 코디네이터 |
|----------|----------------|----------------|
| Cluster 1 | ops-coord1, ops-coord2 | user-coord1 ~ user-coord3 |
| Cluster 2 | ops-coord1              | user-coord1 ~ user-coord5 |
| Cluster 3 | ops-coord1              | user-coord1 ~ user-coord8 |
| Cluster 4 | ops-coord1              | user-coord1 ~ user-coord4 |
| Cluster 5 | ops-coord1              | user-coord1 ~ user-coord6 |

- **운영 코디네이터**: REFRESH, ALTER 등 DDL 전용
- **유저 코디네이터**: SELECT 등 사용자 쿼리 전용
- 각 코디네이터는 자신이 코디네이터로 수행한 쿼리만 노출함 (impalad 특성)

### 2-2. 접근 방식

```
[브라우저]
    │  HTTP (내부망)
    ▼
[FastAPI 서버 (impala_query_monitor)]
    │  config.yaml 로드
    │  httpx async → verify=ca-bundle.crt
    ├──→ {cluster1-ops-coord1}:25000
    ├──→ {cluster1-ops-coord2}:25000
    ├──→ {cluster1-user-coord1}:25000
    │    ...
    └──→ {cluster5-user-coord6}:25000
```

### 2-3. 인증 / TLS

- 인증 없음 (내부망 직접 접근)
- TLS: `requests.get(url, verify="/etc/pki/tls/certs/ca-bundle.crt")`
- httpx 에서는 `httpx.AsyncClient(verify="/etc/pki/tls/certs/ca-bundle.crt")`

---

## 3. 기술 스택

| 레이어 | 기술 |
|--------|------|
| 백엔드 | Python 3, FastAPI |
| 프론트엔드 | Jinja2 템플릿 + HTML/CSS/vanilla JS |
| HTTP 클라이언트 | httpx (비동기) |
| 설정 관리 | YAML (클러스터/코디네이터 정의) |
| 실행 환경 | 에어갭 내부망 단독 서버 |

---

## 4. 화면 구성

### 4-1. 전체 레이아웃

```
┌──────────────────────────────────────────────────────────────┐
│  Header: impala_query_monitor              [새로고침] [시각]  │
├────────────┬─────────────────────────────────────────────────┤
│  Sidebar   │  Coordinator Info Bar                           │
│            │─────────────────────────────────────────────────│
│ 🔧 운영    │  ① Queries In Flight      (섹션 접기/펼치기)   │
│  ▼ CL1    │  ② Waiting to be Closed  (섹션 접기/펼치기)   │
│    coord1  │  ③ Last Completed Queries (섹션 접기/펼치기)   │
│    coord2  │                                                 │
│  ▼ CL2    │                                                 │
│    coord1  │                                                 │
│  ...       │                                                 │
│            │                                                 │
│ 👤 유저    │                                                 │
│  ▼ CL1    │                                                 │
│    coord1  │                                                 │
│    coord2  │                                                 │
│    coord3  │                                                 │
│  ...       │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

### 4-2. 사이드바 구조

- **2-depth**: 그룹(운영/유저) → 클러스터(CL1~CL5) → 코디네이터
- 기본 상태: 전체 펼침
- 클러스터 색상 구분: CL1=#4f8ef7, CL2=#2dd4bf, CL3=#a78bfa, CL4=#fb923c, CL5=#f472b6
- 선택된 코디네이터: 클러스터 색상으로 left-border + 배경 하이라이트
- Coordinator Info Bar의 left-border도 선택된 클러스터 색상으로 연동

### 4-3. 섹션별 컬럼 정의

#### ① Queries In Flight

| 컬럼 | JSON 필드 | 비고 |
|------|-----------|------|
| Query ID | `query_id` | 클릭 → 상세 모달 |
| Cancel | — | `Cancel` 텍스트 버튼, Query ID와 별도 컬럼 |
| User | `effective_user` | |
| DB | `default_db` | |
| Type | `stmt_type` | QUERY / DDL / DML |
| State | `state` | 배지 색상 구분 |
| Progress | `progress` | 진행률 바 (%) |
| Start Time | `start_time` | |
| Duration | `duration` | |
| Rows Fetched | `rows_fetched` | 실행 중엔 `—` |
| Mem Usage | `mem_usage` | |
| Last Event | `last_event` | 현재 실행 단계 |
| Resource Pool | `resource_pool` | |
| Statement | `stmt` | 말줄임 + hover tooltip |

#### ② Waiting to be Closed

| 컬럼 | JSON 필드 | 비고 |
|------|-----------|------|
| Query ID | `query_id` | 클릭 → 상세 모달 |
| Cancel | — | `Cancel` 텍스트 버튼 |
| User | `effective_user` | |
| DB | `default_db` | |
| Type | `stmt_type` | |
| State | `state` | |
| Waiting Time | `waiting_time` | 경과 시간 (노란색 강조) |
| Start Time | `start_time` | |
| End Time | `end_time` | |
| Duration | `duration` | |
| Rows Fetched | `rows_fetched` | |
| Mem Usage | `mem_usage` | |
| Statement | `stmt` | 말줄임 + hover tooltip |

#### ③ Last Completed Queries

| 컬럼 | JSON 필드 | 비고 |
|------|-----------|------|
| Query ID | `query_id` | 클릭 → 상세 모달 |
| User | `effective_user` | |
| DB | `default_db` | |
| Type | `stmt_type` | |
| State | `state` | FINISHED / EXCEPTION |
| Start Time | `start_time` | |
| End Time | `end_time` | |
| Duration | `duration` | |
| Queued | `queued_duration` | Admission 대기 시간 |
| Rows Fetched | `rows_fetched` | |
| Bytes Read | profile 파싱 | |
| Mem Peak | `mem_usage` | |
| Resource Pool | `resource_pool` | |
| Statement | `stmt` | 말줄임 + hover tooltip |

> Cancel 버튼 없음. EXCEPTION 상태는 빨간 배지.

### 4-4. 쿼리 상세 모달 (Query ID 클릭)

탭 구성:
- **Summary**: 메타 정보 그리드 (State, User, DB, Start/End Time, Duration, Rows, Bytes, Mem, Pool, Backends, Session Type)
- **Statement**: 전체 SQL (`<pre>` 블록)
- **Plan (Text)**: `/query_plan_text` 응답 표시
- **Profile**: `/query_profile_plain_text` 표시 + 다운로드 버튼 3종 (Text / JSON / Thrift)

### 4-5. Cancel 동작

- 클릭 즉시 버튼 비활성화 + 행 페이드아웃
- 400ms 후 행 DOM 제거
- In-Flight count (섹션 배지 + Coordinator Info Bar stat) 자동 갱신
- 우하단 toast 알림 표시
- `confirm()` 팝업 없음 — 즉시 실행

---

## 5. Impala HTTP Endpoint 전체 목록

> 포트 기본값: `25000`. 환경에 따라 `https://` 사용.

### 5-1. 쿼리 목록

| 용도 | Method | Endpoint |
|------|--------|----------|
| 쿼리 목록 (JSON, 파싱용) | GET | `https://{coord}:25000/queries?json` |

`/queries?json` 응답 최상위 키:
```json
{
  "in_flight_queries":    [ ... ],
  "waiting_to_be_closed": [ ... ],
  "completed_queries":    [ ... ],
  "query_locations":      [ ... ]
}
```

각 쿼리 객체 주요 필드:
```json
{
  "query_id":       "a1b2c3d4:...",
  "effective_user": "analyst_kim",
  "default_db":     "mart_db",
  "stmt":           "SELECT ...",
  "stmt_type":      "QUERY",
  "start_time":     "2025-06-09 14:28:03.000000000",
  "end_time":       "2025-06-09 14:31:14.000000000",
  "duration":       "4m04s",
  "progress":       "62%",
  "state":          "RUNNING",
  "rows_fetched":   0,
  "last_event":     "Backend startup",
  "waiting":        false,
  "executing":      true,
  "waiting_time":   "",
  "mem_usage":      "1.23 GB",
  "resource_pool":  "root.analysts"
}
```

### 5-2. 쿼리 상세

| 용도 | Method | Endpoint |
|------|--------|----------|
| Summary | GET | `https://{coord}:25000/query_summary?query_id={qid}` |
| Plan (텍스트) | GET | `https://{coord}:25000/query_plan_text?query_id={qid}` |
| Plan (그래픽) | GET | `https://{coord}:25000/query_plan?query_id={qid}` |
| Profile (HTML) | GET | `https://{coord}:25000/query_profile?query_id={qid}` |
| Profile (plain text, 다운로드용) | GET | `https://{coord}:25000/query_profile_plain_text?query_id={qid}` |
| Profile (JSON) | GET | `https://{coord}:25000/query_profile?query_id={qid}&json` |
| Profile (Thrift) | GET | `https://{coord}:25000/query_profile?query_id={qid}&thrift` |

### 5-3. Cancel

| 용도 | Method | Endpoint |
|------|--------|----------|
| 쿼리 Cancel | GET | `https://{coord}:25000/cancel_query?query_id={qid}` |

> ⚠️ `waiting_to_be_closed` 상태 쿼리에 Cancel 적용 시 효과 없을 수 있음 (IMPALA-12493).
> 사전 안내 문구 또는 toast 경고 표시 권장.

### 5-4. 보조 endpoint (선택적 활용)

| 용도 | Endpoint |
|------|----------|
| Admission Controller 상태 | `https://{coord}:25000/admission?json` |
| 세션 목록 | `https://{coord}:25000/sessions` |
| 백엔드 목록 | `https://{coord}:25000/backends?json` |
| 메트릭 | `https://{coord}:25000/metrics?json` |

---

## 6. 디렉터리 구조

```
impala_query_monitor/
├── config.yaml                  # 클러스터/코디네이터 정의
├── main.py                      # FastAPI 앱 진입점
├── routers/
│   └── queries.py               # 쿼리 목록, 상세, cancel, profile 다운로드
├── services/
│   └── impala_client.py         # httpx 기반 Impala endpoint 호출
├── templates/
│   ├── base.html                # 공통 레이아웃 (사이드바 포함)
│   ├── queries.html             # 쿼리 목록 메인 화면
│   └── query_detail.html        # 쿼리 상세 모달 (또는 인라인 렌더)
├── static/
│   └── main.js                  # 사이드바 토글, Cancel fetch, 모달 탭 전환
└── certs/
    └── ca-bundle.crt            # TLS 인증서 (심볼릭 링크 또는 복사본)
```

---

## 7. config.yaml 구조

```yaml
tls:
  ca_bundle: /etc/pki/tls/certs/ca-bundle.crt

clusters:
  - id: 1
    name: cluster1
    color: "#4f8ef7"
    coordinators:
      ops:
        - host: ops-coord1.cl1.internal
          port: 25000
        - host: ops-coord2.cl1.internal
          port: 25000
      user:
        - host: user-coord1.cl1.internal
          port: 25000
        - host: user-coord2.cl1.internal
          port: 25000
        - host: user-coord3.cl1.internal
          port: 25000
  - id: 2
    name: cluster2
    color: "#2dd4bf"
    coordinators:
      ops:
        - host: ops-coord1.cl2.internal
          port: 25000
      user:
        - host: user-coord1.cl2.internal
          port: 25000
        # ... user-coord5 까지
  # cluster3 ~ cluster5 동일 구조
```

---

## 8. 개발 순서

| 단계 | 모듈 | 주요 내용 |
|------|------|-----------|
| 1 | `config.yaml` + 로더 | 클러스터/코디네이터 설정 파싱, `ClusterConfig` dataclass |
| 2 | `impala_client.py` | httpx AsyncClient, `/queries?json` 호출, cancel, profile 스트리밍 |
| 3 | `routers/queries.py` | FastAPI 라우터: 목록 조회, cancel POST, profile 다운로드 |
| 4 | `base.html` + `queries.html` | 사이드바 + 3섹션 테이블 렌더링 |
| 5 | `query_detail.html` | Summary/Statement/Plan/Profile 탭 + 다운로드 버튼 |
| 6 | `main.js` | Cancel fetch, 사이드바 접기/펼치기, 모달 탭 전환 |
| 7 | 통합 테스트 | 5개 클러스터 전체 코디네이터 연결 검증 |

---

## 9. 개발 컨벤션

| 항목 | 규칙 |
|------|------|
| 언어 | Python 3 |
| 변수명 | `snake_case` (PEP8) |
| 주석 | 한국어 |
| 타입 힌트 | 필수 |
| 하드코딩 금지 | URL, 포트, 인증정보 — 반드시 `config.yaml` 참조 |
| 로그 출력 | 파이프 구분자 형식, stderr 출력 |
| 에러 처리 | 개별 코디네이터 호출 실패 시 해당 항목만 에러 표시, 나머지 정상 렌더링 |

---

## 10. 주요 설계 결정 및 유의사항

| 항목 | 내용 |
|------|------|
| 데이터 수집 | `/queries?json` JSON API 파싱 (HTML 스크래핑 아님) |
| Profile 다운로드 | `/query_profile_plain_text` → FastAPI `StreamingResponse` → 브라우저 파일 전달 |
| Cancel 방식 | GET `/cancel_query?query_id=` → 성공 시 행 제거 + toast |
| waiting_to_be_closed Cancel | 효과 없을 수 있음 — 별도 UI 경고 불필요 (확정) |
| 상세 화면 렌더링 | Impala 원본 HTML 직접 프록시 지양 → `<pre>` 태그로 텍스트 파싱 후 표시 |
| 새로고침 | 수동 새로고침 전용 (자동 폴링 없음) |
| 에어갭 환경 | 외부 CDN 사용 금지, 모든 JS/CSS 로컬 static 파일로 관리 |

---

## 11. MVP 범위

**포함**:
- 사이드바에서 코디네이터 선택
- 3섹션 쿼리 목록 조회 (In-Flight / Waiting / Completed)
- 쿼리 Cancel
- 쿼리 상세 모달 (Summary / Statement / Plan / Profile)
- Profile 3종 다운로드 (Text / JSON / Thrift)

**제외 (Post-MVP)**:
- 자동 새로고침 (폴링)
- 전체 클러스터 동시 조회 통합 뷰
- 쿼리 실행 이력 영구 저장
- 사용자 인증/접근 제어

---

## 12. 미결 사항 (개발 전 확인 필요)

| 항목 | 상태 |
|------|------|
| 각 코디네이터 실제 hostname / port | 미확인 — config.yaml 작성 전 필요 |
| HTTPS 여부 (http vs https 포트) | 미확인 |
| FastAPI 배포 서버 호스트 및 포트 | 미확인 |
| impalad 버전 (CDP 기준) | 미확인 — `/queries?json` 응답 필드가 버전에 따라 다를 수 있음 |
