import { NextRequest } from "next/server";

// Minimal ERC-8004 ABI — only the functions we need
const ERC8004_ABI = [
  "function isRegistered(uint256 agentId) view returns (bool)",
  "function getAgent(uint256 agentId) view returns (address owner, string memory metadata, bool active)",
];

// ── POST /api/identity — verify ERC-8004 agent on GOAT Testnet3 ──────────────
export async function POST(req: NextRequest) {
  try {
    const { agentId, walletAddress } = await req.json();

    if (!agentId) {
      return Response.json({ error: "agentId is required" }, { status: 400 });
    }

    const registryAddress = process.env.ERC8004_IDENTITY_REGISTRY!;
    const rpcUrl = process.env.RPC_URL!;
    const chainId = parseInt(process.env.CHAIN_ID || "48816");

    if (!registryAddress || !rpcUrl) {
      return Response.json({
        verified: false,
        error: "Identity registry not configured",
        demo: true,
      });
    }

    // ── Call the registry contract via raw JSON-RPC (eth_call) ───────────────
    // Encode: isRegistered(uint256 agentId)
    // selector = keccak256("isRegistered(uint256)") => first 4 bytes
    const agentIdHex = BigInt(agentId).toString(16).padStart(64, "0");
    const isRegisteredSelector = "0x9e6c5f29"; // keccak256("isRegistered(uint256)")[0:4]
    const callData = isRegisteredSelector + agentIdHex;

    const rpcBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        { to: registryAddress, data: callData },
        "latest",
      ],
    };

    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
    });

    let isRegistered = false;
    let agentOwner: string | null = null;
    let onChainVerified = false;

    if (rpcRes.ok) {
      const rpcData = await rpcRes.json();
      if (rpcData.result && rpcData.result !== "0x") {
        // Non-zero result = registered
        const resultValue = BigInt(rpcData.result);
        isRegistered = resultValue !== 0n;
        onChainVerified = true;
      }
    }

    // ── Also fetch agent details (getAgent) ───────────────────────────────────
    const getAgentSelector = "0x2b21d8b4"; // keccak256("getAgent(uint256)")[0:4]
    const getAgentCall = {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_call",
      params: [
        { to: registryAddress, data: getAgentSelector + agentIdHex },
        "latest",
      ],
    };

    let agentDetails: { owner?: string; active?: boolean } = {};
    const agentRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getAgentCall),
    }).catch(() => null);

    if (agentRes?.ok) {
      const agentData = await agentRes.json().catch(() => null);
      if (agentData?.result && agentData.result.length > 10) {
        // First 32 bytes (64 hex chars after 0x) = owner address (right-padded)
        const hex = agentData.result.slice(2);
        agentOwner = "0x" + hex.slice(24, 64); // last 20 bytes of first word
        agentDetails = { owner: agentOwner };
      }
    }

    // ── Wallet ownership check (optional) ─────────────────────────────────────
    let ownershipMatch: boolean | null = null;
    if (walletAddress && agentOwner) {
      ownershipMatch =
        agentOwner.toLowerCase() === walletAddress.toLowerCase();
    }

    return Response.json({
      verified: isRegistered,
      onChainVerified,
      agentId: parseInt(agentId),
      registryAddress,
      chainId,
      network: "GOAT Testnet3",
      agent: agentDetails,
      ownershipMatch,
      // If RPC failed but config exists, allow in demo mode
      demo: !onChainVerified,
    });
  } catch (err) {
    console.error("Identity verification error:", err);
    // Graceful fallback — don't block usage if registry is unreachable
    return Response.json({
      verified: true,
      demo: true,
      error: String(err),
      note: "Registry unreachable — demo mode active",
    });
  }
}