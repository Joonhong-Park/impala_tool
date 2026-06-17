# CLAUDE.md — impala_tool 프로젝트 가이드

이 문서는 `impala_tool` 프로젝트를 동일하게 재현하기 위한 요구사항, 설계 명세, 제약 조건을 정의합니다.
Claude가 이 프로젝트를 보조할 때 이 문서를 최우선 참조 기준으로 사용합니다.

---

## 1. 프로젝트 목적

Impala 운영 편의를 위한 **사내 전용 통합 웹 UI**로, 두 가지 기능을 제공합니다.

| 탭 | 기능 | 데이터 소스 |
|----|------|------------|
| **Query Monitoring** | 코디네이터별 실시간 쿼리 조회 / Cancel / Rows Available 전체 취소 | impalad HTTP API (`/queries?json`) |
| **Query Explorer** | 시간 범위 기반 쿼리 이력 검색 (키워드·사용자·상태 필터) + 프로파일 다운로드 | Cloudera Manager API |

---

## 2. 시스템 아키텍처

### 2-1. 클러스터 및 코디네이터 구성

| 클러스터 | 운영 코디네이터 | 유저 코디네이터 |
|----------|----------------|----------------|
| cluster1 | ops-coord1, ops-coord2 | user-coord1 ~ user-coord3 |
| cluster2 | ops-coord1              | user-coord1 ~ user-coord5 |
| cluster3 | ops-coord1              | user-coord1 ~ user-coord8 |
| cluster4 | ops-coord1              | user-coord1 ~ user-coord4 |
| cluster5 | ops-coord1              | user-coord1 ~ user-coord6 |

- **운영 코디네이터**: REFRESH, ALTER 등 DDL 전용
- **유저 코디네이터**: SELECT 등 사용자 쿼리 전용
- 각 코디네이터는 자신이 코디네이터로 수행한 쿼리만 노출 (impalad 특성)

### 2-2. 접근 방식

```
[브라우저]
    │  HTTP (내부망)
    ▼
[FastAPI 서버 (impala_tool)]
    │  config.yaml 로드
    ├── /monitor/* ──→ impalad :25000/queries?json  (실시간)
    └── /explorer/* ─→ CM API  :7183/api/vXX/...   (이력)
```

### 2-3. 인증 / TLS

- 인증 없음 (내부망 직접 접근)
- TLS: `httpx.AsyncClient(verify=False)` — 내부망 자체 서명 인증서 대응으로 SSL 검증 비활성화
  - `config.yaml`의 `ca_bundle` 필드는 설정에 존재하나 현재 검증에 사용되지 않음

---

## 3. 기술 스택

| 레이어 | 기술 |
|--------|------|
| 백엔드 | Python 3, FastAPI |
| 프론트엔드 | Jinja2 템플릿 (`base.html` + `{% include %}` 파셜) + vanilla JS |
| HTTP 클라이언트 | httpx (비동기) |
| 설정 관리 | YAML (`config.yaml`, `launcher_config.yaml`) |
| 실행 환경 | 에어갭 내부망 단독 서버 |
| 배포 클라이언트 | Windows용 SSH 터널 런처 (`launcher.py`, PyInstaller 빌드) |

---

## 4. 디렉터리 구조

```
impala_tool/
├── config.yaml                  # 클러스터/코디네이터/CM/앱/explorer 설정
├── launcher_config.yaml         # launcher.py 전용 SSH 터널 서버 설정
├── main.py                      # FastAPI 앱 진입점, Jinja2 템플릿 등록
├── launcher.py                  # Windows .exe 런처 (SSH 터널 + tkinter GUI)
├── pack_server.py               # 서버 배포용 zip 패키저
├── requirements.txt
├── README.md
├── .gitignore
├── routers/
│   ├── monitor.py               # /monitor/* — impalad 실시간 조회/Cancel
│   └── explorer.py              # /explorer/* — CM API 이력 검색, SSE 스트리밍
├── services/
│   ├── config_loader.py         # config.yaml 파싱, dataclass 정의
│   ├── impala_client.py         # impalad HTTP endpoint 비동기 클라이언트
│   └── cm_client.py             # CM API 비동기 클라이언트, 청크 스트리밍
├── templates/
│   ├── base.html                # HTML 셸: CSS/JS 링크, 헤더, 탭 구조
│   ├── _explorer.html           # Query Explorer 탭 콘텐츠
│   └── _monitor.html            # Query Monitoring 탭 콘텐츠
└── static/
    ├── css/
    │   ├── base.css             # 공통 스타일 (헤더, 버튼, 배지, 테이블)
    │   ├── explorer.css         # Query Explorer 전용 스타일
    │   └── monitor.css          # Query Monitoring + 토스트 스타일
    └── js/
        ├── common.js            # DOM 헬퍼, 탭 전환, 토스트, XSS 이스케이프, 클러스터 색상 공유
        ├── explorer.js          # Query Explorer 로직 (검색, SSE, 렌더, 다운로드)
        └── monitor.js           # Query Monitoring 로직 (Rows Available 취소 포함)
```

