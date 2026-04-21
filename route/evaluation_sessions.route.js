// =============================================================================
// routes/evaluation_sessions.route.js  —  CRUD Sessions d'évaluation
// =============================================================================
// Base URL : /api/evaluation-sessions
//
// ROUTES :
//   GET    /api/evaluation-sessions/:childId         → toutes les sessions d'un enfant
//   GET    /api/evaluation-sessions/:childId/last    → dernière session
//   GET    /api/evaluation-sessions/:childId/progress→ courbe évolution globale + par domaine
//   GET    /api/evaluation-sessions/detail/:sessionId→ session complète avec toutes les réponses
//   POST   /api/evaluation-sessions                  → créer une session + réponses
//   POST   /api/evaluation-sessions/from-form/:childId→ créer session initiale depuis formulaire
//   PUT    /api/evaluation-sessions/:sessionId       → modifier notes/scores
//   DELETE /api/evaluation-sessions/:sessionId       → supprimer session + réponses
// =============================================================================

const express            = require("express");
const axios              = require("axios");
const Child              = require("../models/schema_children");
const EvaluationSession  = require("../models/schema_evaluation_sessions");
const EvaluationResponse = require("../models/schema_evaluation_responses");
const EvaluationTemplate = require("../models/schema_evaluation_templates");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

// ── Calcul des scores depuis les réponses ─────────────────────────────────────
function calculateScores(responses) {
  const domainMap = {};
  responses.forEach(r => {
    if (!domainMap[r.domain]) domainMap[r.domain] = { oui: 0, total: 0 };
    domainMap[r.domain].total++;
    if (r.answer === 1) domainMap[r.domain].oui++;
  });

  const domainScores = {};
  Object.entries(domainMap).forEach(([domain, { oui, total }]) => {
    domainScores[domain] = Math.round((oui / total) * 100);
  });

  const totalOui   = responses.filter(r => r.answer === 1).length;
  const globalScore = responses.length > 0
    ? Math.round((totalOui / responses.length) * 100)
    : 0;

  return { globalScore, domainScores };
}

