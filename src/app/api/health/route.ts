// GET /api/health — returns service status and GOAT Network config (no secrets)
export async function GET() {
  const config = {
    status: "ok",
    service: "BugFixer AI Agent",
    goatNetwork: {
      chainId: process.env.CHAIN_ID || "48816",
      network: "testnet3",
      merchantId: process.env.GOATX402_MERCHANT_ID,
      agentId: process.env.ERC8004_AGENT_ID,
      usdcAddress: process.env.USDC_ADDRESS,
      usdtAddress: process.env.USDT_ADDRESS,
      identityRegistry: process.env.ERC8004_IDENTITY_REGISTRY,
    },
    anthropic: {
      configured: !!process.env.ANTHROPIC_API_KEY,
      model: "claude-sonnet-4-20250514",
    },
    timestamp: new Date().toISOString(),
  };

  return Response.json(config);
}
