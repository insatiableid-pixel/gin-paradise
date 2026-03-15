import { Router, Response } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const analysisLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: "Too many analysis requests. Please try again in a few minutes.",
});

router.get("/", requireAuth, analysisLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const matches = db.prepare("SELECT * FROM matches WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(req.userId) as any[];

  if (matches.length === 0) {
    res.json({ analysis: "You haven't played any matches yet! Play a few games to get AI-powered insights." });
    return;
  }

  // Graceful failure when GEMINI_API_KEY is missing
  if (!process.env.GEMINI_API_KEY) {
    res.json({
      analysis:
        "**AI Analysis Unavailable**\n\nThe `GEMINI_API_KEY` environment variable is not configured. " +
        "Set it in your `.env` file or environment to enable AI-powered match analysis.\n\n" +
        `In the meantime, here's a quick summary: You've played ${matches.length} recent match(es) ` +
        `with ${matches.filter((m: any) => m.is_win).length} win(s).`,
    });
    return;
  }

  const matchHistoryText = matches
    .map((m, i) => `Match ${i + 1}: vs ${m.opponent_name}. Result: ${m.is_win ? "Win" : "Loss"}. Score: ${m.user_score} to ${m.opponent_score}.`)
    .join("\n");

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
      You are an expert Gin Rummy coach. Analyze the following recent match history for a player:
      
      ${matchHistoryText}
      
      Provide a concise, encouraging, and actionable analysis of their performance. 
      Format your response in Markdown. Include:
      1. **Overall Trend**: A brief summary of their recent performance.
      2. **Strengths**: What they seem to be doing well (e.g., scoring high, winning consistently).
      3. **Areas for Improvement**: Potential weaknesses based on the scores (e.g., if they lose with low scores, maybe they are knocking too late).
      4. **Actionable Tip**: One specific, advanced Gin Rummy strategy tip they can use in their next game.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({ analysis: response.text });
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ error: "Failed to generate analysis. Please try again later." });
  }
});

export default router;
