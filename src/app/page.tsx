import BugFixer from "@/components/BugFixer";

export default function Home() {
  const goatConfig = {
    merchantId: process.env.NEXT_PUBLIC_GOATX402_MERCHANT_ID || "surya_pandi",
    agentId: process.env.NEXT_PUBLIC_ERC8004_AGENT_ID || "227",
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID || "48816",
    usdcAddress: process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x29d1ee93e9ecf6e50f309f498e40a6b42d352fa1",
    usdtAddress: process.env.NEXT_PUBLIC_USDT_ADDRESS || "0xdce0af57e8f2ce957b3838cd2a2f3f3677965dd3",
    apiUrl: process.env.NEXT_PUBLIC_GOATX402_API_URL || "https://x402-api-lx58aabp0r.testnet3.goat.network",
  };

  return <BugFixer goatConfig={goatConfig} />;
}
