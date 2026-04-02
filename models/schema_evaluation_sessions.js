// =============================================================================
// schema_evaluation_sessions.js  —  Collection : evaluation_sessions
// Une session = une évaluation complète d'un enfant à une date donnée
// =============================================================================

const mongoose = require("mongoose");

const EvaluationSessionSchema = new mongoose.Schema(
  {
    childId     : { type: mongoose.Schema.Types.ObjectId, ref: "Child", required: true },
    evaluatedBy : { type: mongoose.Schema.Types.ObjectId, ref: "User",  required: true },

    period : {
      type   : String,
      enum   : ["initiale", "hebdomadaire", "mensuelle", "trimestrielle", "ponctuelle"],
      default: "mensuelle",
    },
    // "initiale"       → créée automatiquement depuis le formulaire parent
    // "mensuelle"      → évaluation mensuelle standard
    // "trimestrielle"  → bilan trimestriel

    periodLabel : { type: String },
    // ex: "Mars 2026", "Semaine 12 - 2026"

    evaluatedAt  : { type: Date, default: Date.now },

    // Scores calculés automatiquement depuis les réponses
    globalScore  : { type: Number, min: 0, max: 100 },
    // % de réponses "oui" sur l'ensemble des questions

    domainScores : { type: Map, of: Number, default: {} },
    // ex: { "التواصل": 75, "النظافة": 60, "اللباس": 80 }

    notes       : { type: String, trim: true },  // commentaire évaluateur
    aiPrefilled : { type: Boolean, default: false },
    // true si les réponses ont été pré-remplies par l'IA

    fromForm    : { type: Boolean, default: false },
    // true si session créée automatiquement depuis le formulaire parent initial
  },
  { timestamps: true, collection: "evaluation_sessions" }
);

EvaluationSessionSchema.index({ childId: 1, evaluatedAt: -1 });
EvaluationSessionSchema.index({ evaluatedBy: 1 });

module.exports = mongoose.model("EvaluationSession", EvaluationSessionSchema);