// =============================================================================
// schema_conversations.js  —  Collection : conversations
// =============================================================================

const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    name    : { type: String, default: "Nouvelle conversation", trim: true },
    userId  : { type: mongoose.Schema.Types.ObjectId, ref: "User",  required: true },
    childId : { type: mongoose.Schema.Types.ObjectId, ref: "Child", required: true },

    // Mémoire conversationnelle (synchronisé avec Python MemoryManager)
    resume   : { type: String, default: "" },      // résumé glissant généré par LLM
    motsCles : { type: [String], default: [] },    // mots-clés cliniques extraits

    totalMessages : { type: Number, default: 0 },
    isActive      : { type: Boolean, default: true },
  },
  { timestamps: true, collection: "conversations" }
);

ConversationSchema.index({ userId: 1, createdAt: -1 });
ConversationSchema.index({ childId: 1 });

module.exports = mongoose.model("Conversation", ConversationSchema);