---

## 5. config.yaml 구조

```yaml
app:
  port: 9191
  ca_bundle: /etc/pki/tls/certs/ca-bundle.crt

cm:
  username: admin
  password: changeme
  request_timeout: 120           # httpx timeout (초)

explorer:
  chunk_hours: 0.05              # 청크 단위 시간 (기본 3분 = 3/60)
  chunk_limit: 1000              # CM API 청크당 limit 파라미터

clusters:
  - id: cluster1                 # 문자열 ID (JS/Python 모두 str 기준)
    enabled: true                # false 설정 후 서버 재시작 시 해당 클러스터 숨김
    color: "#4f8ef7"             # 클러스터 식별 색상 (hex)
    cm:
      host: cm1.internal
      port: 7183
      api_version: v57
      cluster_name: CDP-Base     # 해당 CM 인스턴스에서의 클러스터 서비스 이름
    coordinators:
      ops:
        - host: ops-coord1.cl1.internal
          port: 25000
      user:
        - host: user-coord1.cl1.internal
          port: 25000
  # cluster2 ~ cluster5 동일 구조
```

### 설정 dataclass 계층

```
Config
├── app: AppConfig          (port, ca_bundle)
├── cm: CmGlobalConfig      (username, password, request_timeout)
├── explorer: ExplorerConfig (chunk_hours, chunk_limit)
└── clusters: list[ClusterConfig]
    ├── id, color
    ├── cm: CmConfig        (host, port, api_version, cluster_name)
    └── coordinators
        ├── ops_coordinators: list[CoordinatorConfig]  (host, port)
        └── user_coordinators: list[CoordinatorConfig] (host, port)
```

- `Config.find_coordinator(host)` — host 문자열로 전체 클러스터에서 `CoordinatorConfig` 탐색

---

## 6. FastAPI 라우터 명세

### 6-1. `/monitor` — Query Monitoring

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/monitor/coordinators` | 전체 클러스터/코디네이터 목록 반환 |
| GET | `/monitor/queries/{coord_host:path}` | 지정 코디네이터의 쿼리 목록 (impalad `/queries?json` 프록시) |
| POST | `/monitor/cancel/{coord_host:path}/{query_id}` | 쿼리 Cancel |

#### `/monitor/coordinators` 응답 형식

```json
{
  "clusters": [
    {
      "id": "cluster1",
      "color": "#4f8ef7",
      "ops":  [{"host": "ops-coord1.cl1.internal", "port": 25000}],
      "user": [{"host": "user-coord1.cl1.internal", "port": 25000}]
    }
  ]
}
```

#### `/monitor/cancel` 응답 형식

- 성공: `{"ok": true}`
- 실패: HTTP 502

### 6-2. `/explorer` — Query Explorer

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/explorer/clusters` | 클러스터 ID·색상 목록 (`[{id, color}]`) |
| GET | `/explorer/queries/stream` | 쿼리 이력 검색 (SSE 스트리밍) |
| GET | `/explorer/profile/{cluster_id}/{query_id}` | CM API에서 프로파일 조회, `{query_id}_profile.txt` 다운로드 |

#### `/explorer/clusters` 응답 형식

```json
{"clusters": [{"id": "cluster1", "color": "#4f8ef7"}, ...]}
```

