"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./BugFixer.module.css";

// ── Types ─────────────────────────────────────────────────────────────────────
interface GoatConfig {
  merchantId: string;
  agentId: string;
  chainId: string;
  usdcAddress: string;
  usdtAddress: string;
  apiUrl: string;
}

interface AnalysisResult {
  rootCause: string;
  explanation: string;
  fixedCode: string;
  steps?: string[];
}

interface X402Status {
  state: "idle" | "verifying" | "verified" | "failed";
  txHash?: string;
}

interface WalletState {
  status: "disconnected" | "connecting" | "connected" | "wrong-network" | "error";
  address?: string;
  chainId?: number;
  error?: string;
}

interface IdentityState {
  status: "idle" | "checking" | "verified" | "unverified" | "error";
  agentId?: number;
  onChain?: boolean;
  ownershipMatch?: boolean | null;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const GOAT_TESTNET3_CHAIN_ID = 48816;

const GOAT_NETWORK_PARAMS = {
  chainId: "0xBEB0",
  chainName: "GOAT Testnet3",
  nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet3.goat.network"],
  blockExplorerUrls: ["https://explorer.testnet3.goat.network"],
};

const SAMPLE_ERRORS = [
  {
    label: "TypeError",
    code: `TypeError: Cannot read properties of undefined (reading 'map')
    at UserList (UserList.jsx:12)
    at renderWithHooks
    at mountIndeterminateComponent`,
  },
  {
    label: "SyntaxError",
    code: `SyntaxError: Unexpected token '}'
    at wrapSafe (internal/modules/cjs/loader.js:915:16)
    at /app/src/utils/parser.js:45:12`,
  },
  {
    label: "AttributeError",
    code: `AttributeError: 'NoneType' object has no attribute 'split'
    File "process.py", line 23, in parse_input
      tokens = user_input.split(",")`,
  },
  {
    label: "SegFault",
    code: `Segmentation fault (core dumped)
    0x0000000000401234 in process_buffer (buf=0x0, size=1024)
        at buffer.c:47
    47    memcpy(dest, buf, size);`,
  },
];

// ── Main Component ────────────────────────────────────────────────────────────
export default function BugFixer({ goatConfig }: { goatConfig: GoatConfig }) {
  const [errorInput, setErrorInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "streaming" | "done">("idle");
  const [rawBuffer, setRawBuffer] = useState("");
  const [result, setResult] = useState<Partial<AnalysisResult>>({});
  const [x402, setX402] = useState<X402Status>({ state: "idle" });
  const [copied, setCopied] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [wallet, setWallet] = useState<WalletState>({ status: "disconnected" });
  const [identity, setIdentity] = useState<IdentityState>({ status: "idle" });
  const [aiProvider, setAiProvider] = useState<"anthropic" | "groq" | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasMetaMask = () =>
    typeof window !== "undefined" && typeof (window as any).ethereum !== "undefined";

  // Listen for MetaMask account/chain changes
  useEffect(() => {
    if (!hasMetaMask()) return;
    const eth = (window as any).ethereum;
    const onAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWallet({ status: "disconnected" });
        setIdentity({ status: "idle" });
      } else {
        setWallet((prev) => ({ ...prev, address: accounts[0] }));
      }
    };
    const onChainChanged = (chainIdHex: string) => {
      const id = parseInt(chainIdHex, 16);
      setWallet((prev) => ({
        ...prev,
        chainId: id,
        status: id === GOAT_TESTNET3_CHAIN_ID ? "connected" : "wrong-network",
      }));
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  // ── Connect MetaMask ────────────────────────────────────────────────────────
  const connectWallet = async () => {
    if (!hasMetaMask()) {
      setWallet({ status: "error", error: "MetaMask not installed — visit metamask.io" });
      return;
    }
    setWallet({ status: "connecting" });
    try {
      const eth = (window as any).ethereum;
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      if (!accounts.length) throw new Error("No accounts returned");
      const chainIdHex: string = await eth.request({ method: "eth_chainId" });
      const chainId = parseInt(chainIdHex, 16);
      if (chainId !== GOAT_TESTNET3_CHAIN_ID) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: GOAT_NETWORK_PARAMS.chainId }],
          });
        } catch (switchErr: any) {
          if (switchErr.code === 4902) {
            await eth.request({ method: "wallet_addEthereumChain", params: [GOAT_NETWORK_PARAMS] });
          } else {
            throw switchErr;
          }
        }
        const newChainHex: string = await eth.request({ method: "eth_chainId" });
        const newChainId = parseInt(newChainHex, 16);
        setWallet({ status: newChainId === GOAT_TESTNET3_CHAIN_ID ? "connected" : "wrong-network", address: accounts[0], chainId: newChainId });
      } else {
        setWallet({ status: "connected", address: accounts[0], chainId });
      }
    } catch (err: any) {
      setWallet({ status: "error", error: err?.message || "Connection failed" });
    }
  };

  // ── ERC-8004 Identity Verification ─────────────────────────────────────────
  const verifyIdentity = async () => {
    setIdentity({ status: "checking" });
    try {
      const res = await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: goatConfig.agentId, walletAddress: wallet.address }),
      });
      const data = await res.json();
      if (data.verified) {
        setIdentity({ status: "verified", agentId: data.agentId, onChain: data.onChainVerified, ownershipMatch: data.ownershipMatch });
      } else {
        setIdentity({ status: "unverified", error: data.error || "Agent not found in registry" });
      }
    } catch (err) {
      setIdentity({ status: "error", error: String(err) });
    }
  };

  useEffect(() => {
    if (wallet.status === "connected" && identity.status === "idle") {
      verifyIdentity();
    }
  }, [wallet.status]);

  useEffect(() => { setCharCount(errorInput.length); }, [errorInput]);
  useEffect(() => {
    if (phase === "streaming" && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [phase]);

  const parseBuffer = useCallback((buf: string) => {
    try {
      const obj = JSON.parse(buf) as AnalysisResult;
      setResult(obj);
    } catch {
      const rootMatch = buf.match(/"rootCause"\s*:\s*"([^"]+)"/);
      const explMatch = buf.match(/"explanation"\s*:\s*"([\s\S]*?)(?:"|$)/);
      const codeMatch = buf.match(/"fixedCode"\s*:\s*"([\s\S]*?)(?:(?<!\\)"|$)/);
      setResult((prev) => ({
        rootCause: rootMatch ? rootMatch[1] : prev.rootCause,
        explanation: explMatch ? explMatch[1].replace(/\\n/g, "\n") : prev.explanation,
        fixedCode: codeMatch
          ? codeMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "  ").replace(/\\"/g, '"')
          : prev.fixedCode,
      }));
    }
  }, []);

  const analyze = async () => {
    if (!errorInput.trim() || phase !== "idle") return;
    setPhase("analyzing");
    setRawBuffer("");
    setResult({});
    setX402({ state: "verifying" });
    setAiProvider(null);
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errorText: errorInput, walletAddress: wallet.address, identityVerified: identity.status === "verified" }),
        signal: abortRef.current.signal,
      });
      const provider = res.headers.get("X-AI-Provider") as "anthropic" | "groq" | null;
      if (provider) setAiProvider(provider);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Analysis failed");
      }
      setPhase("streaming");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const msg = JSON.parse(data);
            if (msg.type === "x402") setX402({ state: "verified", txHash: msg.txHash });
            else if (msg.type === "delta" && msg.text) { buffer += msg.text; setRawBuffer(buffer); parseBuffer(buffer); }
            else if (msg.type === "error") throw new Error(msg.message);
          } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }
      setPhase("done");
      if (x402.txHash && x402.txHash !== "demo-mode-no-payment-required") {
        fetch("/api/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash: x402.txHash, amount: "0.001" }) }).catch(console.warn);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") { setPhase("idle"); return; }
      setResult({ rootCause: "Request failed", explanation: String(err) });
      setPhase("done");
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setPhase("idle"); setErrorInput(""); setRawBuffer(""); setResult({}); setX402({ state: "idle" }); setCopied(false); setAiProvider(null);
  };
  const copyCode = () => {
    if (result.fixedCode) { navigator.clipboard.writeText(result.fixedCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const isLoading = phase === "analyzing" || phase === "streaming";
  const shortAddr = wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : null;

  return (
    <div className={styles.root}>
      <div className={styles.scanLine} />
      <div className={styles.gridBg} />
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo}>
              <span className={styles.logoBug}>⬡</span>
              <div>
                <h1 className={styles.title}>BUG<span className={styles.titleAccent}>FIXER</span><span className={styles.titleAi}>.AI</span></h1>
                <p className={styles.subtitle}>x402 · GOAT TESTNET3 · CHAIN {goatConfig.chainId}</p>
              </div>
            </div>
          </div>
          <div className={styles.headerRight}>
            {wallet.status === "disconnected" || wallet.status === "error" ? (
              <button className={styles.walletBtn} onClick={connectWallet}>
                <span className={styles.walletIcon}>◈</span> Connect MetaMask
              </button>
            ) : wallet.status === "connecting" ? (
              <button className={styles.walletBtn} disabled>Connecting...</button>
            ) : wallet.status === "wrong-network" ? (
              <button className={`${styles.walletBtn} ${styles.walletBtnWarn}`} onClick={connectWallet}>⚠ Switch to GOAT Testnet3</button>
            ) : (
              <div className={styles.walletConnected}>
                <span className={styles.walletDot} />
                <span className={styles.walletAddress}>{shortAddr}</span>
                {identity.status === "verified" && <span className={styles.identityBadge}>ERC-8004 ✓</span>}
                {identity.status === "checking" && <span className={styles.identityChecking}>verifying...</span>}
              </div>
            )}
            {(wallet.status === "disconnected" || wallet.status === "error") && (
              <><div className={styles.statusDot} /><span className={styles.statusText}>ONLINE</span></>
            )}
          </div>
        </header>

        {wallet.status === "error" && wallet.error && (
          <div className={styles.walletError}>{wallet.error}</div>
        )}

        {/* Badges */}
        <div className={styles.badges}>
          {[
            { label: "AGENT", value: `#${goatConfig.agentId}`, color: "blue" },
            { label: "MERCHANT", value: goatConfig.merchantId, color: "purple" },
            {
              label: "ERC-8004",
              value: identity.status === "verified" ? `VERIFIED${identity.onChain ? " ON-CHAIN" : " (demo)"}` : identity.status === "checking" ? "CHECKING..." : "IDENTITY",
              color: identity.status === "verified" ? "green" : "amber",
            },
            { label: "USDC", value: `${goatConfig.usdcAddress.slice(0, 6)}...${goatConfig.usdcAddress.slice(-4)}`, color: "green" },
          ].map(({ label, value, color }) => (
            <div key={label} className={`${styles.badge} ${styles[`badge_${color}`]}`}>
              <span className={styles.badgeLabel}>{label}</span>
              <span className={styles.badgeValue}>{value}</span>
            </div>
          ))}
        </div>
        <div className={styles.divider} />

        {/* Main Grid */}
        <div className={styles.mainGrid}>
          {/* Input Panel */}
          <div className={styles.inputPanel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelDots}>
                <span style={{ background: "#ef4444" }} />
                <span style={{ background: "#f59e0b" }} />
                <span style={{ background: "#22c55e" }} />
              </span>
              <span className={styles.panelTitle}>ERROR.LOG</span>
              <span className={styles.charCount}>{charCount} chars</span>
            </div>
            <textarea
              className={styles.textarea}
              value={errorInput}
              onChange={(e) => setErrorInput(e.target.value)}
              disabled={isLoading}
              placeholder={"// Paste your error or stack trace here...\n// e.g. TypeError, SyntaxError, SegFault..."}
              spellCheck={false}
            />
            {phase === "idle" && (
              <div className={styles.samples}>
                <span className={styles.samplesLabel}>TRY SAMPLE →</span>
                {SAMPLE_ERRORS.map((s) => (
                  <button key={s.label} className={styles.sampleBtn} onClick={() => setErrorInput(s.code)}>{s.label}</button>
                ))}
              </div>
            )}
            {x402.state !== "idle" && (
              <div className={`${styles.x402Bar} ${styles[`x402_${x402.state}`]}`}>
                <span className={styles.x402Icon}>{x402.state === "verifying" ? "◌" : x402.state === "verified" ? "◉" : "✕"}</span>
                <span className={styles.x402Text}>
                  {x402.state === "verifying" && "Verifying x402 payment on GOAT testnet3..."}
                  {x402.state === "verified" && `x402 verified · tx: ${x402.txHash?.slice(0, 16)}...`}
                  {x402.state === "failed" && "Payment verification failed"}
                </span>
              </div>
            )}
            <div className={styles.ctaRow}>
              <button
                className={`${styles.analyzeBtn} ${!errorInput.trim() || isLoading ? styles.analyzeBtnDisabled : ""}`}
                onClick={analyze}
                disabled={!errorInput.trim() || isLoading}
              >
                {isLoading ? (
                  <span className={styles.loadingInner}>
                    <span className={styles.dot} style={{ animationDelay: "0ms" }} />
                    <span className={styles.dot} style={{ animationDelay: "150ms" }} />
                    <span className={styles.dot} style={{ animationDelay: "300ms" }} />
                    <span>{phase === "analyzing" ? "Analyzing..." : "Generating fix..."}</span>
                  </span>
                ) : phase === "done" ? "✓ FIXED" : "→ ANALYZE & FIX"}
              </button>
              {phase !== "idle" && <button className={styles.resetBtn} onClick={reset}>↺ RESET</button>}
            </div>
          </div>

          {/* Output Panel */}
          <div className={styles.outputPanel} ref={outputRef}>
            {phase === "idle" && !result.rootCause && (
              <div className={styles.outputEmpty}>
                <div className={styles.emptyIcon}>⬡</div>
                <p className={styles.emptyText}>Output appears here</p>
                <p className={styles.emptySubtext}>
                  {wallet.status === "connected"
                    ? identity.status === "verified"
                      ? `Wallet connected · Agent #${goatConfig.agentId} verified`
                      : "Wallet connected · verifying ERC-8004 identity..."
                    : "Connect MetaMask to enable on-chain identity"}
                </p>
              </div>
            )}
            {result.rootCause && (
              <div className={`${styles.resultCard} ${styles.resultCard_purple} fade-up`}>
                <div className={styles.resultCardHeader}><span className={styles.resultCardIcon}>⬡</span><span className={styles.resultCardTitle}>ROOT CAUSE</span></div>
                <p className={styles.resultCardText}>{result.rootCause}</p>
              </div>
            )}
            {result.explanation && (
              <div className={`${styles.resultCard} ${styles.resultCard_blue} fade-up fade-up-delay-1`}>
                <div className={styles.resultCardHeader}><span className={styles.resultCardIcon}>◈</span><span className={styles.resultCardTitle}>DIAGNOSIS</span></div>
                <p className={styles.resultCardText}>{result.explanation}</p>
              </div>
            )}
            {result.fixedCode && (
              <div className={`${styles.codeCard} fade-up fade-up-delay-2`}>
                <div className={styles.codeCardHeader}>
                  <div className={styles.codeCardLeft}><span className={styles.codeCardIcon}>◉</span><span className={styles.codeCardTitle}>FIXED CODE</span></div>
                  <button className={`${styles.copyBtn} ${copied ? styles.copyBtnSuccess : ""}`} onClick={copyCode}>{copied ? "✓ COPIED" : "COPY"}</button>
                </div>
                <pre className={styles.codeBlock}><code>{result.fixedCode}</code></pre>
              </div>
            )}
            {result.steps && result.steps.length > 0 && (
              <div className={`${styles.resultCard} ${styles.resultCard_green} fade-up fade-up-delay-3`}>
                <div className={styles.resultCardHeader}><span className={styles.resultCardIcon}>→</span><span className={styles.resultCardTitle}>APPLY FIX</span></div>
                <ol className={styles.stepsList}>
                  {result.steps.map((step, i) => (
                    <li key={i} className={styles.stepsItem}><span className={styles.stepNum}>{i + 1}</span><span>{step}</span></li>
                  ))}
                </ol>
              </div>
            )}
            {phase === "streaming" && !result.fixedCode && (
              <div className={styles.streamingBar}>
                <span className={styles.dot} style={{ animationDelay: "0ms" }} />
                <span className={styles.dot} style={{ animationDelay: "150ms" }} />
                <span className={styles.dot} style={{ animationDelay: "300ms" }} />
                <span className={styles.streamingText}>{aiProvider === "anthropic" ? "Claude Sonnet" : "Llama 3.3"} is analyzing...</span>
              </div>
            )}
            {phase === "done" && (
              <div className={styles.doneFooter}>
                <span>
                  Analyzed by <span className={styles.doneAccent}>{aiProvider === "anthropic" ? "Claude Sonnet 4" : "Llama 3.3-70b (Groq)"}</span>{" "}
                  · x402 on <span className={styles.doneGreen}>GOAT Testnet3</span>
                  {wallet.status === "connected" && <> · <span className={styles.doneAccent}>{shortAddr}</span></>}
                  {identity.status === "verified" && <> · <span className={styles.doneGreen}>ERC-8004 #{goatConfig.agentId}</span></>}
                </span>
                <button className={styles.againBtn} onClick={reset}>FIX ANOTHER →</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className={styles.footer}>
          <span>GOAT Network · Testnet3 · Chain {goatConfig.chainId} · ERC-8004 Agent #{goatConfig.agentId}</span>
          <span>{goatConfig.apiUrl.replace("https://", "")}</span>
        </footer>
      </div>
    </div>
  );
}