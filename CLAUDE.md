# CLAUDE.md — impala_tool 프로젝트 가이드

이 문서는 `impala_tool` 프로젝트의 구조, 목적, 개발 컨벤션, HTTP API 명세를 정의합니다.
Claude가 이 프로젝트를 보조할 때 이 문서를 최우선 참조 기준으로 사용합니다.

---

## 1. 프로젝트 목적

Impala 운영 편의를 위한 **사내 전용 통합 웹 UI**로, 두 가지 기능을 제공합니다.

| 탭 | 기능 | 데이터 소스 |
|----|------|------------|
| **Query Monitoring** | 코디네이터별 실시간 쿼리 조회 / Cancel / Rows Available 전체 취소 | impalad HTTP API (`/queries?json`) |
| **Query Explorer** | 시간 범위 기반 쿼리 이력 검색 (사용자·키워드·상태 필터) | Cloudera Manager API |

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
- TLS: `httpx.AsyncClient(verify=config.app.ca_bundle)`
  - ca_bundle 경로: `/etc/pki/tls/certs/ca-bundle.crt` (config.yaml에서 관리)

---

## 3. 기술 스택

| 레이어 | 기술 |
|--------|------|
| 백엔드 | Python 3, FastAPI |
| 프론트엔드 | Jinja2 템플릿 (base.html + 파셜) + vanilla JS |
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
├── requirements.txt
├── .gitignore
├── routers/
│   ├── monitor.py               # /monitor/* — impalad 실시간 조회/Cancel
│   └── explorer.py              # /explorer/* — CM API 이력 검색, SSE 스트리밍
├── services/
│   ├── config_loader.py         # config.yaml 파싱, dataclass 정의 (ExplorerConfig 포함)
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
        ├── common.js            # DOM 헬퍼, 탭 전환, 토스트, XSS 이스케이프, 클러스터 색상 공유 변수
        ├── explorer.js          # Query Explorer 로직 (검색, SSE, 렌더)
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
  cluster_name: CDP-Base        # CM에서의 클러스터 서비스 이름
  request_timeout: 120

explorer:
  chunk_hours: 0.05             # 청크 단위 시간 (기본 3분 = 3/60)
  chunk_limit: 1000             # 청크당 최대 쿼리 수

clusters:
  - id: cluster1                # 문자열 ID (JS/Python 모두 str 기준)
    color: "#4f8ef7"
    cm:
      host: cm1.internal
      port: 7183
      api_version: v57
    coordinators:
      ops:
        - host: ops-coord1.cl1.internal
          port: 25000
      user:
        - host: user-coord1.cl1.internal
          port: 25000
  # cluster2 ~ cluster5 동일 구조
```

---

## 6. FastAPI 라우터 명세

### 6-1. `/monitor` — Query Monitoring

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/monitor/coordinators` | 전체 클러스터/코디네이터 목록 반환 |
| GET | `/monitor/queries/{coord_host:path}` | 지정 코디네이터의 쿼리 목록 (impalad `/queries?json` 프록시) |
| POST | `/monitor/cancel/{coord_host:path}/{query_id}` | 쿼리 Cancel |

### 6-2. `/explorer` — Query Explorer

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/explorer/clusters` | 클러스터 ID 목록 |
| GET | `/explorer/queries/stream` | 쿼리 이력 검색 (SSE 스트리밍) |
| GET | `/explorer/profile/{cluster_id}/{query_id}` | CM API에서 프로파일 조회, HTML 반환 |

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
{"type":"done","queries":[...],"cluster_results":[...],"total":42,"filter_applied":"..."}
```

---

## 7. Impala HTTP Endpoint

> 포트 기본값: `25000`. 내부망 HTTPS 사용.

| 용도 | Endpoint |
|------|----------|
| 쿼리 목록 (JSON) | `https://{coord}:25000/queries?json` |
| Cancel | `https://{coord}:25000/cancel_query?query_id={qid}` |

`/queries?json` 응답 최상위 키: `in_flight_queries`, `completed_queries`, `query_locations`