#### `/explorer/queries/stream` 쿼리 파라미터

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `conditions` | JSON 문자열 | `[{"field":"keyword","value":"..."},{"field":"user","value":"..."}]` |
| `query_type` | str | `QUERY` / `DDL` / `SET` / `N/A` |
| `query_state` | str | `FINISHED` / `RUNNING` / `EXCEPTION` (콤마 구분 복수 가능) |
| `hours` | int | 빠른 시간 범위 (from/to 미지정 시 사용) |
| `from_time` | str | 시작 시각 (단독 지정 시 hours만큼 이후가 to로 계산) |
| `to_time` | str | 종료 시각 (단독 지정 시 hours만큼 이전이 from으로 계산) |
| `clusters` | str | 클러스터 ID (콤마 구분, 미지정 시 전체) |

#### SSE 이벤트 형식

```json
// 진행 중
{"type":"progress","chunk":3,"total":480,"collected":42,"new_queries":[...]}

// 완료
{"type":"done","queries":[...],"cluster_results":[{"cluster":"cluster1","count":42,"error":null}],"total":42,"filter_applied":"..."}
```

#### `/explorer/profile` 동작

- CM 웹 UI는 Basic Auth 미지원 — 세션 로그인 후 다운로드
  1. `POST /j_spring_security_check` (form data: `j_username`, `j_password`) — 세션 쿠키 획득
  2. `GET /cmf/impala/downloadProfile?queryId={query_id}&format=PRETTY_PRINT` — 프로파일 다운로드
- `httpx.AsyncClient(follow_redirects=True)` 사용, SSL 검증 비활성화, timeout=`cm.request_timeout`
- 응답을 `resp.text`로 직접 반환 — JSON 파싱 없음
- `Content-Disposition: attachment; filename="{query_id}_profile.txt"` 로 반환 (`text/plain; charset=utf-8`)
- 404 시 보관 기간 만료 메시지 JSON 반환, 그 외 오류는 HTTP 500 + `{"error": "..."}`

---

## 7. Impala HTTP Endpoint

> 포트 기본값: `25000`. 내부망 HTTPS 사용.

| 용도 | Endpoint |
|------|----------|
| 쿼리 목록 (JSON) | `https://{coord}:25000/queries?json` |
| Cancel | `https://{coord}:25000/cancel_query?query_id={qid}` |

### `/queries?json` 응답 구조

최상위 키: `in_flight_queries`, `completed_queries`, `query_locations`

#### `in_flight_queries` 항목 필드

실행 중(`waiting: false`)과 대기 중(`waiting: true`) 쿼리가 혼합되어 있음.

| 필드 | 타입 | 설명 |
|------|------|------|
| `query_id` | str | 쿼리 ID |
| `stmt` | str | SQL 전문 |
| `stmt_type` | str | `QUERY` / `DDL` 등 |
| `state` | str | `RUNNING` / `FINISHED` / `EXCEPTION` |
| `effective_user` | str | 실행 사용자 |
| `default_db` | str | 기본 DB |
| `start_time` | str | 시작 시각 |
| `duration` | str | 경과 시간 문자열 |
| `progress` | str | `"47891 / 54138 (88.461%)"` 형식 — 파싱 필요 |
| `row_fetched` | int | fetch된 행 수 |
| `mem_usage` | str | 메모리 사용량 |
| `last_event` | str | 마지막 이벤트 문자열 (e.g. `"Rows available"`) |
| `resource_pool` | str | 리소스 풀 |
| `waiting` | bool | `true`이면 대기 쿼리 (Waiting to be Closed) |
| `waiting_time` | str | 대기 시간 (waiting=true인 경우) |
| `end_time` | str | 종료 시각 (waiting=true인 경우) |

#### `completed_queries` 항목 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `query_id` | str | 쿼리 ID |
| `stmt` | str | SQL 전문 |
| `stmt_type` | str | 쿼리 타입 |
| `state` | str | `FINISHED` / `EXCEPTION` |
| `effective_user` | str | 실행 사용자 |
| `default_db` | str | 기본 DB |
| `start_time` | str | 시작 시각 |
| `end_time` | str | 종료 시각 |
| `duration` | str | 실행 시간 |
| `queued_duration` | str | 큐 대기 시간 |
| `row_fetched` | int | fetch된 행 수 |
| `bytes_read` | str | 읽은 바이트 수 |
| `mem_usage` | str | 메모리 사용량 |
| `resource_pool` | str | 리소스 풀 |

