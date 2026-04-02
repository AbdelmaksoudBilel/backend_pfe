// =============================================================================
// schema_responses.js  —  Collection : responses
// =============================================================================
// Une réponse = la sortie complète du pipeline IA pour un message parent.
// Relation 1-1 avec messages (un message → une réponse).
//
// CHAMPS DE TEMPS :
//   createdAt      → automatique Mongoose — moment d'insertion en DB
//   generatedAt    → moment exact de fin de génération LLM
//   ragDurationMs  → temps de recherche RAG (récupération documents)
//   llmDurationMs  → temps de génération LLM uniquement
//   totalDurationMs→ temps total pipeline complet (RAG + LLM + post-traitement)
// =============================================================================

const mongoose = require("mongoose");

const ResponseSchema = new mongoose.Schema(
  {
    // ── Lien (1-1 avec messages) ──────────────────────────────────────────────
    messageId : {
      type     : mongoose.Schema.Types.ObjectId,
      ref      : "Message",
      required : true,
      unique   : true,   // une seule réponse par message
    },

    // ── Contenu de la réponse ─────────────────────────────────────────────────
    reponse  : { type: String, required: true },   // texte généré par le LLM
    lang     : { type: String, default: "fr" },    // langue de la réponse (fr/ar/en)

    // ── Informations RAG ─────────────────────────────────────────────────────
    score    : { type: Number, min: 0, max: 1 },
    // Score de similarité RAG (pertinence des documents récupérés)
    // 0 = aucun document pertinent trouvé
    // 1 = documents parfaitement pertinents

    webUsed  : { type: Boolean, default: false },
    // true = web search déclenché car score RAG insuffisant

    sources  : { type: [String], default: [] },
    // URLs ou titres des documents sources utilisés

    // ── Champs de temps ───────────────────────────────────────────────────────
    generatedAt : { type: Date, default: Date.now },
    // Moment exact où le LLM a terminé de générer la réponse

    ragDurationMs : { type: Number, default: null },
    // Temps de recherche dans la base vectorielle (FAISS) en millisecondes
    // ex: 120 → "la recherche RAG a pris 120ms"

    llmDurationMs : { type: Number, default: null },
    // Temps de génération du LLM uniquement, en millisecondes
    // ex: 1600 → "Groq a mis 1.6 secondes à générer le texte"

    totalDurationMs : { type: Number, default: null },
    // Temps total pipeline complet en millisecondes
    // = ragDurationMs + llmDurationMs + traduction + post-traitement
    // ex: 2100 → "le parent a attendu 2.1 secondes au total"

    // ── Évaluation par le parent ──────────────────────────────────────────────
    helpful : { type: Boolean, default: null },
    // null = pas encore évalué
    // true = 👍 utile
    // false = 👎 pas utile

    review  : { type: String, trim: true },
    // Commentaire libre du parent (optionnel)
  },
  {
    timestamps: true,       // createdAt + updatedAt automatiques
    collection: "responses",
  }
);

ResponseSchema.index({ messageId: 1 }, { unique: true });
ResponseSchema.index({ score: 1 });
ResponseSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Response", ResponseSchema);