- `in_flight_queries`: 실행 중 + 대기 쿼리 혼합. `waiting: true` 필드로 대기 쿼리 구분
- 주요 쿼리 필드: `query_id`, `stmt`, `state`, `user`, `last_event`, `progress` (문자열, e.g. `"47891 / 54138 (88.461%)"`), `row_fetched`, `waiting`

---

## 8. Query Explorer — cm_client 동작 원리

### 검색 모드 분기

```
조건 있음 (keyword/user/query_type/query_state)
    → _stream_chunked: 시간 구간을 config.explorer.chunk_hours(기본 3분) 단위로 분할
      각 청크마다 전체 클러스터 병렬 요청 → Python 클라이언트 사이드 필터링
      → SSE progress 이벤트 스트리밍

조건 없음
    → _stream_single_shot: 1회 요청, limit=1000
      → SSE done 이벤트 1회
```

### 설계 유의사항

- CM API에 `filter` 파라미터를 전달하지 않음 — 모든 필터링은 Python 클라이언트에서 수행
- `filter_applied` 응답 필드는 적용된 필터 조건의 표시용 문자열 (CM 전달 아님)
- `seen_ids` set으로 청크 간 중복 제거 (`queryId` 없는 행은 dedup 생략)
- `config.explorer.chunk_hours` (기본 3/60 = 3분): 480청크/24h — 조건 없을 때는 single-shot 사용

---

## 9. launcher.py (Windows 배포용)

- **역할**: 사내 Windows PC에서 SSH 2-hop 터널 연결 후 브라우저 자동 오픈
- **터널 경로**: `PC → 터널 서버 → node1(FastAPI 서버)`, localhost:9191 포워딩
- **GUI**: tkinter (다크 테마), 비밀번호 저장 (Fernet, 기기 고유 키)
- **빌드**: `pyinstaller --onefile --noconsole --name ImpalaTool launcher.py`
- **설정 파일**: `launcher_config.yaml` (빌드된 .exe와 같은 디렉터리에 위치)
- **배포 전 수정 필요**: `launcher_config.yaml`의 `tunnel_servers`, `node`, `app` 섹션

---

## 10. 개발 컨벤션

| 항목 | 규칙 |
|------|------|
| 언어 | Python 3 |
| 변수명 | `snake_case` (PEP8) |
| 주석 | 한국어 |
| 타입 힌트 | 필수 |
| 하드코딩 금지 | URL, 포트, 인증정보 — 반드시 `config.yaml` 참조 |
| 에러 처리 | 개별 코디네이터/클러스터 호출 실패 시 해당 항목만 에러 표시, 나머지 정상 렌더링 |
| 에어갭 환경 | 외부 CDN 사용 금지, 모든 JS/CSS 로컬 static 파일 |

---

## 11. 주요 설계 결정

| 항목 | 내용 |
|------|------|
| 프론트엔드 | Jinja2 템플릿 (`base.html` + `{% include %}` 파셜) + 분리된 CSS/JS |
| 데이터 수집 | `/queries?json` JSON API 파싱 (HTML 스크래핑 아님) |
| Cancel | POST `/monitor/cancel/...` → 성공 시 행 제거 + toast (confirm 없음) |
| Rows Available 취소 | Infobar의 일괄 취소 버튼 → `progress=100%, last_event='Rows available', row_fetched=0` 쿼리 대상, confirm 후 `Promise.allSettled` 병렬 취소 |
| 새로고침 | 수동 전용 (자동 폴링 없음) |
| 클러스터 색상 | `config.yaml`의 `color` 필드 → API 응답 → `common.js`의 `_CLUSTER_COLOR` Map (QM·QE 공유, 하드코딩 없음) |
| query_state 필터 | Explorer: 서버(Python)와 클라이언트(JS) 양쪽에서 적용 |

---

## 12. 실행 방법

```bash
pip install -r requirements.txt
python main.py
# 또는
uvicorn main:app --host 0.0.0.0 --port 9191
```

접속: `http://localhost:9191`