---

## 8. CM API 연동 명세 (`cm_client.py`)

### CM API URL 패턴

```
https://{cluster.cm.host}:{cluster.cm.port}
  /api/{cluster.cm.api_version}
  /clusters/{cluster.cm.cluster_name}
  /services/impala/impalaQueries
```

- 인증: Basic Auth (`cm.username`, `cm.password`) — `config.yaml`의 `cm.username` / `cm.password` 사용
- SSL 검증: `verify=False` (내부망 자체 서명 인증서 대응)

### 검색 모드 분기

```
조건 있음 (keyword / user 조건 또는 query_type 또는 query_state 지정 시)
    → _stream_chunked: 시간 구간을 chunk_hours 단위로 분할
      최신→과거 방향으로 순회, 클러스터 병렬 요청 (asyncio.gather)
      Python 클라이언트 사이드 필터링 (_matches_conditions)
      매 청크마다 progress 이벤트 yield

조건 없음
    → _stream_single_shot: limit=chunk_limit으로 1회 요청
      progress 이벤트(chunk=0) 1회 → done 이벤트 1회 yield
```

### 필터링 규칙 (`_matches_conditions`)

- `query_type`: `q["queryType"] == query_type` 일치
- `query_state`: 콤마 구분 복수 허용, `q["queryState"] in states`
- `field=user`: `q["user"] == value` 완전 일치
- `field=keyword`: `value.lower() in q["statement"].lower()` 포함 검색

### 중복 제거

- `seen_ids` set으로 청크 간 `queryId` 중복 제거
- `queryId` 없는 행은 dedup 생략 (매번 수집)

### `resolve_time_range` 동작

| from_time | to_time | 결과 |
|-----------|---------|------|
| ✓ | ✓ | 그대로 반환 |
| ✓ | ✗ | from ~ from + hours |
| ✗ | ✓ | to - hours ~ to |
| ✗ | ✗ | now - hours ~ now |

- `hours` 미지정 시 기본값 24

### `build_filter` (표시용 문자열, CM 전달 아님)

- `query_type` → `queryType = "QUERY"`
- `field=user` → `user = "value"` (큰따옴표 이스케이프 처리)
- `field=keyword` → `statement rlike "(?i).*escaped_value.*"`
- `query_state` 복수 → `queryState rlike "(FINISHED|EXCEPTION)"`

---

## 9. 프론트엔드 구조

### 9-1. HTML 구조 (`templates/`)

- `base.html`: CSS/JS 링크, 헤더(탭 2개), 탭 콘텐츠 div 2개, toast div
  - JS 로드 순서 필수: `common.js` → `explorer.js` → `monitor.js`
  - DOMContentLoaded: `qmLoadSidebar()`, `qeInit()` 동시 호출
- `_explorer.html`: QE 필터 폼, 진행 바, 상태 탭, 클러스터 탭, 결과 테이블 (13컬럼)
- `_monitor.html`: 사이드바(운영/유저 코디네이터), 인포바, 3섹션 테이블

### 9-2. `common.js` 책임

- `$(id)` — `document.getElementById` 단축
- `switchTab(id)` — 탭 전환 (`.app-tab`, `.tab-content` active 토글)
- `showToast(msg, isErr)` — 하단 우측 토스트 3.5초 표시
- `esc(s)` — XSS 방지 HTML 이스케이프 (`&`, `<`, `>`, `"`, `'`)
- `_CLUSTER_COLOR` — `Map<id, hex>`, QM·QE 공유
- `_hexToRgba(hex, alpha)`, `_clFg(id)`, `_clBg(id)` — 클러스터 색상 헬퍼
- `_STATE_BADGE_CLS` — `{FINISHED, RUNNING, EXCEPTION, QUEUED}` → CSS 클래스 맵

### 9-3. `monitor.js` 책임

#### 상태 변수

| 변수 | 설명 |
|------|------|
| `_qmSelectedHost` | 현재 선택된 코디네이터 호스트 |
| `_inflightQueries` | 현재 in-flight 쿼리 배열 (Rows Available 취소에 사용) |

#### 주요 함수