// =============================================================================
// GET /api/evaluation-sessions/:childId  →  liste des sessions
// =============================================================================
router.get("/:childId", protect, adminOnly, async (req, res) => {
  try {
    const sessions = await EvaluationSession.find({ childId: req.params.childId })
      .populate("evaluatedBy", "firstName lastName")
      .sort("-evaluatedAt");
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/evaluation-sessions/:childId/last  →  dernière session
router.get("/:childId/last", protect, adminOnly, async (req, res) => {
  try {
    const session = await EvaluationSession.findOne({ childId: req.params.childId })
      .sort("-evaluatedAt")
      .populate("evaluatedBy", "firstName lastName");
    if (!session) return res.status(404).json({ message: "Aucune session trouvée" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/evaluation-sessions/:childId/progress  →  courbe d'évolution
router.get("/:childId/progress", protect, adminOnly, async (req, res) => {
  try {
    const sessions = await EvaluationSession.find({ childId: req.params.childId })
      .sort("evaluatedAt")
      .select("evaluatedAt periodLabel globalScore domainScores period");

    if (sessions.length === 0)
      return res.json({ sessions: [], trend: null });

    // Calcul tendance globale (première vs dernière session)
    const first = sessions[0].globalScore || 0;
    const last  = sessions[sessions.length - 1].globalScore || 0;
    const trend = last - first;

    res.json({ sessions, trend, totalSessions: sessions.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/evaluation-sessions/detail/:sessionId  →  session + toutes ses réponses
router.get("/detail/:sessionId", protect, adminOnly, async (req, res) => {
  try {
    const session = await EvaluationSession.findById(req.params.sessionId)
      .populate("evaluatedBy", "firstName lastName")
      .populate("childId",     "firstName lastName prediction");
    if (!session) return res.status(404).json({ message: "Session introuvable" });

    const responses = await EvaluationResponse.find({ sessionId: session._id })
      .sort("domain order");

    res.json({ session, responses });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/evaluation-sessions  →  créer une session + réponses (admin)
// Body : { childId, period, periodLabel, notes, responses: [{slug, answer, note}] }
// =============================================================================
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { childId, period, periodLabel, notes, responses: rawResponses, aiPrefilled } = req.body;
    if (!childId || !rawResponses?.length)
      return res.status(400).json({ message: "childId et responses requis" });

    // Charger les templates pour récupérer domain, domainFr, question par slug
    const templates = await EvaluationTemplate.find({ isActive: true });
    const slugMap   = {};
    templates.forEach(tpl => {
      tpl.questions.forEach(q => {
        slugMap[q.slug] = {
          templateId: tpl._id,
          questionId: q._id,
          domain    : tpl.domain,
          domainFr  : tpl.domainFr,
          question  : q.question,
        };
      });
    });

    // Construire les réponses complètes
    const fullResponses = rawResponses.map(r => {
      const meta = slugMap[r.slug] || {};
      return {
        childId     : childId,
        templateId  : meta.templateId,
        questionId  : meta.questionId,
        slug        : r.slug,
        domain      : meta.domain || r.domain || "Inconnu",
        domainFr    : meta.domainFr || r.domainFr || "",
        question    : meta.question || r.question || r.slug,
        answer      : r.answer,   // 0 ou 1
        source      : r.source || "admin_manual",
        aiSuggested : r.aiSuggested || false,
        modified    : r.modified || false,
        note        : r.note || null,
      };
    });

    // Calculer les scores
    const { globalScore, domainScores } = calculateScores(fullResponses);

    // Créer la session
    const session = await EvaluationSession.create({
      childId,
      evaluatedBy : req.user._id,
      period      : period || "mensuelle",
      periodLabel : periodLabel || new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      globalScore,
      domainScores,
      notes       : notes || null,
      aiPrefilled : aiPrefilled || false,
    });

    // Insérer les réponses avec le sessionId
    const responsesDocs = fullResponses.map(r => ({ ...r, sessionId: session._id }));
    await EvaluationResponse.insertMany(responsesDocs);

    res.status(201).json({ session, totalResponses: responsesDocs.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/evaluation-sessions/from-form/:childId
// Créer la session "initiale" automatiquement depuis le formulaire parent
// =============================================================================
router.post("/from-form/:childId", protect, adminOnly, async (req, res) => {
  try {
    console.log("debut de from-from");
    const child = await Child.findById(req.params.childId);
    console.log(child);
    if (!child) return res.status(404).json({ message: "Enfant introuvable" });

    // // Appeler Python pour générer le JSON évaluation depuis le formulaire
    // const pyRes = await axios.post(`${PYTHON_API}/evaluation/prefill`, {
    //   child_form: {
    //     A1: child.A1, A2: child.A2, A3: child.A3, A4: child.A4,
    //     A5: child.A5, A6: child.A6, A7: child.A7, A8: child.A8,
    //     A9: child.A9, A10: child.A10,
    //     PR_QH1A: child.PR_QH1A, PR_QH1B: child.PR_QH1B,
    //     PR_QK1 : child.PR_QK1,  PR_QF1A: child.PR_QF1A,
    //     PR_QO1_A_COMBINE: child.PR_QO1_A_COMBINE,
    //   },
    //   profile_detecter: child.profileDetected || [],
    // });
    // console.log(pyRes);
    
    // const evalJson = pyRes.data.eval_json || {};

    // Charger templates pour la correspondance slug → meta
    const templates = await EvaluationTemplate.find({ isActive: true });
    const slugMap   = {};
    templates.forEach(tpl => {
      tpl.questions.forEach(q => {
        slugMap[q.slug] = {
          templateId: tpl._id, questionId: q._id,
          domain: tpl.domain, domainFr: tpl.domainFr, question: q.question,
        };
      });
    });

    const evalJson = await EvaluationResponse.find({ childId: child._id, source: "form_parent" });
    console.log(evalJson);
    
    // Construire les réponses (uniquement les slugs avec valeur 0 ou 1)
    const rawResponses = Object.entries(evalJson || {})
      .filter(([, v]) => v === 0 || v === 1)
      .map(([slug, answer]) => {
        const meta = slugMap[slug] || {};
        return {
          childId    : child._id,
          sessionId  : null,   // sera rempli après création session
          templateId : meta.templateId,
          questionId : meta.questionId,
          slug,
          domain     : meta.domain || "Inconnu",
          domainFr   : meta.domainFr || "",
          question   : meta.question || slug,
          answer,
          source     : "form_parent",
          aiSuggested: true,
          modified   : false,
        };
      });

    // Calculer les scores
    const { globalScore, domainScores } = calculateScores(rawResponses);

    // Créer la session initiale
    const session = await EvaluationSession.create({
      childId    : child._id,
      evaluatedBy: req.user._id,
      period     : "initiale",
      periodLabel: "Évaluation initiale",
      globalScore,
      domainScores,
      aiPrefilled: true,
      fromForm   : true,
    });

    // Insérer les réponses
    const docs = rawResponses.map(r => ({ ...r, sessionId: session._id }));
    await EvaluationResponse.insertMany(docs);

    res.status(201).json({ session, totalResponses: docs.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// PUT /api/evaluation-sessions/:sessionId  →  modifier notes d'une session
// =============================================================================
router.put("/:sessionId", protect, adminOnly, async (req, res) => {
  try {
    const allowed = ["notes", "periodLabel"];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const session = await EvaluationSession.findByIdAndUpdate(
      req.params.sessionId, updates, { new: true }
    );
    if (!session) return res.status(404).json({ message: "Session introuvable" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// DELETE /api/evaluation-sessions/:sessionId  →  supprimer session + réponses
// =============================================================================
router.delete("/:sessionId", protect, adminOnly, async (req, res) => {
  try {
    const session = await EvaluationSession.findByIdAndDelete(req.params.sessionId);
    if (!session) return res.status(404).json({ message: "Session introuvable" });

    await EvaluationResponse.deleteMany({ sessionId: session._id });
    res.json({ message: "Session et réponses supprimées" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;