# Docker 部署

本目录包含 Web 版的两种 Compose 部署方式：

- **本地构建**：从当前源码构建镜像；
- **远程拉取**：直接从 Docker Hub 拉取已发布镜像。

两种方式使用同一个容器名和同一个端口，**不要同时启动**。只能选其中一种运行。

- 本地构建版：数据在 Docker 命名卷 `infection-workbench-data`；
- 远程拉取版：数据在 `docker/data/` 宿主目录。

远程版容器入口会先以 root 修正 `/app/data` 的所有者，然后切换到非 root 的 `node` 用户运行应用。因此宿主机目录由 Docker/NAS 创建为 root 时，也能正常写入；如果目录位于不支持 `chown` 的 SMB/NFS 挂载上，容器会给出明确的权限错误。

> 该入口脚本包含在重新构建后的镜像中。Docker Hub 上旧的 `latest` 若尚未重建，仍需手动修正目录权限，或使用本地构建版镜像。

## 文件

```text
docker/
├── Dockerfile
├── Dockerfile.dockerignore
├── docker-compose.yaml       # 本地构建
├── docker-compose.hub.yaml   # 远程拉取
├── data/                     # 远程版运行数据（自动创建）
└── README.md
```

Compose 文件使用 `.yaml` 扩展名。

| 文件                      | 镜像来源               | 适用场景                 |
| ------------------------- | ---------------------- | ------------------------ |
| `docker-compose.yaml`     | 本地 `Dockerfile` 构建 | 修改源码、需要自定义构建 |
| `docker-compose.hub.yaml` | Docker Hub             | 直接部署、无需本地构建   |

远程镜像：

```text
ostar999/ostar-nosocomial-infection-workbench-webui:latest
```

Docker Hub：

https://hub.docker.com/r/ostar999/ostar-nosocomial-infection-workbench-webui

## 方式一：本地构建

在应用根目录执行：

```bash
docker compose -f docker/docker-compose.yaml up -d --build
```

该方式会：

1. 使用 `docker/Dockerfile` 构建镜像；
2. 将镜像标记为 `ostar-nosocomial-infection-workbench-webui:1.8.6`；
3. 启动容器并挂载数据卷。

适用：

- 修改过源码；
- 修改过 Dockerfile；
- 不想依赖 Docker Hub 上的镜像版本。

## 方式二：远程拉取

在应用根目录执行：

```bash
docker compose -f docker/docker-compose.hub.yaml up -d
```

如果之前用 `docker run` 创建过同名容器，先删除：

```bash
docker rm -f ostar-nosocomial-infection-workbench-webui
```

否则会提示容器名已被占用。

该方式会：

1. 从 Docker Hub 拉取：
   ```text
   ostar999/ostar-nosocomial-infection-workbench-webui:latest
   ```
2. 启动容器并把 `docker/data/` 挂载到 `/app/data`；
3. 不执行本地构建。

`docker-compose.hub.yaml` 中配置了：

```yaml
pull_policy: always
```

因此每次 `up` 都会检查远程镜像是否更新。

远程版 YAML 只保留运行必需的配置：

```yaml
name: ostar-nosocomial-infection-workbench-webui

services:
  infection-workbench:
    image: ostar999/ostar-nosocomial-infection-workbench-webui:latest
    pull_policy: always
    container_name: ostar-nosocomial-infection-workbench-webui
    restart: unless-stopped
    ports:
      - "8787:8787"
    volumes:
      - ./data:/app/data
```

以下配置来自镜像 Dockerfile，不再在 YAML 中重复：

```text
HOST=0.0.0.0
PORT=8787
IW_NO_OPEN=1
TZ=Asia/Shanghai
HEALTHCHECK
```

如果以后换成其他镜像，需要自行补回这些配置。

也可以先手动拉取：

```bash
docker compose -f docker/docker-compose.hub.yaml pull
docker compose -f docker/docker-compose.hub.yaml up -d
```

## 两种方式如何选择

| 需求                          | 建议     |
| ----------------------------- | -------- |
| 只是部署使用                  | 远程拉取 |
| 修改了代码并需要生效          | 本地构建 |
| 没有网络或无法访问 Docker Hub | 本地构建 |
| 想固定使用已发布版本          | 远程拉取 |
| 需要自己改 Dockerfile         | 本地构建 |

## 切换方式

从远程版切换到本地构建版：

```bash
docker compose -f docker/docker-compose.hub.yaml down
docker compose -f docker/docker-compose.yaml up -d --build
```

从本地构建版切换到远程版：

```bash
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose.hub.yaml up -d
```

两份配置使用相同的：

```text
项目名：ostar-nosocomial-infection-workbench-webui
容器名：ostar-nosocomial-infection-workbench-webui
端口：8787
```

但数据位置不同：

```text
本地构建版：命名卷 infection-workbench-data
远程版：docker/data/
```

切换不会自动迁移数据。需要保留数据时，先从命名卷复制到远程目录：

```bash
mkdir -p docker/data

docker run --rm \
  -v infection-workbench-data:/from \
  -v "$PWD/docker/data:/to" \
  alpine \
  sh -c 'cp -a /from/. /to/'

sudo chown -R 1000:1000 docker/data
```

## 访问

启动后打开：

```text
http://127.0.0.1:8787
```

查看状态和日志，按实际使用的文件选择：

```bash
docker compose -f docker/docker-compose.yaml ps
docker compose -f docker/docker-compose.hub.yaml ps
```

```bash
docker compose -f docker/docker-compose.yaml logs -f
docker compose -f docker/docker-compose.hub.yaml logs -f
```

停止：

```bash
docker compose -f docker/docker-compose.yaml down
```

或：

