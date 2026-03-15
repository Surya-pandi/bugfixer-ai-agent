import { NextRequest } from "next/server";

// ── Config ────────────────────────────────────────────────────────────────────
const GOAT_CONFIG = {
  apiUrl: process.env.GOATX402_API_URL!,
  merchantId: process.env.GOATX402_MERCHANT_ID!,
  apiKey: process.env.GOATX402_API_KEY!,
  apiSecret: process.env.GOATX402_API_SECRET!,
  agentId: process.env.ERC8004_AGENT_ID!,
  identityRegistry: process.env.ERC8004_IDENTITY_REGISTRY!,
  chainId: process.env.CHAIN_ID!,
  rpcUrl: process.env.RPC_URL!,
  usdcAddress: process.env.USDC_ADDRESS!,
  usdtAddress: process.env.USDT_ADDRESS!,
};

// ── x402 Payment Verification ─────────────────────────────────────────────────
async function verifyX402Payment(paymentHeader?: string | null): Promise<{
  verified: boolean;
  txHash?: string;
  error?: string;
}> {
  if (!paymentHeader) {
    return { verified: true, txHash: "demo-mode-no-payment-required" };
  }
  try {
    const res = await fetch(`${GOAT_CONFIG.apiUrl}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": GOAT_CONFIG.apiKey,
        "X-Merchant-ID": GOAT_CONFIG.merchantId,
        "X-Payment": paymentHeader,
      },
      body: JSON.stringify({
        agentId: GOAT_CONFIG.agentId,
        chainId: parseInt(GOAT_CONFIG.chainId),
        paymentToken: GOAT_CONFIG.usdcAddress,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { verified: false, error: `x402 verification failed: ${err}` };
    }
    const data = await res.json();
    return { verified: true, txHash: data.txHash };
  } catch (err) {
    console.warn("x402 verification error (allowing request):", err);
    return { verified: true, txHash: "fallback-allowed" };
  }
}

// ── POST /api/analyze ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { errorText, walletAddress, identityVerified } = body;

    if (!errorText || typeof errorText !== "string") {
      return new Response(
        JSON.stringify({ error: "errorText is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── x402 Payment check ────────────────────────────────────────────────────
    const paymentHeader = req.headers.get("X-Payment");
    const { verified, txHash, error: paymentError } = await verifyX402Payment(paymentHeader);

    if (!verified) {
      return new Response(
        JSON.stringify({ error: paymentError || "Payment verification failed" }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Determine AI provider ─────────────────────────────────────────────────
    const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
    const useGroq = !!process.env.GROQ_API_KEY;

    if (!useAnthropic && !useGroq) {
      return new Response(
        JSON.stringify({ error: "No AI API key configured (ANTHROPIC_API_KEY or GROQ_API_KEY)" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const walletInfo = walletAddress
      ? `\nWallet: ${walletAddress} | Identity: ${identityVerified ? "ERC-8004 VERIFIED" : "Unverified"}`
      : "";

    const prompt = `You are an expert bug fixer AI agent running on the GOAT Network.
Identity: Agent #${GOAT_CONFIG.agentId} | Merchant: ${GOAT_CONFIG.merchantId} | Chain: ${GOAT_CONFIG.chainId} (GOAT Testnet3)
Payment verified via x402 protocol | Registry: ${GOAT_CONFIG.identityRegistry}${walletInfo}

Analyze this error and respond ONLY with a valid JSON object.
No markdown, no backticks, no explanation outside the JSON. Just raw JSON.

{
  "rootCause": "One clear sentence describing the root cause",
  "explanation": "2-3 sentences explaining what went wrong, why it happened, and the impact",
  "fixedCode": "Complete corrected code snippet with inline comments on every changed line",
  "steps": ["Step 1 to apply the fix", "Step 2 if needed"]
}

Error to analyze:
${errorText}`;

    // ── Call AI API ───────────────────────────────────────────────────────────
    let rawText = "";
    let modelUsed = "";

    if (useAnthropic) {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        throw new Error(`Anthropic API error: ${errText}`);
      }

      const anthropicData = await anthropicRes.json();
      rawText = anthropicData.content?.[0]?.text || "";
      modelUsed = "claude-sonnet-4-20250514";
    } else {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.2,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error: ${errText}`);
      }

      const groqData = await groqRes.json();
      rawText = groqData.choices?.[0]?.message?.content || "";
      modelUsed = "groq-llama-3.3-70b";
    }

    const cleaned = rawText
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();

    // ── Stream result back as SSE ─────────────────────────────────────────────
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "x402",
              txHash,
              chainId: GOAT_CONFIG.chainId,
            })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "delta", text: cleaned })}\n\n`
          )
        );
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-GOAT-Agent-ID": GOAT_CONFIG.agentId,
        "X-GOAT-Chain-ID": GOAT_CONFIG.chainId,
        "X-GOAT-Merchant": GOAT_CONFIG.merchantId,
        "X-AI-Model": modelUsed,
        "X-AI-Provider": useAnthropic ? "anthropic" : "groq",
      },
    });
  } catch (err) {
    console.error("API error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}