// =============================================================================
// routes/dashboard_admin.route.js  —  Dashboard Admin
// =============================================================================
// Base URL : /api/dashboard
// Accès    : admin uniquement
//
// ROUTES :
//   GET  /api/dashboard/stats              → chiffres globaux (users, enfants, messages...)
//   GET  /api/dashboard/users              → stats utilisateurs (inscrits, approuvés, en attente)
//   GET  /api/dashboard/children           → stats enfants (répartition TSA/RM/Normal)
//   GET  /api/dashboard/conversations      → stats conversations et activité chatbot
//   GET  /api/dashboard/evaluations        → stats évaluations (scores moyens par domaine)
//   GET  /api/dashboard/responses          → stats réponses IA (temps, satisfaction, RAG)
//   POST /api/dashboard/nlp                → analyse NLP des messages (appelle Python)
//   POST /api/dashboard/nlp/child/:childId → analyse NLP des messages d'un enfant spécifique
// =============================================================================

const express            = require("express");
const axios              = require("axios");
const User               = require("../models/schema_users");
const Child              = require("../models/schema_children");
const Conversation       = require("../models/schema_conversations");
const Message            = require("../models/schema_messages");
const Response           = require("../models/schema_responses");
const EvaluationSession  = require("../models/schema_evaluation_sessions");
const EvaluationResponse = require("../models/schema_evaluation_responses");
const { protect, adminOnly } = require("../middleware/auth");

const router     = express.Router();
const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

