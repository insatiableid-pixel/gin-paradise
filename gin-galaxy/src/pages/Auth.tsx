import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/src/lib/store";
import { Button } from "@/src/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";

export function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
    const body = isLogin ? { username, password } : { username, email, password };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");

      setUser(data.user, data.sessionId);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Tropical background */}
      <div className="absolute inset-0" style={{ backgroundImage: 'url(/assets/tropical-bg.png)', backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.5) 100%)' }} />
      
      <div className="relative z-10 w-full max-w-md">
        {/* Gin Paradise branding */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-[0.2em] text-amber-100" style={{ fontFamily: 'Georgia, "Times New Roman", serif', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
            🌴 GIN PARADISE
          </h1>
          <p className="text-emerald-200/60 text-sm mt-1">The tropical card game experience</p>
        </div>

        <Card className="bg-[#0a2e1e]/90 border-emerald-700/40 backdrop-blur-md shadow-2xl">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center text-amber-100" style={{ fontFamily: 'Georgia, serif' }}>
              {isLogin ? "Welcome Back" : "Create Account"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-md text-rose-400 text-sm">
                  {error}
                </div>
              )}
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-emerald-200/80">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d3828] border border-emerald-700/40 rounded-md text-emerald-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-emerald-600/50"
                  required
                />
              </div>

              {!isLogin && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-emerald-200/80">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0d3828] border border-emerald-700/40 rounded-md text-emerald-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-emerald-600/50"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-emerald-200/80">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d3828] border border-emerald-700/40 rounded-md text-emerald-50 focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-emerald-600/50"
                  required
                />
              </div>

              <Button type="submit" variant="primary" className="w-full font-bold text-base py-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg, #d4a843, #b8860b)', color: '#1a1a1a' }}>
                {isLogin ? "Sign In" : "Sign Up"}
              </Button>

              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-sm text-amber-400/80 hover:text-amber-300"
                >
                  {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
