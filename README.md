# VomeSync server

API, WebSocket, public website and Docker deploy for [sync.vome.io](https://sync.vome.io).

The Home Assistant integration and Supervisor add-on live in **[Vortitron/VomeSync](https://github.com/Vortitron/VomeSync)** — that public repo is the HACS / Add-on Store URL. This repo is the backend those clients talk to.

## Layout

```
webserver/    Node.js API + WebSocket + friendly-domain HA forward proxy
website/      Public switch directory (static)
docker/       Compose stack (Redis, API, website, nginx)
docs/         API, server architecture, operations
jenkins/      CI, E2E, deploy, and auto-deploy Jenkinsfiles (jobs live in the VomeHome Jenkins instance)
tests/e2e/    End-to-end tests against the compose stack
```

## Run locally

```bash
cd webserver
npm ci
cp env.example .env
# edit .env
npm test
```

Production / dev stacks:

```bash
cd docker
cp env.example .env
# edit secrets
./scripts/deploy.sh status
```

On this host the live compose project is `/var/www/VomeSync-server/docker`. Copy `docker/.env` from the previous VomeSync tree before the first deploy from here.

## Forwarding rate limits

Cookie-less friendly-domain traffic (`open` / companion-app mode) is rate-limited in `webserver/src/proxy/uiProxy.js`. A valid `vome_fwd` cookie is never throttled. Frontend assets use a separate larger bucket so a normal HA UI session (including Chrome DevTools source maps) does not 429. See `webserver/src/config/config.js`.

## Docs

- `docs/API.md`
- `docs/ARCHITECTURE_SERVER.md`
- `docs/ARCHITECTURE_WEBSITE.md`
- `docs/SETUP.md`
- `docs/OPERATIONS.md`

## Jenkins (this host)

Jobs sit in the VomeHome Jenkins folder **VomeSync**. Display names:

| UI name | Trigger | Effect |
|---|---|---|
| Server CI | push `main` / `develop` | lint + unit/integration |
| Server E2E | push `main` / `develop` | isolated compose E2E (not live) |
| Server Deploy (manual) | button | DEV / LIVE / all |
| Server Auto-Deploy (DEV) | push `main` / `develop` | unattended DEV compose up |
| Server Auto-Deploy (LIVE) | push `main` | waits for a Jenkins click, then LIVE |

Jenkinsfiles: `jenkins/pipelines/`. Operator map: `konhas.com/jenkins/PIPELINES.md`. GitHub webhook payload URL is `$JENKINS_PUBLIC_URL/github-webhook/` (`application/json`, push events).