// =============================================================================
// GET /api/dashboard/stats  →  chiffres globaux (cards en haut du dashboard)
// =============================================================================
router.get("/stats", protect, adminOnly, async (req, res) => {
  try {
    const [
      totalUsers,
      pendingUsers,
      totalChildren,
      totalConversations,
      totalMessages,
      totalResponses,
      totalSessions,
    ] = await Promise.all([
      User.countDocuments({ role: "parent" }),
      User.countDocuments({ role: "parent", isApproved: false, isEmailVerified: true }),
      Child.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments({ role: "user" }),
      Response.countDocuments(),
      EvaluationSession.countDocuments(),
    ]);

    res.json({
      totalUsers,
      pendingUsers,
      totalChildren,
      totalConversations,
      totalMessages,
      totalResponses,
      totalSessions,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/dashboard/users  →  stats utilisateurs
// =============================================================================
router.get("/users", protect, adminOnly, async (req, res) => {
  try {
    const [approved, pending, notVerified, lastWeek] = await Promise.all([
      User.countDocuments({ role: "parent", isApproved: true }),
      User.countDocuments({ role: "parent", isApproved: false, isEmailVerified: true }),
      User.countDocuments({ role: "parent", isEmailVerified: false }),
      User.countDocuments({
        role     : "parent",
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    // Inscriptions par mois (6 derniers mois)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const inscriptionsParMois = await User.aggregate([
      { $match: { role: "parent", createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
          _id  : { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 },
      }},
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    res.json({ approved, pending, notVerified, lastWeek, inscriptionsParMois });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/dashboard/children  →  stats enfants
// =============================================================================
router.get("/children", protect, adminOnly, async (req, res) => {
  try {
    // Répartition TSA / RM / MIXTE / Normal
    const predictionDist = await Child.aggregate([
      { $group: { _id: "$prediction", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Répartition par genre
    const genderDist = await Child.aggregate([
      { $group: { _id: "$gender", count: { $sum: 1 } } },
    ]);

    // Confiance moyenne du modèle ML
    const avgConfidence = await Child.aggregate([
      { $match: { confidence: { $exists: true, $ne: null } } },
      { $group: { _id: null, avg: { $avg: "$confidence" } } },
    ]);

    // Enfants ajoutés cette semaine
    const thisWeek = await Child.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    res.json({
      predictionDist,
      genderDist,
      avgConfidence: avgConfidence[0]?.avg?.toFixed(3) ?? null,
      thisWeek,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/dashboard/conversations  →  stats chatbot
// =============================================================================
router.get("/conversations", protect, adminOnly, async (req, res) => {
  try {
    const [totalConvs, activeConvs, avgMessages] = await Promise.all([
      Conversation.countDocuments(),
      Conversation.countDocuments({ isActive: true }),
      Conversation.aggregate([
        { $group: { _id: null, avg: { $avg: "$totalMessages" } } },
      ]),
    ]);

    // Messages par jour (7 derniers jours)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const messagesParJour = await Message.aggregate([
      { $match: { role: "user", createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
          _id  : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Répartition types de fichiers
    const fileTypeDist = await Message.aggregate([
      { $match: { role: "user", fileType: { $ne: "aucun" } } },
      { $group: { _id: "$fileType", count: { $sum: 1 } } },
    ]);

    res.json({
      totalConvs,
      activeConvs,
      avgMessagesPerConv: avgMessages[0]?.avg?.toFixed(1) ?? 0,
      messagesParJour,
      fileTypeDist,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/dashboard/responses  →  stats réponses IA (performance + satisfaction)
// =============================================================================
router.get("/responses", protect, adminOnly, async (req, res) => {
  try {
    const [total, helpful, notHelpful, webUsed] = await Promise.all([
      Response.countDocuments(),
      Response.countDocuments({ helpful: true }),
      Response.countDocuments({ helpful: false }),
      Response.countDocuments({ webUsed: true }),
    ]);

    // Temps moyen de réponse
    const avgTimes = await Response.aggregate([
      { $match: { totalDurationMs: { $exists: true, $ne: null } } },
      { $group: {
          _id            : null,
          avgTotal       : { $avg: "$totalDurationMs" },
          avgRag         : { $avg: "$ragDurationMs" },
          avgLlm         : { $avg: "$llmDurationMs" },
      }},
    ]);

    // Score RAG moyen
    const avgScore = await Response.aggregate([
      { $match: { score: { $exists: true, $ne: null } } },
      { $group: { _id: null, avg: { $avg: "$score" } } },
    ]);

    // Évolution satisfaction (7 derniers jours)
    const sevenDaysAgo    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const satisfactionTrend = await Response.aggregate([
      { $match: { helpful: { $ne: null }, createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
          _id    : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          helpful: { $sum: { $cond: ["$helpful", 1, 0] } },
          total  : { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    const times = avgTimes[0] || {};
    res.json({
      total,
      helpful,
      notHelpful,
      noFeedback     : total - helpful - notHelpful,
      webUsed,
      satisfactionPct: (helpful + notHelpful) > 0
        ? ((helpful / (helpful + notHelpful)) * 100).toFixed(1)
        : null,
      avgTotalMs : Math.round(times.avgTotal ?? 0),
      avgRagMs   : Math.round(times.avgRag   ?? 0),
      avgLlmMs   : Math.round(times.avgLlm   ?? 0),
      avgRagScore: avgScore[0]?.avg?.toFixed(3) ?? null,
      satisfactionTrend,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/dashboard/evaluations  →  stats évaluations comportementales
// =============================================================================
router.get("/evaluations", protect, adminOnly, async (req, res) => {
  try {
    const [total, aiPrefilled, fromForm] = await Promise.all([
      EvaluationSession.countDocuments(),
      EvaluationSession.countDocuments({ aiPrefilled: true }),
      EvaluationSession.countDocuments({ fromForm: true }),
    ]);

    // Score global moyen par type de période
    const scoreParPeriode = await EvaluationSession.aggregate([
      { $group: {
          _id     : "$period",
          avgScore: { $avg: "$globalScore" },
          count   : { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Score moyen par domaine (toutes sessions confondues)
    const scoreParDomaine = await EvaluationResponse.aggregate([
      { $group: {
          _id  : "$domain",
          total: { $sum: 1 },
          oui  : { $sum: "$answer" },
      }},
      { $project: {
          domain: "$_id",
          score : { $multiply: [{ $divide: ["$oui", "$total"] }, 100] },
          total : 1,
      }},
      { $sort: { score: 1 } },   // du plus faible au plus élevé
    ]);

    // Évolution globale (toutes les sessions triées par date)
    const evolution = await EvaluationSession.find()
      .sort("evaluatedAt")
      .select("evaluatedAt periodLabel globalScore period")
      .limit(50);

    res.json({
      total,
      aiPrefilled,
      fromForm,
      scoreParPeriode,
      scoreParDomaine,
      evolution,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/dashboard/nlp
// Analyse NLP de TOUS les messages parents → appelle Python /dashboard/nlp
//
// Body (optionnel) :
//   {
//     n_keywords     : 20,   // top N mots-clés
//     n_questions    : 10,   // top N questions
//     n_clusters     : 5,    // nombre de topics
//     min_word_length: 4,    // longueur min des mots
//     days           : 30,   // analyser les N derniers jours (0 = tout)
//   }
//
// Réponse Python :
//   {
//     top_keywords    : [{word, count, freq}]
//     top_questions   : [{question, count}]
//     topic_clusters  : [{topic, keywords, count}]
//     sentiment       : {positive, neutral, negative, scores}
//     word_cloud_data : [{text, value}]
//     avg_msg_length  : float
//     lang_distribution: {fr, ar, en}
//   }
// =============================================================================
router.post("/nlp", protect, adminOnly, async (req, res) => {
  try {
    const {
      n_keywords      = 20,
      n_questions     = 10,
      n_clusters      = 5,
      min_word_length = 4,
      days            = 0,      // 0 = analyser tout l'historique
    } = req.body;

    // Construire le filtre temporel
    const filter = { role: "user", message: { $ne: "" } };
    if (days > 0) {
      filter.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }

    // Récupérer tous les messages parents (texte uniquement)
    const messages = await Message.find(filter)
      .select("message")
      .lean();

    if (messages.length === 0)
      return res.json({ message: "Aucun message à analyser", total: 0 });

    const texts = messages.map(m => m.message).filter(t => t?.trim().length > 2);

    // Appeler le pipeline NLP Python
    const pyRes = await axios.post(`${PYTHON_API}/dashboard/nlp`, {
      messages       : texts,
      n_keywords,
      n_questions,
      n_clusters,
      min_word_length,
    });

    res.json({
      ...pyRes.data,
      total_messages_analyzed: texts.length,
      period_days            : days || "tout",
    });
  } catch (err) {
    // Si Python est hors ligne → retourner une erreur claire
    if (err.code === "ECONNREFUSED")
      return res.status(503).json({ message: "Service Python NLP indisponible" });
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/dashboard/nlp/child/:childId
// Analyse NLP des messages d'UN enfant spécifique
// Même body optionnel que /nlp
// =============================================================================
router.post("/nlp/child/:childId", protect, adminOnly, async (req, res) => {
  try {
    const {
      n_keywords      = 20,
      n_questions     = 10,
      n_clusters      = 3,
      min_word_length = 4,
      days            = 0,
    } = req.body;

    // Récupérer toutes les conversations de cet enfant
    const convs = await Conversation.find({ childId: req.params.childId }).select("_id");
    if (convs.length === 0)
      return res.json({ message: "Aucune conversation pour cet enfant", total: 0 });

    const convIds = convs.map(c => c._id);

    // Récupérer les messages parents dans ces conversations
    const filter = {
      conversationId: { $in: convIds },
      role          : "user",
      message       : { $ne: "" },
    };
    if (days > 0) {
      filter.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }

    const messages = await Message.find(filter).select("message").lean();

    if (messages.length === 0)
      return res.json({ message: "Aucun message à analyser pour cet enfant", total: 0 });

    const texts = messages.map(m => m.message).filter(t => t?.trim().length > 2);

    // Appeler Python NLP
    const pyRes = await axios.post(`${PYTHON_API}/dashboard/nlp`, {
      messages       : texts,
      n_keywords,
      n_questions,
      n_clusters,
      min_word_length,
    });

    // Récupérer les infos de l'enfant pour contextualiser
    const child = await Child.findById(req.params.childId)
      .select("firstName lastName prediction confidence");

    res.json({
      ...pyRes.data,
      child                  : child || null,
      total_messages_analyzed: texts.length,
      period_days            : days || "tout",
    });
  } catch (err) {
    if (err.code === "ECONNREFUSED")
      return res.status(503).json({ message: "Service Python NLP indisponible" });
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;