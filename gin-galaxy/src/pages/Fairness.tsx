import React from "react";
import {
  Shield, Check, Lock, Eye, Server, FileSearch, Hash, RefreshCw,
  ChevronRight, ExternalLink, ArrowRight, Fingerprint
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { cn } from "@/src/lib/utils";

// ── Fairness Explanation Page ────────────────────────────────────────

export function Fairness() {
  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-4xl mx-auto">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950/60 via-[#0a2e1e]/80 to-teal-950/40 border border-emerald-500/20 p-8 md:p-12">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-teal-500/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-amber-50 tracking-tight">
                Trust Shield
              </h1>
              <p className="text-sm text-emerald-400/80 font-medium">
                Provably Fair Architecture
              </p>
            </div>
          </div>
          
          <p className="text-emerald-300/70 leading-relaxed max-w-2xl text-base md:text-lg">
            Every Gin Paradise multiplayer hand uses cryptographically secure shuffling
            with a commit-reveal protocol and client-seed contribution. You can independently 
            verify that the deck was fair — no blockchain required.
          </p>
        </div>
      </div>

      {/* How It Works — Four Steps */}
      <div>
        <h2 className="text-lg font-semibold text-amber-50 mb-4 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-emerald-400" />
          How It Works
        </h2>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Step 1: Commit */}
          <Card className="bg-emerald-950/30 border-emerald-800/40 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm font-bold text-emerald-400">
                  1
                </div>
                <h3 className="font-semibold text-amber-50">Commit</h3>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-400/80 uppercase tracking-wider font-medium">Before Dealing</span>
              </div>
              <p className="text-sm text-emerald-300/60 leading-relaxed">
                The server generates a secret <span className="text-emerald-100 font-medium">server seed</span> and 
                publishes its <span className="text-emerald-100 font-medium">SHA-256 hash</span> (the commitment) 
                before any cards are dealt. This locks in the server's entropy.
              </p>
            </CardContent>
          </Card>

          {/* Step 2: Client Seeds */}
          <Card className="bg-emerald-950/30 border-emerald-800/40 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-amber-500 to-amber-400" />
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm font-bold text-amber-400">
                  2
                </div>
                <h3 className="font-semibold text-amber-50">Contribute</h3>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Fingerprint className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-amber-400/80 uppercase tracking-wider font-medium">Client Seeds</span>
              </div>
              <p className="text-sm text-emerald-300/60 leading-relaxed">
                Each player submits a random <span className="text-emerald-100 font-medium">client seed</span>. 
                These are combined with the server seed via <span className="text-emerald-100 font-medium">HMAC-SHA256</span>, 
                ensuring <span className="text-emerald-100 font-medium">no single party</span> determines the shuffle.
              </p>
            </CardContent>
          </Card>

          {/* Step 3: Play */}
          <Card className="bg-emerald-950/30 border-emerald-800/40 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-teal-500 to-emerald-500" />
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-sm font-bold text-teal-400">
                  3
                </div>
                <h3 className="font-semibold text-amber-50">Play</h3>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Server className="w-4 h-4 text-teal-400 shrink-0" />
                <span className="text-xs text-teal-400/80 uppercase tracking-wider font-medium">During the Hand</span>
              </div>
              <p className="text-sm text-emerald-300/60 leading-relaxed">
                The game plays out normally. The combined seed determines the deck 
                order — it <span className="text-emerald-100 font-medium">cannot be changed</span> after commitment 
                and seed submission.
              </p>
            </CardContent>
          </Card>

          {/* Step 4: Reveal & Verify */}
          <Card className="bg-emerald-950/30 border-emerald-800/40 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-400 to-amber-400" />
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm font-bold text-emerald-400">
                  4
                </div>
                <h3 className="font-semibold text-amber-50">Reveal & Verify</h3>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-400/80 uppercase tracking-wider font-medium">After the Hand</span>
              </div>
              <p className="text-sm text-emerald-300/60 leading-relaxed">
                All seeds are revealed. You can <span className="text-emerald-100 font-medium">independently verify</span> that 
                the commitment matches and the deck is reproducible from the revealed seeds.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* What You Can Verify */}
      <Card className="bg-emerald-950/20 border-emerald-800/40">
        <CardHeader className="border-b border-emerald-800/40 bg-gradient-to-r from-emerald-950/40 to-[#0a2e1e]/80">
          <CardTitle className="text-lg flex items-center gap-2 text-amber-50">
            <Check className="w-5 h-5 text-emerald-400" />
            What You Can Verify
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                icon: <Hash className="w-4 h-4 text-emerald-400" />,
                title: "Commitment Integrity",
                desc: "The SHA-256 hash published before dealing matches the revealed server seed.",
              },
              {
                icon: <Fingerprint className="w-4 h-4 text-emerald-400" />,
                title: "Deck Reproducibility",
                desc: "The same seed + nonce always produces the exact same 52-card deck ordering.",
              },
              {
                icon: <FileSearch className="w-4 h-4 text-emerald-400" />,
                title: "Proof Package",
                desc: "Download the full proof for any completed hand — seed, nonce, deck hash, and transcript linkage.",
              },
              {
                icon: <Shield className="w-4 h-4 text-emerald-400" />,
                title: "Independent Verification",
                desc: "Use our verification API or compute SHA-256 yourself to confirm fairness without trusting anyone.",
              },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-lg bg-emerald-950/40 border border-emerald-800/30">
                <div className="mt-0.5 shrink-0">{item.icon}</div>
                <div>
                  <h4 className="text-sm font-semibold text-emerald-100 mb-1">{item.title}</h4>
                  <p className="text-xs text-emerald-300/60 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* What Remains Trust-Based */}
      <Card className="bg-emerald-950/20 border-emerald-800/40">
        <CardHeader className="border-b border-emerald-800/40 bg-gradient-to-r from-amber-950/20 to-[#0a2e1e]/80">
          <CardTitle className="text-lg flex items-center gap-2 text-amber-50">
            <Server className="w-5 h-5 text-amber-400" />
            What Remains Trust-Based
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-sm text-emerald-300/60 leading-relaxed mb-4">
            The commit-reveal model provides strong guarantees, but some aspects inherently rely on 
            server trust. We believe in transparency about these boundaries:
          </p>
          <div className="space-y-3">
            {[
              {
                title: "Real-time game state",
                desc: "The server is authoritative for in-game state (valid moves, scoring). The fairness proof covers the initial deal, not every in-game action.",
              },
              {
                title: "Timing of reveals",
                desc: "Seeds are revealed only after a hand completes, to prevent information leakage during play.",
              },
              {
                title: "Client seed opt-in",
                desc: "Client seed contribution is opt-in. If a client doesn't submit a seed, the round uses v1 (server-seed-only) — still committed before dealing.",
              },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg border border-amber-500/10 bg-amber-950/10">
                <ChevronRight className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-emerald-200 mb-0.5">{item.title}</h4>
                  <p className="text-xs text-emerald-400/50 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Technical Details */}
      <Card className="bg-emerald-950/20 border-emerald-800/40">
        <CardHeader className="border-b border-emerald-800/40 bg-gradient-to-r from-emerald-950/40 to-[#0a2e1e]/80">
          <CardTitle className="text-lg flex items-center gap-2 text-amber-50">
            <Fingerprint className="w-5 h-5 text-emerald-400" />
            Technical Details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { label: "Hash Algorithm", value: "SHA-256" },
              { label: "Shuffle Algorithm", value: "Fisher-Yates (HMAC-SHA256 seeded)" },
              { label: "Seed Length", value: "32 bytes (256 bits)" },
              { label: "Algorithm Version", value: "v2 (client-seed contribution)" },
              { label: "Commitment Format", value: 'SHA-256(serverSeed + ":" + nonce)' },
              { label: "Seed Combination", value: 'HMAC-SHA256(serverSeed, c1 + ":" + c2)' },
              { label: "Blockchain Required", value: "No" },
              { label: "Backward Compatible", value: "Yes (v1 proofs still verifiable)" },
            ].map((item, i) => (
              <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/30">
                <span className="text-xs text-emerald-400/50 uppercase tracking-wider">{item.label}</span>
                <span className="text-sm font-mono text-emerald-100">{item.value}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 p-4 rounded-lg bg-[#0a2e1e]/60 border border-emerald-800/30">
            <h4 className="text-sm font-semibold text-emerald-200 mb-2">Verification Pseudocode</h4>
            <pre className="text-xs text-emerald-300/60 font-mono leading-relaxed overflow-x-auto">
{`// 1. Check server commitment
commitment_hash = SHA-256(server_seed + ":" + nonce)
assert commitment_hash === published_commitment

// 2. Combine seeds (v2 only)
combined_seed = HMAC-SHA256(server_seed, client_seed_1 + ":" + client_seed_2)

// 3. Reproduce shuffle from combined seed (or server seed for v1)
random_stream = HMAC-SHA256(combined_seed, data)
deck = Fisher-Yates shuffle using random_stream

// 4. Verify deck hash
deck_hash = SHA-256(deck_order.join(","))
assert deck_hash === published_deck_hash`}
            </pre>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg border border-emerald-500/15 bg-emerald-950/30">
            <FileSearch className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-emerald-100 mb-1">Verification API</h4>
              <p className="text-xs text-emerald-300/60 leading-relaxed mb-2">
                Submit any proof package to our public verification endpoint. 
                No authentication required — the math speaks for itself.
              </p>
              <code className="text-xs text-emerald-400 bg-emerald-950/60 px-2 py-1 rounded font-mono">
                POST /api/fairness/verify
              </code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CTA */}
      <div className="text-center py-4">
        <p className="text-sm text-emerald-400/50">
          Fairness proofs are available in the <span className="text-emerald-200 font-medium">Match Replay</span> viewer 
          for all multiplayer games played with Trust Shield active.
        </p>
      </div>
    </div>
  );
}
