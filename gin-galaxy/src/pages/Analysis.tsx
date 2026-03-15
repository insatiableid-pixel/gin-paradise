import React, { useState, useEffect } from "react";
import { Activity, Play, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { useAuthStore } from "@/src/lib/store";
import Markdown from "react-markdown";
import { cn } from "@/src/lib/utils";

interface Match {
  id: string;
  opponent_name: string;
  user_score: number;
  opponent_score: number;
  is_win: boolean;
  created_at: string;
}

export function Analysis() {
  const { sessionId } = useAuthStore();
  const [matches, setMatches] = useState<Match[]>([]);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingMatches, setFetchingMatches] = useState(true);

  useEffect(() => {
    if (sessionId) {
      fetch("/api/matches", {
        headers: { Authorization: `Bearer ${sessionId}` }
      })
      .then(res => res.json())
      .then(data => {
        setMatches(data.matches || []);
        setFetchingMatches(false);
      })
      .catch(() => setFetchingMatches(false));
    }
  }, [sessionId]);

  const handleAnalyze = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/analysis", {
        headers: { Authorization: `Bearer ${sessionId}` }
      });
      const data = await res.json();
      setAnalysis(data.analysis);
    } catch (err) {
      console.error(err);
      setAnalysis("Failed to load analysis. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Game Analysis</h1>
          <p className="text-zinc-400 mt-1">Review your past matches with AI-powered insights.</p>
        </div>
        <Button 
          variant="primary" 
          className="bg-indigo-600 hover:bg-indigo-500" 
          onClick={handleAnalyze}
          disabled={loading || matches.length === 0}
        >
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Activity className="w-4 h-4 mr-2" />}
          {loading ? "Analyzing..." : "Analyze Recent Matches"}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Match History Sidebar */}
        <div className="md:col-span-1 space-y-4">
          <h3 className="font-semibold text-zinc-300">Recent Matches</h3>
          {fetchingMatches ? (
            <div className="text-zinc-500 text-sm">Loading matches...</div>
          ) : matches.length === 0 ? (
            <div className="text-zinc-500 text-sm">No matches played yet.</div>
          ) : (
            <div className="space-y-3">
              {matches.map((match) => (
                <div key={match.id} className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800 flex justify-between items-center">
                  <div>
                    <div className="font-medium text-zinc-200 text-sm">vs {match.opponent_name}</div>
                    <div className="text-xs text-zinc-500">{new Date(match.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-sm font-bold", match.is_win ? "text-emerald-500" : "text-rose-500")}>
                      {match.is_win ? "Win" : "Loss"}
                    </div>
                    <div className="text-xs font-mono text-zinc-400">{match.user_score} - {match.opponent_score}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Analysis Content */}
        <div className="md:col-span-2">
          <Card className="bg-zinc-900/40 border-zinc-800/60 overflow-hidden h-full">
            <CardHeader className="border-b border-zinc-800/60 bg-zinc-900/80">
              <CardTitle className="text-xl flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-400" />
                AI Coach Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {analysis ? (
                <div className="prose prose-invert prose-indigo max-w-none">
                  <div className="markdown-body">
                    <Markdown>{analysis}</Markdown>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-12 text-center">
                  <Activity className="w-12 h-12 mb-4 opacity-20" />
                  <p>Click "Analyze Recent Matches" to get personalized feedback from your AI Gin Rummy Coach.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