```bash
docker compose -f docker/docker-compose.hub.yaml down
```

本地构建版不要加 `-v`，否则会删除命名卷；远程版的数据在 `docker/data/`，不受 `down -v` 影响。

## 数据持久化

本地构建版使用命名卷：

```text
infection-workbench-data
```

远程版使用 Compose 文件同级目录：

```text
docker/data/
```

两者都挂载到容器内的：

```text
/app/data
```

包含：

- `settings.json`：供应商、模型和 API Key；
- `state.json`：任务索引；
- `tasks/`：病例、材料和报告；
- `assistant/`：院感助手会话。

升级时保留数据：

本地构建：

```bash
git pull
docker compose -f docker/docker-compose.yaml up -d --build
```

远程拉取：

```bash
docker compose -f docker/docker-compose.hub.yaml pull
docker compose -f docker/docker-compose.hub.yaml up -d
```

## 环境变量

本地构建版支持：

| 变量      | 默认值          | 说明       |
| --------- | --------------- | ---------- |
| `IW_PORT` | `8787`          | 宿主机端口 |
| `TZ`      | `Asia/Shanghai` | 容器时区   |

远程简洁版固定使用：

```text
宿主机端口：8787
容器端口：8787
```

容器内默认值来自镜像：

```text
HOST=0.0.0.0
PORT=8787
IW_NO_OPEN=1
TZ=Asia/Shanghai
```

Docker 中不会尝试打开浏览器。

本地构建版指定宿主机端口：

```bash
IW_PORT=9000 docker compose -f docker/docker-compose.yaml up -d --build
```

远程简洁版如需换端口，直接修改 `docker-compose.hub.yaml`：

```yaml
ports:
  - "9000:8787"
```

然后访问 `http://127.0.0.1:9000/`。

## 单独使用 Docker

本地构建：

```bash
docker build -f docker/Dockerfile -t ostar-nosocomial-infection-workbench-webui:1.8.6 .
```

运行本地构建镜像：

```bash
docker run -d \
  --name ostar-nosocomial-infection-workbench-webui \
  --restart unless-stopped \
  -p 8787:8787 \
  -e IW_NO_OPEN=1 \
  -v infection-workbench-data:/app/data \
  ostar-nosocomial-infection-workbench-webui:1.8.6
```

直接运行远程镜像：

```bash
docker run -d \
  --name ostar-nosocomial-infection-workbench-webui \
  --restart unless-stopped \
  -p 8787:8787 \
  -e IW_NO_OPEN=1 \
  -v "$PWD/docker/data:/app/data" \
  ostar999/ostar-nosocomial-infection-workbench-webui:latest
```

## 使用宿主机数据目录

远程版已经固定使用 Compose 文件同级目录：

```text
docker/data/ → /app/data
```

本地构建版默认使用命名卷。如果也希望改成宿主机目录，可以选择：

### 使用 `docker/data/`

```yaml
volumes:
  - ./data:/app/data
```

### 使用应用根目录的 `data/`

```yaml
volumes:
  - ../data:/app/data
```

注意：

- `./data` 相对于 `docker/docker-compose.yaml`，实际是 `docker/data/`；
- `../data` 相对于 `docker/docker-compose.yaml`，实际是应用根目录的 `data/`；
- 宿主机目录必须允许容器内的 `node` 用户（UID 1000）读写；
- macOS 的 Docker Desktop 通常会处理绑定挂载权限；
- Linux 上如遇权限错误，可先：

```bash
sudo chown -R 1000:1000 docker/data
```

## 备份

远程版直接备份宿主目录：

```bash
tar -czf infection-workbench-data.tar.gz -C docker/data .
```

本地构建版导出命名卷：

```bash
docker run --rm \
  -v infection-workbench-data:/data \
  -v "$PWD:/backup" \
  alpine \
  tar -czf /backup/infection-workbench-data.tar.gz -C /data .
```

恢复前先停止容器，并确认目标目录或数据卷正确。

## 无法访问排查

### 1. 检查端口映射

```bash
docker ps
```

正常应看到：

```text
0.0.0.0:8787->8787/tcp, [::]:8787->8787/tcp
```

如果只显示：

```text
8787/tcp
```

说明容器只暴露了内部端口，没有映射到宿主机，通常是 `docker run` 时遗漏了 `-p 8787:8787`。

容器启动后不能再补端口映射，需要删除并重新创建。

### 2. 检查宿主机端口是否被占用

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

如果有其他进程占用，改用其他端口。

本地构建版：

```bash
IW_PORT=8788 docker compose -f docker/docker-compose.yaml up -d --build
```

远程简洁版修改 `docker-compose.hub.yaml`：

```yaml
ports:
  - "8788:8787"
```

然后重新启动并访问 `http://127.0.0.1:8788/`。

### 3. 检查容器状态和日志

```bash
docker compose -f docker/docker-compose.yaml ps
docker compose -f docker/docker-compose.hub.yaml ps
```

```bash
docker compose -f docker/docker-compose.yaml logs --tail=100
docker compose -f docker/docker-compose.hub.yaml logs --tail=100
```

容器状态应为：

```text
Up ... (healthy)
```

如果状态是 `Restarting` 或 `Exited`，优先查看日志中的启动错误。

### 4. 在宿主机测试

```bash
curl -i http://127.0.0.1:8787/
```

返回 `HTTP/1.1 200 OK` 说明映射和容器都正常。

## 安全说明

- 容器监听 `0.0.0.0`，不要直接把 `8787` 暴露到公网；
- 应用没有内置登录和多用户隔离；
- 公网访问应放在反向代理、认证和 HTTPS 之后；
- `data/` 含 API Key 和病例隐私，请勿提交到 Git 或公开分享。