| 함수 | 동작 |
|------|------|
| `qmLoadSidebar()` | `/monitor/coordinators` 호출, 사이드바 클러스터/코디 구성, `_CLUSTER_COLOR` 채움 |
| `buildClusterGroup(cl, coords)` | 클러스터 헤더 + 코디네이터 목록 DOM 요소 생성 후 반환 |
| `toggleClusterGroup(hdr)` | 사이드바 클러스터 그룹 접기/펼치기 |
| `qmSelectCoord(item)` | 코디네이터 선택, 인포바 색상·이름 갱신, `coord-placeholder` 클래스 제거, `qmFetchQueries()` 호출 |
| `qmRefresh()` | `_qmSelectedHost`가 있으면 `qmFetchQueries()` 재호출 |
| `toggleSec(hdr)` | 쿼리 섹션 body의 `collapsed` 클래스 토글, chevron 문자 전환 |
| `qmFetchQueries(resetSections=false)` | `/monitor/queries/{host}` 호출, in_flight를 `waiting` 필드로 분리, 3섹션 렌더; `resetSections=true` 시 섹션 전체 펼침 초기화 |
| `updateSecCnt(id, n, colorClass)` | 섹션 카운트 배지 텍스트·색상 클래스 갱신 |
| `qmCancel(btn, queryId)` | POST `/monitor/cancel/...`, 성공 시 행 페이드아웃 제거 + `_inflightQueries` 갱신 |
| `qmRefreshCounts()` | DOM 기준으로 secCnt·ib 카운트 갱신 (개별 Cancel 후 호출) |
| `qmCancelRowsAvailable()` | `_inflightQueries`에서 `progress=100% && last_event='Rows available' && row_fetched===0` 필터, confirm 후 `Promise.allSettled` 병렬 취소 |

#### `progress` 파싱

```javascript
parseFloat(progressStr?.match(/\((\d+(?:\.\d+)?)%\)/)?.[1]) || 0
```

#### 3섹션 테이블 컬럼

| 섹션 | 컬럼 수 | 주요 컬럼 |
|------|---------|-----------|
| In-Flight | 14 | QueryID, Cancel, User, DB, Type, State, Progress(바+%), Start, Duration, Rows, Mem, LastEvent, Pool, Stmt |
| Waiting | 13 | QueryID, Cancel, User, DB, Type, State(badge), WaitingTime, Start, End, Duration, Rows, Mem, Stmt |
| Completed | 14 | QueryID, User, DB, Type, State(badge), Start, End, Duration, Queued, Rows, BytesRead, Mem, Pool, Stmt |

### 9-4. `explorer.js` 책임

#### 상태 변수

| 변수 | 설명 |
|------|------|
| `_allRows` | 전체 수집 쿼리 (서버 필터 결과) |
| `_rows` | 클라이언트 필터(상태/클러스터 탭) 적용 후 렌더 대상 |
| `_activeState` | 현재 선택된 상태 탭 값 (`''`=전체) |
| `_activeCluster` | 현재 선택된 클러스터 탭 값 (`''`=전체) |
| `_openRows` | 확장된 행 queryId Set |
| `_sortCol` | 정렬 컬럼 (기본 `startTime`) |
| `_sortAsc` | 정렬 방향 (기본 내림차순) |
| `_activeHours` | 프리셋 시간 범위 (기본 1) |
| `_page` | 현재 페이지 번호 (기본 1) |
| `_pageSize` | 페이지당 행 수 (상수 100) |
| `_es` | 현재 EventSource 인스턴스 |

#### 주요 함수

