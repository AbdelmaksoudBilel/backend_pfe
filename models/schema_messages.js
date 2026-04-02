// =============================================================================
// schema_messages.js  —  Collection : messages
// =============================================================================
// Un message = ce que le parent envoie OU ce que l'assistant répond.
// Les deux côtés sont dans la même collection, distingués par `role`.
//
// CHAMPS DE TEMPS :
//   createdAt    → automatique Mongoose — quand le document est inséré en DB
//   sentAt       → quand le parent a appuyé sur "Envoyer" (timestamp client)
//   deliveredAt  → quand le backend a reçu et traité le message
//   processingMs → durée de génération IA en ms (uniquement role="assistant")
//   isRead       → true quand le parent a lu la réponse
// =============================================================================

const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    // ── Lien ─────────────────────────────────────────────────────────────────
    conversationId : {
      type     : mongoose.Schema.Types.ObjectId,
      ref      : "Conversation",
      required : true,
    },

    // ── Contenu ───────────────────────────────────────────────────────────────
    message  : { type: String, default: "" },
    fileUrl  : { type: String },
    fileType : {
      type   : String,
      enum   : ["image", "video", "audio", "aucun"],
      default: "aucun",
    },
    isVoice  : { type: Boolean, default: false },

    // Qui a envoyé ce message ?
    role : {
      type   : String,
      enum   : ["user", "assistant"],
      default: "user",
      // user      → parent
      // assistant → réponse LLM
    },

    // ── Champs de temps ───────────────────────────────────────────────────────
    sentAt : { type: Date, default: Date.now },
    // Quand le parent a appuyé "Envoyer"
    // Pour role="assistant" → même valeur que createdAt

    deliveredAt : { type: Date },
    // Quand le backend a confirmé la réception
    // Utile si le parent est offline et les messages sont mis en attente

    processingMs : { type: Number, default: null },
    // Durée de génération de la réponse IA (ms)
    // Rempli uniquement pour role="assistant"
    // ex: 1850 → "l'IA a mis 1.85 secondes à répondre"
    // null pour les messages role="user"

    // ── Statut ────────────────────────────────────────────────────────────────
    isRead : { type: Boolean, default: false },
    // true = le parent a vu la réponse de l'assistant
  },
  {
    timestamps: true,      // createdAt + updatedAt gérés automatiquement
    collection: "messages",
  }
);

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Message", MessageSchema);