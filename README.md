# BugFixer AI — Next.js + GOAT Network x402

AI-powered bug fixer agent. Paste any error → Claude analyzes it → get root cause, explanation, and fixed code. Payments verified via the x402 protocol on GOAT Network Testnet3.

## Stack

- **Frontend**: Next.js 14 App Router + TypeScript + CSS Modules
- **Backend**: Next.js API Routes (Edge-compatible)
- **AI**: Anthropic Claude Sonnet (streaming)
- **Payments**: GOAT Network x402 Testnet3 (chain 48816)
- **Identity**: ERC-8004 Agent #227

---

## Project Structure

```
bugfixer-nextjs/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analyze/route.ts   ← Claude streaming + x402 verify
│   │   │   ├── settle/route.ts    ← x402 payment settlement
│   │   │   └── health/route.ts    ← Health check
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   └── components/
│       ├── BugFixer.tsx           ← Main UI component
│       └── BugFixer.module.css
├── .env.local                     ← Your secrets (never commit)
├── .gitignore
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## Run Locally in VS Code

### Prerequisites

- Node.js 18+ installed ([nodejs.org](https://nodejs.org))
- VS Code installed
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### Step 1 — Open in VS Code

```bash
# Unzip the project
unzip bugfixer-nextjs.zip
cd bugfixer-nextjs

# Open in VS Code
code .
```

### Step 2 — Install dependencies

Open the integrated terminal (`` Ctrl+` `` on Windows/Linux, ``Cmd+` `` on Mac):

```bash
npm install
```

### Step 3 — Configure your .env.local

The `.env.local` file is already created with your GOAT Network keys.
You only need to add your Anthropic API key:

```bash
# Open .env.local and replace this line:
ANTHROPIC_API_KEY=your_anthropic_api_key_here
# with your actual key from https://console.anthropic.com
```

### Step 4 — Start the dev server

```bash
npm run dev
```

Open **http://localhost:3000** in your browser.

### Step 5 — Test the API

```bash
# Health check
curl http://localhost:3000/api/health

# Test analyze endpoint
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"errorText": "TypeError: Cannot read property map of undefined"}'
```

---

## Deploy on Render.com

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "feat: bugfixer AI agent with GOAT x402"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/bugfixer-nextjs.git
git push -u origin main
```

### Step 2 — Create Render Web Service

1. Go to **[render.com](https://render.com)** → Sign in
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub → Select your repository

### Step 3 — Build Settings

| Field | Value |
|---|---|
| Name | `bugfixer-ai` |
| Environment | `Node` |
| Region | Singapore (closest to Chennai) |
| Branch | `main` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Instance Type | `Free` |

### Step 4 — Environment Variables

In Render dashboard → **Environment** → Add each variable:

```
ANTHROPIC_API_KEY                 = sk-ant-...your key...
GOATX402_API_URL                  = https://x402-api-lx58aabp0r.testnet3.goat.network
GOATX402_MERCHANT_ID              = surya_pandi
GOATX402_API_KEY                  = k6QydJq3a3RHRioin3ufyYPQALfY8QbSiy-B3wJPxsg=
GOATX402_API_SECRET               = ii-sBrBHLdxOeSn5-2To6FK7GDejp5cEuZokbe4Cu1o=
ERC8004_AGENT_ID                  = 227
ERC8004_IDENTITY_REGISTRY         = 0x556089008Fc0a60cD09390Eca93477ca254A5522
CHAIN_ID                          = 48816
RPC_URL                           = https://rpc.testnet3.goat.network
USDC_ADDRESS                      = 0x29d1ee93e9ecf6e50f309f498e40a6b42d352fa1
USDT_ADDRESS                      = 0xdce0af57e8f2ce957b3838cd2a2f3f3677965dd3
NEXT_PUBLIC_GOATX402_API_URL      = https://x402-api-lx58aabp0r.testnet3.goat.network
NEXT_PUBLIC_GOATX402_MERCHANT_ID  = surya_pandi
NEXT_PUBLIC_ERC8004_AGENT_ID      = 227
NEXT_PUBLIC_CHAIN_ID              = 48816
NEXT_PUBLIC_USDC_ADDRESS          = 0x29d1ee93e9ecf6e50f309f498e40a6b42d352fa1
NEXT_PUBLIC_USDT_ADDRESS          = 0xdce0af57e8f2ce957b3838cd2a2f3f3677965dd3
```

### Step 5 — Deploy

Click **"Create Web Service"**. Render will:
1. Pull your code from GitHub
2. Run `npm install && npm run build`
3. Start with `npm start`
4. Give you a URL: `https://bugfixer-ai.onrender.com`

Every `git push` to `main` auto-redeploys.

---

## API Reference

### POST /api/analyze

Analyzes an error and streams back the fix.

**Request:**
```json
{ "errorText": "TypeError: Cannot read properties of undefined" }
```

**Response (SSE stream):**
```
data: {"type":"x402","txHash":"0x...","chainId":"48816"}
data: {"type":"delta","text":"{\"rootCause\":\"..."}
data: {"type":"delta","text":"...streaming..."}
data: [DONE]
```

### POST /api/settle

Settles the x402 micro-payment after successful AI response.

**Request:**
```json
{ "txHash": "0x...", "amount": "0.001" }
```

### GET /api/health

Returns service status and public GOAT Network config.

---

## Environment Variables Reference

| Variable | Side | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Server | Claude API access |
| `GOATX402_API_URL` | Server | GOAT x402 facilitator endpoint |
| `GOATX402_MERCHANT_ID` | Server | Your merchant ID on testnet3 |
| `GOATX402_API_KEY` | Server | API key for request auth |
| `GOATX402_API_SECRET` | Server ⚠️ | Signs payment payloads (NEVER expose) |
| `ERC8004_AGENT_ID` | Server | On-chain agent identity |
| `ERC8004_IDENTITY_REGISTRY` | Server | Registry contract address |
| `CHAIN_ID` | Server | 48816 (GOAT Testnet3) |
| `RPC_URL` | Server | JSON-RPC endpoint |
| `USDC_ADDRESS` | Server | USDC token contract |
| `USDT_ADDRESS` | Server | USDT token contract |
| `NEXT_PUBLIC_*` | Client | Safe-to-expose public values |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ANTHROPIC_API_KEY` not set | Add to `.env.local` and restart `npm run dev` |
| Port 3000 in use | Run `npm run dev -- -p 3001` |
| Render build fails | Check Node version: add `engines: { "node": ">=18" }` to package.json |
| x402 CORS error | Already handled server-side — all GOAT API calls go through `/api/analyze` |
| Blank page after deploy | Check Render logs for missing env vars |
| `Module not found` error | Run `npm install` again |
