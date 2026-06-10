# Impala Tool

사내 전용 Impala 통합 쿼리 모니터링 웹 UI

| 탭 | 기능 |
|----|------|
| **Query Monitoring** | 코디네이터별 실시간 쿼리 조회 / Cancel / 상세(Plan·Profile) |
| **Query Explorer** | CM API 기반 시간 범위 쿼리 이력 검색 (사용자·키워드·상태 필터) |

---

## 요구 사항

- Python 3.9+
- 내부망 접근 가능 환경
- `/etc/pki/tls/certs/ca-bundle.crt` (TLS 인증서)

---

## 설치

```bash
git clone https://github.com/Joonhong-Park/impala_tool.git
cd impala_tool
pip install -r requirements.txt
```

---

## 설정

`config.yaml`을 실제 환경에 맞게 수정합니다.

```yaml
app:
  port: 9191
  ca_bundle: /etc/pki/tls/certs/ca-bundle.crt

cm:
  username: admin
  password: changeme
  cluster_name: CDP-Base        # CM 서비스 이름
  request_timeout: 120

clusters:
  - id: cluster1
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
```

---

## 실행

### 직접 실행

```bash
python main.py
```

또는

```bash
uvicorn main:app --host 0.0.0.0 --port 9191
```

접속: `http://서버IP:9191`

---

## systemd 서비스 등록 (Linux)

서버 부팅 시 자동 시작이 필요한 경우 systemd 서비스로 등록합니다.

### 1. 서비스 파일 생성

```bash
sudo vi /etc/systemd/system/impala-tool.service
```

```ini
[Unit]
Description=Impala Tool Web UI
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/impala_tool
ExecStart=/usr/bin/python3 /opt/impala_tool/main.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> `WorkingDirectory`와 `ExecStart` 경로는 실제 설치 경로로 변경하세요.  
> Python 경로는 `which python3`으로 확인합니다.

### 2. 서비스 등록 및 시작

```bash
# 서비스 파일 인식
sudo systemctl daemon-reload

# 부팅 시 자동 시작 등록
sudo systemctl enable impala-tool

# 즉시 시작
sudo systemctl start impala-tool

# 상태 확인
sudo systemctl status impala-tool
```

### 3. 로그 확인

```bash
# 실시간 로그
journalctl -u impala-tool -f

# 최근 100줄
journalctl -u impala-tool -n 100
```

### 4. 서비스 관리

```bash
sudo systemctl stop impala-tool      # 중지
sudo systemctl restart impala-tool   # 재시작
sudo systemctl disable impala-tool   # 자동 시작 해제
```

---

## Windows 클라이언트 (SSH 터널 런처)

에어갭 환경에서 Windows PC로 접속하는 경우 `launcher.py`를 PyInstaller로 빌드해 배포합니다.

### 빌드

```bash
pip install paramiko pyinstaller cryptography
pyinstaller --onefile --noconsole --name ImpalaTool launcher.py
# → dist/ImpalaTool.exe 생성
```

배포 전 `launcher.py` 상단의 아래 값을 실제 환경으로 수정해야 합니다.

```python
TUNNEL_SERVERS = [
    {"label": "터널 서버 1", "host": "실제호스트", "port": 22, "user": "계정"},
]
NODE_HOST  = "impala-tool-서버호스트"
NODE_USER  = "계정"
LOCAL_PORT = 9191
REMOTE_PORT = 9191
```