| 함수 | 동작 |
|------|------|
| `formatKST(isoStr)` | ISO 시각 → KST "YYYY-MM-DD HH:mm:ss" 문자열 변환 |
| `formatDuration(ms)` | 밀리초 → `Xms` / `Xs` / `Xm Ys` 사람이 읽는 형식 |
| `qeInit()` | `qeLoadClusters()` 호출, 이벤트 바인딩, 초기 프리셋 1h 설정 |
| `qeLoadClusters()` | `/explorer/clusters` 호출, `_CLUSTER_COLOR` 채움, select·탭 구성 |
| `qeSetPreset(h)` | 빠른 범위 프리셋 선택, from/to 입력 초기화 |
| `qeAddCondRow()` | 키워드 조건 입력 행을 `#qe-conds` 영역에 추가 |
| `qeBuildSearchParams()` | 폼 값 → `URLSearchParams` 객체 반환 |
| `qeSearch()` | SSE 연결, `_resetStateTabs()` 호출, 청크별 `_allRows` 누적 렌더 |
| `qeStop()` | SSE 중단, `qeFinish(null)` 호출 |
| `qeFinish(ev)` | 버튼 상태 복원, 완료 요약 표시 (ev=null이면 요약 생략) |
| `qeApplyFilters()` | `_allRows`에서 상태·클러스터 필터 적용 → `_rows` 갱신 → 렌더 |
| `qeUpdateCounts()` | 클러스터/상태 탭 카운트 배지 갱신 |
| `qeRenderTable()` | `_rows` 정렬·페이지 슬라이싱 후 테이블 재렌더, 확장 행 포함 |
| `qeRenderPagination(totalPages)` | 페이지 수 > 1이면 페이지네이션 DOM 렌더 |
| `qeGoPage(n)` | 페이지 번호 범위 클램프 후 `qeRenderTable()` 재호출 |
| `qeToggleRow(queryId)` | `_openRows` Set 토글 후 `qeRenderTable()` 재호출 |
| `qeSort(th)` | 컬럼 클릭 시 `_sortCol`·`_sortAsc` 갱신 후 렌더 |
| `qeSelectState(el)` | 상태 탭 선택, `_activeState` 갱신, `qeApplyFilters()` 호출 |
| `qeSelectCluster(el)` | 클러스터 탭 선택, `_activeCluster` 갱신, 상태 탭 "전체" 리셋, `qeApplyFilters()` 호출 |
| `qeDownloadProfile(clusterId, queryId)` | fetch → blob → `<a download>` 트릭으로 저장, 오류 시 toast |
| `qeReset()` | 폼 초기화 + SSE 중단 + 결과 테이블·데이터 전체 초기화 |
| `_resetStateTabs()` | `_activeState`·`_activeCluster` 초기화, 탭 UI "전체"로 복원 |

#### 결과 테이블 컬럼 (13개)

`▶`, 클러스터(badge), QueryID, 사용자, ConnectedUser, 상태, Statement, 실행시간, Rows, 시작시간, 종료시간, queryStatus, 프로파일 다운로드

- **▶ 클릭**: 확장 행에 쿼리 전문(statement) 출력
- **프로파일 다운로드 버튼**: `qeDownloadProfile()` 호출 → `{queryId}_profile.txt` 저장

---

## 10. launcher.py (Windows 배포용)

- **역할**: 사내 Windows PC에서 SSH 2-hop 터널 연결 후 브라우저 자동 오픈
- **터널 경로**: `PC → 터널 서버 → node1(FastAPI 서버)`, localhost:9191 포워딩
- **GUI**: tkinter (다크 테마), 비밀번호 저장 (Fernet, 기기 고유 키 = `COMPUTERNAME + USERNAME` SHA-256)
- **빌드**: `pyinstaller --onefile --noconsole --name ImpalaTool --add-data "launcher_config.yaml;." launcher.py`
  - `launcher_config.yaml`이 번들(.exe) 안에 포함됨
- **설정 파일 탐색 순서** (앞쪽이 우선):
  1. `sys.executable` 부모 (exe 옆 — 이 위치에 두면 번들 설정을 override)
  2. `sys._MEIPASS` (PyInstaller 번들 내부)
  3. `__file__` 부모 (개발 실행)
  4. cwd
- 설정 파일을 찾지 못하면 tkinter 에러 다이얼로그 표시 후 종료

### launcher_config.yaml 구조

```yaml
tunnel_servers:
  - label: 터널 서버 1
    host: tunnel_server1
    port: 22
    user: tunnel_user1

node:
  host: node1
  port: 22
  user: node_user

app:
  local_port: 9191
  remote_port: 9191
```

### TunnelManager 동작

