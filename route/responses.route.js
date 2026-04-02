const express  = require("express");
const Response = require("../models/schema_responses");
const Message  = require("../models/schema_messages");
const Conversation = require("../models/schema_conversations");
const { protect, approved, adminOnly } = require("../middleware/auth");

const router = express.Router();

// GET /api/responses/stats  →  statistiques (admin) — AVANT /:msgId pour éviter conflit
router.get("/stats", protect, adminOnly, async (req, res) => {
  try {
    const [total, helpful, notHelpful, avgScore, avgTime] = await Promise.all([
      Response.countDocuments(),
      Response.countDocuments({ helpful: true }),
      Response.countDocuments({ helpful: false }),
      Response.aggregate([{ $group: { _id: null, avg: { $avg: "$score" } } }]),
      Response.aggregate([{ $group: { _id: null, avg: { $avg: "$totalDurationMs" } } }]),
    ]);

    res.json({
      total,
      helpful,
      notHelpful,
      noFeedback   : total - helpful - notHelpful,
      avgScore     : avgScore[0]?.avg?.toFixed(3) ?? null,
      avgTimeMs    : Math.round(avgTime[0]?.avg ?? 0),
      satisfactionPct: total > 0 ? ((helpful / (helpful + notHelpful)) * 100).toFixed(1) : null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/responses/:msgId  →  réponse IA d'un message
router.get("/:msgId", protect, approved, async (req, res) => {
  try {
    const response = await Response.findOne({ messageId: req.params.msgId });
    if (!response) return res.status(404).json({ message: "Réponse introuvable" });
    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/responses/:msgId/feedback  →  feedback parent (👍 / 👎 + commentaire)
router.put("/:msgId/feedback", protect, approved, async (req, res) => {
  try {
    const { helpful, review } = req.body;
    if (helpful === undefined)
      return res.status(400).json({ message: "helpful (true/false) requis" });

    // Vérifier que le message appartient au parent connecté
    const msg  = await Message.findById(req.params.msgId);
    if (!msg) return res.status(404).json({ message: "Message introuvable" });

    const conv = await Conversation.findOne({
      _id: msg.conversationId, userId: req.user._id,
    });
    if (!conv) return res.status(403).json({ message: "Accès refusé" });

    const response = await Response.findOneAndUpdate(
      { messageId: req.params.msgId },
      { helpful: Boolean(helpful), review: review?.trim() || null },
      { new: true }
    );
    if (!response) return res.status(404).json({ message: "Réponse introuvable" });

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;