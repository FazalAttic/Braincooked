# Brainroad Monorepo 🧠🛣️

> Mindful consumption tracker counting reels and shorts watched on Instagram and YouTube desktop web, paired with an ElysiaJS backend, Drizzle ORM, Next.js web dashboard, and Bun runtime.

---

## 📁 Monorepo Structure

```text
Brainroad/
├── apps/
│   ├── extension/          # Chrome MV3 Extension (Vite + TypeScript + Bun)
│   │   ├── dist/           # Unpacked extension build output (load in chrome://extensions)
│   │   ├── icons/          # Extension PNG icons (16, 32, 48, 128)
│   │   ├── scripts/        # Build & icon generation scripts
│   │   ├── src/            # Extension source code
│   │   │   ├── background/ # Service worker & offline-first sync engine
│   │   │   ├── content/    # Bubble overlay & video detectors (IG + YT)
│   │   │   ├── popup/      # Popup stats dashboard & reset modal
│   │   │   └── shared/     # Extension-internal utilities & storage
│   │   └── tests/          # 274 Vitest unit tests & E2E adversarial test harness
│   │
│   ├── backend/            # ElysiaJS High-Performance API (Bun runtime)
│   │   ├── src/
│   │   │   ├── db/         # PostgreSQL schema & Drizzle ORM setup
│   │   │   └── index.ts    # Batch sync ingestion, stats, auth & pairing endpoints
│   │   └── Dockerfile
│   │
│   └── web/                # Next.js 14 Web Analytics Dashboard (Tailwind CSS)
│       ├── app/            # App router pages (real-time stats & breakdown)
│       └── Dockerfile
│
├── packages/
│   └── shared/             # Shared TypeScript schemas, contracts & constants
│
├── docker-compose.yml      # PostgreSQL 16, Redis 7, Backend & Web services
├── package.json            # Bun workspaces root config & top-level scripts
└── tsconfig.json           # Root TypeScript project references
```

---

## ⚡ Quick Start with Bun

Make sure you have [Bun](https://bun.sh) installed.

### 1. Install Dependencies
```bash
bun install
```

### 2. Build Everything
```bash
bun run build:all
```
Or individually:
```bash
bun run build:ext      # Builds extension into apps/extension/dist
bun run build:backend  # Builds ElysiaJS backend into apps/backend/dist
bun run build:web      # Builds Next.js web app
```

### 3. Run Development Servers
- **Extension watch mode:** `bun run dev:ext` (or `bun run dev`)
- **Backend API server:** `bun run dev:backend` (runs on `http://localhost:4000`)
- **Web Dashboard:** `bun run dev:web` (runs on `http://localhost:3000`)

### 4. Run Unit Tests (274 tests)
```bash
bun run test
```

---

## 🧩 Loading the Extension in Google Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** on (top right switch).
3. Click **Load unpacked**.
4. Select the folder:
   ```text
   Brainroad/apps/extension/dist
   ```
5. Pin the **Brainroad** extension icon. Open Instagram Reels or YouTube Shorts and watch your mindful counter in action!

---

## 🐳 Docker Services (PostgreSQL + Redis + Backend + Web)

To launch the backend, PostgreSQL database, Redis, and Web dashboard in Docker:
```bash
docker compose up -d
```
- **Web Dashboard:** `http://localhost:3000`
- **Backend API & Swagger:** `http://localhost:4000/swagger`
