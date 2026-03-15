/**
 * Social & Challenge API Routes for Gin Paradise.
 *
 * Endpoints:
 *   POST /api/social/follow/:userId          — Follow a player
 *   DELETE /api/social/follow/:userId        — Unfollow a player
 *   GET  /api/social/followers               — List followers
 *   GET  /api/social/following               — List following
 *   GET  /api/social/relationship/:userId    — Relationship to another player
 *
 *   POST /api/social/challenge               — Send a challenge
 *   POST /api/social/challenge/:id/accept    — Accept a challenge (returns roomId for match handoff)
 *   POST /api/social/challenge/:id/decline   — Decline a challenge
 *   POST /api/social/challenge/:id/cancel    — Cancel own challenge
 *   GET  /api/social/challenges/inbox        — Pending inbound challenges
 *   GET  /api/social/challenges/outbox       — Pending outbound challenges
 *   GET  /api/social/challenges/accepted     — Recently accepted (joinable) challenges
 *   GET  /api/social/challenges/history      — Recent challenge history
 *   GET  /api/social/head-to-head/:userId    — Head-to-head record
 *
 *   POST /api/social/rematch                 — Propose a rematch
 *   POST /api/social/rematch/:id/accept      — Accept a rematch (returns roomId)
 *   POST /api/social/rematch/:id/decline     — Decline a rematch
 *   GET  /api/social/rematches               — Pending rematches for user
 *
 *   GET  /api/social/availability/:userId    — Player availability status
 *   POST /api/social/availability/batch      — Batch availability check
 *
 *   GET  /api/social/notifications           — Social notifications
 *   POST /api/social/notifications/read      — Mark notifications as read
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { db } from "../db.js";
import {
  followPlayer,
  unfollowPlayer,
  isFollowing,
  getFollowerCount,
  getFollowingCount,
  getFollowers,
  getFollowing,
  createChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  getPendingChallengesForUser,
  getOutboundChallenges,
  getAcceptedChallengesForUser,
  getChallengeHistory,
  getChallengeById,
  getHeadToHead,
  getSocialNotifications,
  getUnreadSocialNotificationCount,
  markSocialNotificationsRead,
  proposeRematch,
  acceptRematch,
  declineRematch,
  getPendingRematchesForUser,
  getAcceptedRematchesForUser,
  getRematchById,
  getPlayerAvailability,
  getPlayerAvailabilities,
} from "../social.js";

const router = Router();

// ── Follow Endpoints ──────────────────────────────────────────────

router.post("/follow/:userId", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const followerId = req.userId!;
  const followingId = req.params.userId;

  const result = followPlayer(followerId, followingId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    success: true,
    followerCount: getFollowerCount(followingId),
    isFollowing: true,
  });
});

router.delete("/follow/:userId", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const followerId = req.userId!;
  const followingId = req.params.userId;

  const result = unfollowPlayer(followerId, followingId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    success: true,
    followerCount: getFollowerCount(followingId),
    isFollowing: false,
  });
});

router.get("/followers", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 100);
  const followers = getFollowers(userId, limit);
  res.json({
    followers,
    totalCount: getFollowerCount(userId),
  });
});

router.get("/following", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 100);
  const following = getFollowing(userId, limit);
  res.json({
    following,
    totalCount: getFollowingCount(userId),
  });
});

router.get("/relationship/:userId", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const myId = req.userId!;
  const targetId = req.params.userId;

  if (myId === targetId) {
    res.json({ isSelf: true, isFollowing: false, isFollowedBy: false });
    return;
  }

  res.json({
    isSelf: false,
    isFollowing: isFollowing(myId, targetId),
    isFollowedBy: isFollowing(targetId, myId),
    followerCount: getFollowerCount(targetId),
    followingCount: getFollowingCount(targetId),
  });
});

// ── Username-based Follow Endpoints (for profile page) ────────────

router.post("/follow-by-username/:username", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const followerId = req.userId!;
  const targetUsername = req.params.username;
  const target = db.prepare("SELECT id FROM users WHERE username = ?").get(targetUsername) as { id: string } | undefined;
  if (!target) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const result = followPlayer(followerId, target.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, followerCount: getFollowerCount(target.id), isFollowing: true });
});

router.delete("/follow-by-username/:username", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const followerId = req.userId!;
  const targetUsername = req.params.username;
  const target = db.prepare("SELECT id FROM users WHERE username = ?").get(targetUsername) as { id: string } | undefined;
  if (!target) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const result = unfollowPlayer(followerId, target.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, followerCount: getFollowerCount(target.id), isFollowing: false });
});

// ── Challenge Endpoints ───────────────────────────────────────────

router.post("/challenge", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const challengerId = req.userId!;
  const { targetId, targetUsername, stakeId, message } = req.body || {};

  if (!targetId) {
    res.status(400).json({ error: "targetId is required" });
    return;
  }

  // Lookup challenger username
  const challenger = db.prepare("SELECT username FROM users WHERE id = ?").get(challengerId) as { username: string } | undefined;
  if (!challenger) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const result = createChallenge(challengerId, challenger.username, targetId, stakeId || "free", message || null);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, challenge: result.challenge });
});

// Challenge by username (for profile page)
router.post("/challenge-by-username", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const challengerId = req.userId!;
  const { targetUsername, stakeId, message } = req.body || {};

  if (!targetUsername) {
    res.status(400).json({ error: "targetUsername is required" });
    return;
  }

  const target = db.prepare("SELECT id, username FROM users WHERE username = ?").get(targetUsername) as { id: string; username: string } | undefined;
  if (!target) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const challenger = db.prepare("SELECT username FROM users WHERE id = ?").get(challengerId) as { username: string } | undefined;
  if (!challenger) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const result = createChallenge(challengerId, challenger.username, target.id, stakeId || "free", message || null);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, challenge: result.challenge });
});

router.post("/challenge/:id/accept", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const challengeId = req.params.id;

  const result = acceptChallenge(challengeId, userId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, challenge: result.challenge, roomId: result.roomId });
});

router.post("/challenge/:id/decline", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const challengeId = req.params.id;

  const result = declineChallenge(challengeId, userId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true });
});

router.post("/challenge/:id/cancel", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const challengeId = req.params.id;

  const result = cancelChallenge(challengeId, userId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true });
});

router.get("/challenges/inbox", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const challenges = getPendingChallengesForUser(userId);
  res.json({ challenges });
});

router.get("/challenges/outbox", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const challenges = getOutboundChallenges(userId);
  res.json({ challenges });
});

router.get("/challenges/accepted", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const challenges = getAcceptedChallengesForUser(userId);
  res.json({ challenges });
});

router.get("/challenges/history", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 50);
  const challenges = getChallengeHistory(userId, limit);
  res.json({ challenges });
});

router.get("/challenge/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const challenge = getChallengeById(req.params.id);
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  // Only visible to participants
  const userId = req.userId!;
  if (challenge.challengerId !== userId && challenge.targetId !== userId) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  res.json({ challenge });
});

// ── Head-to-Head ──────────────────────────────────────────────────

router.get("/head-to-head/:userId", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const myId = req.userId!;
  const opponentId = req.params.userId;

  if (myId === opponentId) {
    res.json({ wins: 0, losses: 0, total: 0, lastPlayed: null, isSelf: true });
    return;
  }

  const h2h = getHeadToHead(myId, opponentId);
  res.json({ ...h2h, isSelf: false });
});

// ── Social Notifications ──────────────────────────────────────────

router.get("/notifications", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const unreadOnly = req.query.unread === "true";
  const limit = Math.min(parseInt(String(req.query.limit || "30"), 10) || 30, 100);

  const notifications = getSocialNotifications(userId, unreadOnly, limit);
  const unreadCount = getUnreadSocialNotificationCount(userId);

  res.json({ notifications, unreadCount });
});

router.post("/notifications/read", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { notificationIds } = req.body || {};

  const marked = markSocialNotificationsRead(
    userId,
    Array.isArray(notificationIds) ? notificationIds : undefined
  );

  res.json({ marked, unreadCount: getUnreadSocialNotificationCount(userId) });
});

// ── Rematch Endpoints ─────────────────────────────────────────────

router.post("/rematch", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const proposerId = req.userId!;
  const { opponentId, stakeId, challengeId } = req.body || {};

  if (!opponentId) {
    res.status(400).json({ error: "opponentId is required" });
    return;
  }

  const result = proposeRematch(proposerId, opponentId, stakeId || "free", challengeId || null);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, rematch: result.rematch });
});

router.post("/rematch/:id/accept", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const rematchId = req.params.id;

  const result = acceptRematch(rematchId, userId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, rematch: result.rematch, roomId: result.roomId });
});

router.post("/rematch/:id/decline", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const rematchId = req.params.id;

  const result = declineRematch(rematchId, userId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true });
});

router.get("/rematches", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const rematches = getPendingRematchesForUser(userId);
  res.json({ rematches });
});

router.get("/rematches/accepted", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const rematches = getAcceptedRematchesForUser(userId);
  res.json({ rematches });
});

router.get("/rematch/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const rematch = getRematchById(req.params.id);
  if (!rematch) {
    res.status(404).json({ error: "Rematch not found" });
    return;
  }
  const userId = req.userId!;
  if (rematch.player1Id !== userId && rematch.player2Id !== userId) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  res.json({ rematch });
});

// ── Availability Endpoints ────────────────────────────────────────

router.get("/availability/:userId", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.userId;
  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetId) as { id: string; username: string } | undefined;
  if (!user) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const availability = getPlayerAvailability(targetId);
  res.json({ userId: targetId, username: user.username, availability });
});

router.post("/availability/batch", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { userIds } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ error: "userIds array is required" });
    return;
  }
  // Cap at 50 to prevent abuse
  const limited = userIds.slice(0, 50);
  const availabilities = getPlayerAvailabilities(limited);
  res.json({ availabilities });
});

export default router;
