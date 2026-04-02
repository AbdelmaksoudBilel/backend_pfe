// =============================================================================
// routes/conversations.route.js  —  CRUD Conversations
// =============================================================================
// Base URL : /api/conversations
//
// ROUTES :
//   GET    /api/conversations              → mes conversations
//   GET    /api/conversations/:id          → détail une conversation
//   POST   /api/conversations              → créer une conversation
//   PUT    /api/conversations/:id          → renommer une conversation
//   DELETE /api/conversations/:id          → supprimer une conversation + ses messages
// =============================================================================

const express      = require("express");
const Conversation = require("../models/schema_conversations");
const Message      = require("../models/schema_messages");
const Response     = require("../models/schema_responses");
const Child        = require("../models/schema_children");
const { protect, approved } = require("../middleware/auth");

const router = express.Router();

// GET /api/conversations  →  toutes les conversations du parent connecté
router.get("/", protect, approved, async (req, res) => {
  try {
    const { childId } = req.query;
    const filter = { userId: req.user._id };
    if (childId) filter.childId = childId;

    const conversations = await Conversation.find(filter)
      .populate("childId", "firstName lastName prediction")
      .sort("-updatedAt");

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/conversations/:id  →  détail + meta d'une conversation
router.get("/:id", protect, approved, async (req, res) => {
  try {
    const conv = await Conversation.findOne({
      _id   : req.params.id,
      userId: req.user._id,
    }).populate("childId", "firstName lastName prediction profileDetected");

    if (!conv) return res.status(404).json({ message: "Conversation introuvable" });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/conversations  →  créer une nouvelle conversation
router.post("/", protect, approved, async (req, res) => {
  try {
    const { childId, name } = req.body;
    if (!childId) return res.status(400).json({ message: "childId requis" });

    // Vérifier que l'enfant appartient au parent
    const child = await Child.findOne({ _id: childId, userId: req.user._id });
    if (!child) return res.status(404).json({ message: "Enfant introuvable" });

    const conv = await Conversation.create({
      userId : req.user._id,
      childId: childId,
      name   : name || `Conversation — ${child.firstName}`,
    });

    res.status(201).json(conv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/conversations/:id  →  renommer une conversation
router.put("/:id", protect, approved, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "name requis" });

    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name },
      { new: true }
    );
    if (!conv) return res.status(404).json({ message: "Conversation introuvable" });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/conversations/:id  →  supprimer conversation + tous ses messages + réponses
router.delete("/:id", protect, approved, async (req, res) => {
  try {
    const conv = await Conversation.findOne({
      _id: req.params.id, userId: req.user._id,
    });
    if (!conv) return res.status(404).json({ message: "Conversation introuvable" });

    // Récupérer les IDs des messages pour supprimer les réponses liées
    const messages = await Message.find({ conversationId: conv._id }, "_id");
    const msgIds   = messages.map(m => m._id);

    await Response.deleteMany({ messageId: { $in: msgIds } });
    await Message.deleteMany({ conversationId: conv._id });
    await conv.deleteOne();

    res.json({ message: "Conversation et historique supprimés" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;