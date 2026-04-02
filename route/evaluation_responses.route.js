// =============================================================================
// routes/evaluation_responses.route.js  —  CRUD Réponses d'évaluation
// =============================================================================
// Base URL : /api/evaluation-responses
//
// ROUTES :
//   GET  /api/evaluation-responses/:sessionId          → toutes les réponses d'une session
//   GET  /api/evaluation-responses/:childId/history/:slug → historique d'une question
//   PUT  /api/evaluation-responses/:responseId         → modifier une réponse (0→1 ou 1→0)
// =============================================================================

const express            = require("express");
const EvaluationResponse = require("../models/schema_evaluation_responses");
const EvaluationSession  = require("../models/schema_evaluation_sessions");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

// ── Recalcul scores après modification ────────────────────────────────────────
async function recalcSessionScores(sessionId) {
  const responses = await EvaluationResponse.find({ sessionId });

  const domainMap = {};
  responses.forEach(r => {
    if (!domainMap[r.domain]) domainMap[r.domain] = { oui: 0, total: 0 };
    domainMap[r.domain].total++;
    if (r.answer === 1) domainMap[r.domain].oui++;
  });

  const domainScores = {};
  Object.entries(domainMap).forEach(([d, { oui, total }]) => {
    domainScores[d] = Math.round((oui / total) * 100);
  });

  const totalOui    = responses.filter(r => r.answer === 1).length;
  const globalScore = responses.length > 0
    ? Math.round((totalOui / responses.length) * 100)
    : 0;

  await EvaluationSession.findByIdAndUpdate(sessionId, { globalScore, domainScores });
  return { globalScore, domainScores };
}

// GET /api/evaluation-responses/:sessionId  →  toutes les réponses d'une session
router.get("/:sessionId", protect, adminOnly, async (req, res) => {
  try {
    const responses = await EvaluationResponse.find({ sessionId: req.params.sessionId })
      .sort("domain order");
    res.json(responses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/evaluation-responses/:childId/history/:slug
// Historique d'une question spécifique (évolution dans le temps)
router.get("/:childId/history/:slug", protect, adminOnly, async (req, res) => {
  try {
    const history = await EvaluationResponse.find({
      childId: req.params.childId,
      slug   : req.params.slug,
    })
      .populate("sessionId", "evaluatedAt periodLabel period")
      .sort("createdAt");

    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/evaluation-responses/:responseId  →  modifier une réponse (admin)
// Body : { answer: 0|1, note: "..." }
router.put("/:responseId", protect, adminOnly, async (req, res) => {
  try {
    const { answer, note } = req.body;
    if (answer === undefined || (answer !== 0 && answer !== 1))
      return res.status(400).json({ message: "answer doit être 0 ou 1" });

    const resp = await EvaluationResponse.findById(req.params.responseId);
    if (!resp) return res.status(404).json({ message: "Réponse introuvable" });

    const wasAiSuggested = resp.aiSuggested;
    resp.answer   = answer;
    resp.note     = note?.trim() || resp.note;
    resp.modified = wasAiSuggested ? true : resp.modified;
    await resp.save();

    // Recalculer les scores de la session
    const scores = await recalcSessionScores(resp.sessionId);

    res.json({ response: resp, newScores: scores });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;