1. `tunnel_client` → 터널 서버 SSH 연결
2. `transport.open_channel("direct-tcpip", (NODE_HOST, NODE_PORT), ...)` → 내부 채널
3. `node_client` → 해당 채널을 소켓으로 node1 SSH 연결
4. `localhost:LOCAL_PORT` 소켓 서버 → 수신 연결마다 `_forward_handler` 스레드 생성
5. 연결 후 10초마다 `transport.is_active()` 헬스 체크, 끊기면 UI에 알림

---

## 11. 개발 컨벤션

| 항목 | 규칙 |
|------|------|
| 언어 | Python 3 |
| 변수명 | `snake_case` (PEP8) |
| 주석 | 한국어 |
| 타입 힌트 | 필수 |
| 하드코딩 금지 | URL, 포트, 인증정보 — 반드시 `config.yaml` 참조 |
| 에러 처리 | 개별 코디네이터/클러스터 호출 실패 시 해당 항목만 에러 표시, 나머지 정상 렌더링 |
| 에어갭 환경 | 외부 CDN 사용 금지, 모든 JS/CSS 로컬 static 파일 |
| XSS 방지 | JS에서 DOM에 문자열 삽입 시 반드시 `esc()` 통과 |

---

## 12. 주요 설계 결정

| 항목 | 내용 |
|------|------|
| 프론트엔드 | Jinja2 템플릿 (`base.html` + `{% include %}` 파셜) + 분리된 CSS/JS |
| CM API 필터링 | CM API에 `filter` 파라미터 전달하지 않음 — 모든 필터링은 Python 클라이언트에서 수행 |
| 청크 스트리밍 | 조건 있을 때만 SSE 스트리밍; 조건 없을 땐 단일 요청 후 done 이벤트 1회 |
| 클러스터 색상 | `config.yaml`의 `color` 필드 → API 응답 → `common.js`의 `_CLUSTER_COLOR` Map (QM·QE 공유) |
| QE 색상 독립성 | `/explorer/clusters`가 `color` 포함 반환 → `qeLoadClusters`에서 직접 `_CLUSTER_COLOR` 채움 (QM 로딩에 무의존) |
| Cancel (개별) | POST `/monitor/cancel/...` → 성공 시 행 페이드아웃 + `_inflightQueries` 즉시 갱신 + toast |
| Rows Available 취소 | `progress=100% && last_event='Rows available' && row_fetched===0` 조건, confirm 후 `Promise.allSettled` 병렬 취소 |
| 프로파일 | CM 웹 UI `/cmf/impala/downloadProfile?queryId=...&format=PRETTY_PRINT` → `resp.text` → `text/plain` attachment 다운로드 |
| 새로고침 | 수동 전용 (자동 폴링 없음) |
| query_state 필터 | Explorer: 서버(Python)와 클라이언트(JS 탭) 양쪽 모두 적용 |
| QE 탭 초기화 | 새 검색 시작 시 상태·클러스터 탭을 "전체"로 자동 리셋 |
| QE 초기화 버튼 | 폼과 함께 결과 테이블·데이터·SSE 연결 전부 초기화 |
| 클러스터 비활성화 | `config.yaml` `enabled: false` → `load_config()` 에서 해당 클러스터 제외, 서버 재시작 필요 |
| QM 레이아웃 | `#qm-sidebar { position: fixed }` + `#qm-main { margin-left: 210px }` — 사이드바를 플로우에서 제거해 body 높이를 콘텐츠 기준으로 만들어 전체 페이지 스크롤 구현 |
| QM 섹션 sticky | `.qm-section { overflow: clip }` — `overflow: hidden`은 CSS 스펙상 스크롤 컨테이너를 생성해 내부 sticky가 동작하지 않음; `clip`은 시각적 클리핑만 수행 |
| QM sticky top 계산 | `.qm-sec-hdr { top: 110px }` (헤더 46px + 인포바 64px), `.qm-tbl thead { top: 145px }` (+35px 섹션헤더) |
| Cancel onclick 패턴 | `cancelCell`에서 `data-qid` 속성 사용 — `esc()`가 `'`를 `&#39;`로 변환 후 JS 컨텍스트 onclick 속성에서 브라우저가 디코딩하면 인자가 깨지는 문제 방지 |

---

## 13. 실행 방법

```bash
pip install -r requirements.txt
python main.py
# 또는
uvicorn main:app --host 0.0.0.0 --port 9191
```

접속: `http://localhost:9191`
