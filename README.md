# OpenClaw Control Plane

OpenClaw now has its own standalone Vercel app. This project is separate from `patrick-tech-media` and is only responsible for:

- worker registry
- job queue and leases
- worker heartbeat
- job results and failures

Your machines connect to this app as workers, so OpenClaw can live on Vercel while still using the resources on your PCs.

## Run locally

```powershell
npm install
copy .env.example .env
npm run dev
```

Open:

```text
http://localhost:3000
```

## Required env

```env
SITE_URL=https://your-openclaw-control-plane.vercel.app
DATABASE_URL=
OPENCLAW_CONTROL_PATH=data/openclaw-control-plane.json
OPENCLAW_CONTROL_TOKEN=replace-with-a-long-random-secret
OPENCLAW_WORKER_HEARTBEAT_SECONDS=120
OPENCLAW_JOB_LEASE_SECONDS=90
```

## API

Base endpoint:

```text
/api/openclaw/control
```

Authorization:

```text
Authorization: Bearer <OPENCLAW_CONTROL_TOKEN>
```

### GET views

- `?view=summary`
- `?view=workers`
- `?view=jobs`

### POST actions

- `register-worker`
- `heartbeat-worker`
- `create-job`
- `claim-job`
- `heartbeat-job`
- `complete-job`
- `fail-job`

## Example: create a shell job

```powershell
curl -X POST https://your-openclaw-control-plane.vercel.app/api/openclaw/control `
  -H "Authorization: Bearer your-secret" `
  -H "Content-Type: application/json" `
  -d "{\"action\":\"create-job\",\"type\":\"shell\",\"capability\":\"shell\",\"command\":\"pwd\",\"payload\":{\"cwd\":\".\"}}"
```

## Deploy on Vercel

1. Push this folder to its own GitHub repo, for example `openclaw-control-plane`
2. Import that repo into Vercel
3. Add the env vars from `.env.example`
4. Deploy

After that, point all worker machines at this app by setting:

```env
OPENCLAW_CONTROL_URL=https://your-openclaw-control-plane.vercel.app
OPENCLAW_CONTROL_TOKEN=replace-with-a-long-random-secret
```
