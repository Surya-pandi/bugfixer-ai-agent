"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./BugFixer.module.css";

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

const SAMPLE_ERRORS = [
  {
    label: "TypeError",
    code: `TypeError: Cannot read properties of undefined (reading 'map')
    at UserList (UserList.jsx:12)
    at renderWithHooks
    at mountIndeterminateComponent
    at renderRoot
    at performSyncWorkOnRoot`,
  },
  {
    label: "SyntaxError",
    code: `SyntaxError: Unexpected token '}'
    at wrapSafe (internal/modules/cjs/loader.js:915:16)
    at /app/src/utils/parser.js:45:12
    
    43 | const parseConfig = (raw) => {
    44 |   return JSON.parse(raw)
  > 45 | }
    46 | }`,
  },
  {
    label: "AttributeError",
    code: `AttributeError: 'NoneType' object has no attribute 'split'
    File "process.py", line 23, in parse_input
      tokens = user_input.split(",")
    File "process.py", line 41, in main
      result = parse_input(get_input())`,
  },
  {
    label: "SegFault",
    code: `Segmentation fault (core dumped)
    Program received signal SIGSEGV, Segmentation fault.
    0x0000000000401234 in process_buffer (buf=0x0, size=1024)
        at buffer.c:47
    47    memcpy(dest, buf, size);`,
  },
];

export default function BugFixer({ goatConfig }: { goatConfig: GoatConfig }) {
  const [errorInput, setErrorInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "streaming" | "done">("idle");
  const [rawBuffer, setRawBuffer] = useState("");
  const [result, setResult] = useState<Partial<AnalysisResult>>({});
  const [x402, setX402] = useState<X402Status>({ state: "idle" });
  const [copied, setCopied] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCharCount(errorInput.length);
  }, [errorInput]);

  useEffect(() => {
    if (phase === "streaming" && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [phase]);

  // Parse partial JSON from streaming buffer
  const parseBuffer = useCallback((buf: string) => {
    try {
      const obj = JSON.parse(buf) as AnalysisResult;
      setResult(obj);
    } catch {
      // Partial JSON — extract fields progressively
      const rootMatch = buf.match(/"rootCause"\s*:\s*"([^"]+)"/);
      const explMatch = buf.match(/"explanation"\s*:\s*"([\s\S]*?)(?:"|$)/);
      const codeMatch = buf.match(/"fixedCode"\s*:\s*"([\s\S]*?)(?:(?<!\\)"|$)/);

      setResult((prev) => ({
        rootCause: rootMatch ? rootMatch[1] : prev.rootCause,
        explanation: explMatch ? explMatch[1].replace(/\\n/g, "\n") : prev.explanation,
        fixedCode: codeMatch
          ? codeMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "  ").replace(/\\\"/g, '"')
          : prev.fixedCode,
      }));
    }
  }, []);

  const analyze = async () => {
    if (!errorInput.trim() || phase !== "idle") return;

    // Reset state
    setPhase("analyzing");
    setRawBuffer("");
    setResult({});
    setX402({ state: "verifying" });

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errorText: errorInput }),
        signal: abortRef.current.signal,
      });

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
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const msg = JSON.parse(data);

            if (msg.type === "x402") {
              setX402({ state: "verified", txHash: msg.txHash });
            } else if (msg.type === "delta" && msg.text) {
              buffer += msg.text;
              setRawBuffer(buffer);
              parseBuffer(buffer);
            } else if (msg.type === "error") {
              throw new Error(msg.message);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      setPhase("done");

      // Settle payment after successful response
      if (x402.txHash && x402.txHash !== "demo-mode-no-payment-required") {
        fetch("/api/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: x402.txHash, amount: "0.001" }),
        }).catch(console.warn);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setResult({ rootCause: "Request failed", explanation: String(err) });
      setPhase("done");
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setErrorInput("");
    setRawBuffer("");
    setResult({});
    setX402({ state: "idle" });
    setCopied(false);
  };

  const copyCode = () => {
    if (result.fixedCode) {
      navigator.clipboard.writeText(result.fixedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isLoading = phase === "analyzing" || phase === "streaming";

  return (
    <div className={styles.root}>
      {/* Scan line effect */}
      <div className={styles.scanLine} />

      {/* Grid background */}
      <div className={styles.gridBg} />

      <div className={styles.container}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.logo}>
              <span className={styles.logoBug}>⬡</span>
              <div>
                <h1 className={styles.title}>
                  BUG<span className={styles.titleAccent}>FIXER</span>
                  <span className={styles.titleAi}>.AI</span>
                </h1>
                <p className={styles.subtitle}>
                  x402 · GOAT TESTNET3 · CHAIN {goatConfig.chainId}
                </p>
              </div>
            </div>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.statusDot} />
            <span className={styles.statusText}>ONLINE</span>
          </div>
        </header>

        {/* ── Identity Badges ─────────────────────────────────────── */}
        <div className={styles.badges}>
          {[
            { label: "AGENT", value: `#${goatConfig.agentId}`, color: "blue" },
            { label: "MERCHANT", value: goatConfig.merchantId, color: "purple" },
            { label: "ERC-8004", value: "IDENTITY", color: "amber" },
            {
              label: "USDC",
              value: `${goatConfig.usdcAddress.slice(0, 6)}...${goatConfig.usdcAddress.slice(-4)}`,
              color: "green",
            },
          ].map(({ label, value, color }) => (
            <div key={label} className={`${styles.badge} ${styles[`badge_${color}`]}`}>
              <span className={styles.badgeLabel}>{label}</span>
              <span className={styles.badgeValue}>{value}</span>
            </div>
          ))}
        </div>

        <div className={styles.divider} />

        {/* ── Main Grid ───────────────────────────────────────────── */}
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

            {/* Sample buttons */}
            {phase === "idle" && (
              <div className={styles.samples}>
                <span className={styles.samplesLabel}>TRY SAMPLE →</span>
                {SAMPLE_ERRORS.map((s) => (
                  <button
                    key={s.label}
                    className={styles.sampleBtn}
                    onClick={() => setErrorInput(s.code)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* x402 status */}
            {x402.state !== "idle" && (
              <div className={`${styles.x402Bar} ${styles[`x402_${x402.state}`]}`}>
                <span className={styles.x402Icon}>
                  {x402.state === "verifying" ? "◌" : x402.state === "verified" ? "◉" : "✕"}
                </span>
                <span className={styles.x402Text}>
                  {x402.state === "verifying" && "Verifying x402 payment on GOAT testnet3..."}
                  {x402.state === "verified" &&
                    `x402 verified · tx: ${x402.txHash?.slice(0, 16)}...`}
                  {x402.state === "failed" && "Payment verification failed"}
                </span>
              </div>
            )}

            {/* CTA */}
            <div className={styles.ctaRow}>
              <button
                className={`${styles.analyzeBtn} ${
                  !errorInput.trim() || isLoading ? styles.analyzeBtnDisabled : ""
                }`}
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
                ) : phase === "done" ? (
                  "✓ FIXED"
                ) : (
                  "→ ANALYZE & FIX"
                )}
              </button>

              {phase !== "idle" && (
                <button className={styles.resetBtn} onClick={reset}>
                  ↺ RESET
                </button>
              )}
            </div>
          </div>

          {/* Output Panel */}
          <div className={styles.outputPanel} ref={outputRef}>
            {phase === "idle" && !result.rootCause && (
              <div className={styles.outputEmpty}>
                <div className={styles.emptyIcon}>⬡</div>
                <p className={styles.emptyText}>Output appears here</p>
                <p className={styles.emptySubtext}>
                  Paste an error and click Analyze
                </p>
              </div>
            )}

            {/* Root Cause */}
            {result.rootCause && (
              <div className={`${styles.resultCard} ${styles.resultCard_purple} fade-up`}>
                <div className={styles.resultCardHeader}>
                  <span className={styles.resultCardIcon}>⬡</span>
                  <span className={styles.resultCardTitle}>ROOT CAUSE</span>
                </div>
                <p className={styles.resultCardText}>{result.rootCause}</p>
              </div>
            )}

            {/* Explanation */}
            {result.explanation && (
              <div className={`${styles.resultCard} ${styles.resultCard_blue} fade-up fade-up-delay-1`}>
                <div className={styles.resultCardHeader}>
                  <span className={styles.resultCardIcon}>◈</span>
                  <span className={styles.resultCardTitle}>DIAGNOSIS</span>
                </div>
                <p className={styles.resultCardText}>{result.explanation}</p>
              </div>
            )}

            {/* Fixed Code */}
            {result.fixedCode && (
              <div className={`${styles.codeCard} fade-up fade-up-delay-2`}>
                <div className={styles.codeCardHeader}>
                  <div className={styles.codeCardLeft}>
                    <span className={styles.codeCardIcon}>◉</span>
                    <span className={styles.codeCardTitle}>FIXED CODE</span>
                  </div>
                  <button
                    className={`${styles.copyBtn} ${copied ? styles.copyBtnSuccess : ""}`}
                    onClick={copyCode}
                  >
                    {copied ? "✓ COPIED" : "COPY"}
                  </button>
                </div>
                <pre className={styles.codeBlock}>
                  <code>{result.fixedCode}</code>
                </pre>
              </div>
            )}

            {/* Steps */}
            {result.steps && result.steps.length > 0 && (
              <div className={`${styles.resultCard} ${styles.resultCard_green} fade-up fade-up-delay-3`}>
                <div className={styles.resultCardHeader}>
                  <span className={styles.resultCardIcon}>→</span>
                  <span className={styles.resultCardTitle}>APPLY FIX</span>
                </div>
                <ol className={styles.stepsList}>
                  {result.steps.map((step, i) => (
                    <li key={i} className={styles.stepsItem}>
                      <span className={styles.stepNum}>{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Streaming indicator */}
            {phase === "streaming" && !result.fixedCode && (
              <div className={styles.streamingBar}>
                <span className={styles.dot} style={{ animationDelay: "0ms" }} />
                <span className={styles.dot} style={{ animationDelay: "150ms" }} />
                <span className={styles.dot} style={{ animationDelay: "300ms" }} />
                <span className={styles.streamingText}>Claude is analyzing...</span>
              </div>
            )}

            {/* Done footer */}
            {phase === "done" && (
              <div className={styles.doneFooter}>
                <span>
                  Analyzed by{" "}
                  <span className={styles.doneAccent}>Claude Sonnet</span> · x402 on{" "}
                  <span className={styles.doneGreen}>GOAT Testnet3</span>
                </span>
                <button className={styles.againBtn} onClick={reset}>
                  FIX ANOTHER →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <footer className={styles.footer}>
          <span>
            GOAT Network · Testnet3 · Chain {goatConfig.chainId} · ERC-8004 Agent #{goatConfig.agentId}
          </span>
          <span>
            {goatConfig.apiUrl.replace("https://", "")}
          </span>
        </footer>
      </div>
    </div>
  );
}
